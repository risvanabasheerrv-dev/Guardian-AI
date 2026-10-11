/**
 * src/db.js
 * Uses Firestore when a Firebase/Google project ID is configured; otherwise
 * persists users and scan data in local JSON files.
 */
import admin from 'firebase-admin';
import logger from './middleware/logger.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '../serviceAccountKey.json');
const LOCAL_DB_DIR = path.join(__dirname, '../data/local_db');

let firestore;
let isLocal = false;
let serviceAccount = null;

try {
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  }
} catch (error) {
  logger.warn(`[Firebase] Failed to read service account: ${error.message}`);
}

function configuredProjectId() {
  let firebaseConfig = {};
  const configValue = process.env.FIREBASE_CONFIG;
  if (configValue) {
    try {
      firebaseConfig = JSON.parse(configValue);
    } catch {
      try {
        if (fs.existsSync(configValue)) {
          firebaseConfig = JSON.parse(fs.readFileSync(configValue, 'utf8'));
        }
      } catch {}
    }
  }

  return process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || process.env.FIREBASE_PROJECT_ID
    || firebaseConfig.projectId
    || firebaseConfig.project_id
    || serviceAccount?.project_id
    || null;
}

const projectId = configuredProjectId();
if (!projectId) {
  isLocal = true;
  logger.info('Using local storage');
} else {
  try {
    const credential = serviceAccount
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault();
    admin.initializeApp({ credential, projectId });
    firestore = admin.firestore();
    logger.info(`[Firebase] Admin SDK initialized (Project: ${projectId})`);
  } catch (error) {
    logger.warn(`[Firebase] Initialization failed: ${error.message}`);
    isLocal = true;
    logger.info('Using local storage');
  }
}

export const usingLocalStorage = isLocal;

const localDb = {
  collection: (colName) => {
    const colPath = path.join(LOCAL_DB_DIR, colName);
    const ensureCollection = () => fs.promises.mkdir(colPath, { recursive: true });
    const documentPath = (docId) => path.join(colPath, `${encodeURIComponent(String(docId))}.json`);
    const readDocuments = async () => {
      await ensureCollection();
      const files = (await fs.promises.readdir(colPath)).filter(file => file.endsWith('.json'));
      return Promise.all(files.map(async file => ({
        id: decodeURIComponent(file.slice(0, -5)),
        data: JSON.parse(await fs.promises.readFile(path.join(colPath, file), 'utf8')),
      })));
    };
    const snapshot = (documents) => ({
      docs: documents.map(document => ({ id: document.id, data: () => document.data })),
      empty: documents.length === 0,
      size: documents.length,
    });

    return {
      doc: (docId) => ({
        set: async (data, options = {}) => {
          await ensureCollection();
          let savedData = data;
          if (options.merge) {
            const existing = await localDb.collection(colName).doc(docId).get();
            if (existing.exists) savedData = { ...existing.data(), ...data };
          }
          await fs.promises.writeFile(documentPath(docId), JSON.stringify(savedData, null, 2));
          return true;
        },
        get: async () => {
          try {
            const content = await fs.promises.readFile(documentPath(docId), 'utf8');
            return { exists: true, data: () => JSON.parse(content) };
          } catch {
            return { exists: false, data: () => null };
          }
        },
        update: async (data) => {
          const existing = await localDb.collection(colName).doc(docId).get();
          if (!existing.exists) throw new Error(`Document ${docId} does not exist`);
          return localDb.collection(colName).doc(docId).set({ ...existing.data(), ...data });
        },
        delete: async () => {
          try { await fs.promises.unlink(documentPath(docId)); } catch {}
          return true;
        }
      }),
      where: (field, op, value) => ({
        get: async () => {
          if (op !== '==') throw new Error(`Unsupported local query operator: ${op}`);
          const documents = await readDocuments();
          return snapshot(documents.filter(document => document.data[field] === value));
        }
      }),
      get: async () => {
        return snapshot(await readDocuments());
      }
    };
  },
  batch: () => ({
    update: (docRef, data) => { /* simplified batch mock */ },
    commit: async () => true
  })
};

// Export the real DB or the local mock
export const db = isLocal ? localDb : new Proxy(firestore, {
  get(target, prop) {
    if (prop === 'collection') {
      return (name) => {
        const originalCol = target.collection(name);
        return new Proxy(originalCol, {
          get(colTarget, colProp) {
            const orig = colTarget[colProp];
            if (typeof orig === 'function') {
              return (...args) => {
                const result = orig.apply(colTarget, args);
                // If it's a promise (like .get() or .set()), catch Firestore errors and switch to local
                if (result instanceof Promise) {
                  return result.catch(err => {
                    if (err.message.includes('permission-denied') || err.message.includes('PERMISSION_DENIED') || err.message.includes('disabled')) {
                      logger.error(`[Firestore Error] ${err.message} -> Falling back to LOCAL DATA for collection "${name}"`);
                      return localDb.collection(name)[colProp](...args);
                    }
                    throw err;
                  });
                }
                return result;
              };
            }
            return orig;
          }
        });
      };
    }
    return target[prop];
  }
});

/**
 * reset_guardian_ai.js
 * 
 * RUN THIS TO CLEAR THE DATABASE AND START FRESH.
 * Does two things:
 * 1. Deletes all users from Firestore (or local_db).
 * 2. Deletes all previous runs and logs.
 * 3. Clears local storage hints.
 * 
 * Usage: node reset_guardian_ai.js
 */

import { db } from './src/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB_DIR = path.join(__dirname, 'data/local_db');

async function reset() {
  console.log('🚀 Starting Guardian AI Database Reset...');

  try {
    // 1. Clear Firestore users (if active)
    const users = await db.collection('users').get();
    if (users.docs.length > 0) {
      console.log(`- Deleting ${users.docs.length} users from database...`);
      for (const user of users.docs) {
        await db.collection('users').doc(user.id || user.data().id).delete();
      }
    }

    // 2. Clear runs
    const runs = await db.collection('runs').get();
    if (runs.docs.length > 0) {
      console.log(`- Deleting ${runs.docs.length} previous analysis runs...`);
      for (const run of runs.docs) {
        await db.collection('runs').doc(run.id).delete();
      }
    }

    // 3. Clear local files
    if (fs.existsSync(LOCAL_DB_DIR)) {
      console.log('- Clearing local database cache...');
      fs.rmSync(LOCAL_DB_DIR, { recursive: true, force: true });
    }

    // 4. Clear data/runs folder
    const runsDir = path.join(__dirname, 'data/runs');
    if (fs.existsSync(runsDir)) {
      console.log('- Clearing local JSON run results...');
      fs.rmSync(runsDir, { recursive: true, force: true });
    }

    console.log('\n✅ RESET COMPLETE.');
    console.log('1. Restart your server (npm start).');
    console.log('2. Go to /signup to create your fresh account.');
    console.log('3. Use a FRESH GitLab PAT with "api" and "read_api" scopes.');
    console.log('4. Ensure your user has "Developer" access to project 80798057.');

  } catch (err) {
    console.error('❌ Reset failed:', err.message);
  }
  process.exit(0);
}

reset();

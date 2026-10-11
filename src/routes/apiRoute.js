/**
 * routes/apiRoute.js
 * Dashboard REST API routes:
 * GET /api/metrics — aggregate stats
 * GET /api/runs — list of all runs (paginated)
 * GET /api/runs/:id — single run details
 * GET /api/config — current config
 * PUT /api/config — update config (authenticated)
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { authenticateDashboard } from '../middleware/auth.js';
import { getPublicUrl } from '../ngrok-tunnel.js';
import logger from '../middleware/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, '../../data/runs');
const CONFIG_FILE = path.join(__dirname, '../config/default.json');
const GITLAB_TOKEN_PREFIX = 'glpat-';

const router = Router();
router.use(apiLimiter);

// ── GET /api/health — Checks AI Configuration ────────────────────────────
router.get('/api/health', authenticateDashboard, (req, res) => {
  res.json({
    groq: !!process.env.GROQ_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  });
});

// ── GET /api/status — PUBLIC, no auth ────────────────────────────────────
router.get('/api/status', (req, res) => {
  let publicUrl = getPublicUrl();

  // On Cloud Run, use the request's own origin as the public URL
  if (!publicUrl && process.env.K_SERVICE) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    publicUrl = `${proto}://${host}`;
  }

  const webhookUrl = publicUrl ? `${publicUrl}/webhook` : null;
  res.json({
    status: 'ok',
    version: '1.0.0',
    webhookUrl,
    publicUrl,
    setupUrl: publicUrl ? `${publicUrl}/setup` : null,
    localUrl: `http://localhost:${process.env.PORT || 3000}`,
    ngrokActive: !!publicUrl,
  });
});

// ── GET /api/user/profile — returns current user's connection status ───────
router.get('/api/user/profile', authenticateDashboard, async (req, res) => {
  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    const userDoc = await db.collection('users').doc(userId).get();
    const user = userDoc.exists ? userDoc.data() : null;
    
    if (!user) {
      if (req.user.role === 'admin') {
        return res.json({
          username: req.user.sub,
          role: 'admin',
          connected: false,
          gitlabTokenSet: false,
          webhookSecretSet: false,
        });
      }
      return res.status(404).json({ error: 'User not found in Firestore' });
    }
    
    res.json({
      username: user.username,
      role: user.role,
      email: user.email,
      connected: typeof user.gitlabToken === 'string' && user.gitlabToken.startsWith(GITLAB_TOKEN_PREFIX),
      gitlabTokenSet: typeof user.gitlabToken === 'string' && user.gitlabToken.startsWith(GITLAB_TOKEN_PREFIX),
      webhookSecretSet: !!user.webhookSecret,
      createdAt: user.createdAt,
    });
  } catch (err) {
    logger.error(`/api/user/profile error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── POST /api/user/connect — saves user's GitLab token to their account ───
router.post('/api/user/connect', authenticateDashboard, async (req, res) => {
  const { gitlabToken, webhookSecret, email } = req.body || {};
  const normalizedGitlabToken = typeof gitlabToken === 'string' ? gitlabToken.trim() : gitlabToken;
  if (!gitlabToken && !webhookSecret && !email) return res.status(400).json({ error: 'No data provided' });
  if (gitlabToken != null && normalizedGitlabToken !== 'keep' &&
      (typeof normalizedGitlabToken !== 'string' || !normalizedGitlabToken.startsWith(GITLAB_TOKEN_PREFIX))) {
    return res.status(400).json({ error: 'GitLab token must start with glpat-' });
  }

  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    let user = userDoc.exists ? userDoc.data() : null;
    
    if (!user) {
      if (req.user.role === 'admin') {
        user = {
          id: userId,
          username: req.user.sub,
          role: 'admin',
          createdAt: new Date().toISOString()
        };
      } else {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    if (normalizedGitlabToken && normalizedGitlabToken !== 'keep') user.gitlabToken = normalizedGitlabToken;
    if (webhookSecret) user.webhookSecret = webhookSecret;
    if (email) user.email = email;
    user.connectedAt = new Date().toISOString();

    await userRef.set(user, { merge: true });
    logger.info(`User "${user.username}" updated connection settings in Firestore`);
    res.json({
      success: true,
      message: normalizedGitlabToken && normalizedGitlabToken !== 'keep'
        ? 'GitLab connected'
        : 'Settings saved',
      ...(normalizedGitlabToken && normalizedGitlabToken !== 'keep'
        ? { maskedToken: `${normalizedGitlabToken.slice(0, 4)}****` }
        : {}),
    });
  } catch (err) {
    logger.error(`/api/user/connect error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ── GET /api/runs/active ──────────────────────────────────────────────────
router.get('/api/runs/active', authenticateDashboard, async (req, res) => {
  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    // Fetch all currently active runs for this tenant
    const snap = await db.collection('runs_active')
      .where('userId', '==', userId)
      .get();
      
    if (snap.empty) {
      return res.json({ active: [] });
    }
    
    // Return array of running jobs and their log history
    const active = snap.docs.map(doc => doc.data());
    res.json({ active });
  } catch (err) {
    logger.error(`/api/runs/active error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load active runs' });
  }
});

// ── GET /api/metrics ──────────────────────────────────────────────────────

router.get('/api/metrics', authenticateDashboard, async (req, res) => {
  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    const runs = await loadAllRuns(userId);
    logger.info(`[Dashboard] GET /api/metrics dashboardUserId=${userId} savedRunUserIds=${[...new Set(runs.map(run => run.userId))].join(',') || 'none'}`);
    const metrics = runs.reduce((totals, result) => {
      totals.totalFindings += result.totalFindings;
      totals.criticalFindings += result.criticalCount;
      totals.pipelinesSaved += result.pipelinesSaved;
      totals.co2Grams += result.co2Grams;
      totals.docsUpdated += result.docsUpdated ? 1 : 0;
      return totals;
    }, {
      totalFindings: 0,
      criticalFindings: 0,
      pipelinesSaved: 0,
      co2Grams: 0,
      docsUpdated: 0,
    });

    res.json({
      totalMRs: runs.length,
      totalFindings: metrics.totalFindings,
      criticalFindings: metrics.criticalFindings,
      pipelinesSaved: metrics.pipelinesSaved,
      co2Saved: metrics.co2Grams,
      docsUpdated: metrics.docsUpdated,
      recentRuns: runs.slice(0, 10),
    });
  } catch (err) {
    logger.error(`/api/metrics error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});


// ── GET /api/runs ─────────────────────────────────────────────────────────

router.get('/api/runs', authenticateDashboard, async (req, res) => {
  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);
    const runs = await loadAllRuns(userId);
    const recentRuns = runs.slice(0, limit);
    logger.info(`[Dashboard] GET /api/runs dashboardUserId=${userId} savedRunUserIds=${[...new Set(recentRuns.map(run => run.userId))].join(',') || 'none'} returned=${recentRuns.length}`);
    res.json({ runs: recentRuns, total: runs.length });
  } catch (err) {
    logger.error(`/api/runs error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load runs' });
  }
});

// ── GET /api/runs/:id ─────────────────────────────────────────────────────

router.get('/api/runs/:id', authenticateDashboard, async (req, res) => {
  try {
    const { id } = req.params;
    // Sanitize: ensure id only contains safe chars
    if (!/^[\w\-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid run ID' });
    }

    const doc = await db.collection('runs').doc(id).get();

    if (!doc.exists || doc.data().userId !== String(req.user.userId || `env-${req.user.sub}`)) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json(doc.data());
  } catch (err) {
    logger.error(`/api/runs/:id error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load run' });
  }
});

// ── GET /api/green ────────────────────────────────────────────────────────
// Public endpoint — shareable green metrics page

router.get('/api/green', authenticateDashboard, async (req, res) => {
  try {
    const userId = req.user.userId || `env-${req.user.sub}`;
    const runs = await loadAllRuns(userId);
    const green = {
      totalMRs: runs.length,
      totalPipelinesSaved: runs.reduce((sum, result) => sum + result.pipelinesSaved, 0),
      totalComputeMinutesSaved: runs.reduce((sum, result) => sum + result.pipelinesSaved * 6, 0),
      totalCo2Saved: Math.round(runs.reduce((sum, result) => sum + result.co2Grams, 0) * 10) / 10,
      totalFindingsCount: runs.reduce((sum, result) => sum + result.totalFindings, 0),
      runs: runs.map(result => ({
        mrIid: result.mrId,
        projectId: result.projectId,
        timestamp: result.createdAt,
        findingsCount: result.totalFindings,
        criticalCount: result.criticalCount,
        highCount: result.findings.filter(f =>
          typeof f.severity === 'string' && f.severity.toLowerCase() === 'high'
        ).length,
        pipelinesSaved: result.pipelinesSaved,
        computeMinutesSaved: result.pipelinesSaved * 6,
        co2Saved: result.co2Grams,
      })),
    };
    res.json(green);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load green metrics' });
  }
});

// ── GET /api/config ───────────────────────────────────────────────────────

router.get('/api/config', authenticateDashboard, async (req, res) => {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── PUT /api/config ───────────────────────────────────────────────────────

router.put('/api/config', authenticateDashboard, async (req, res) => {
  try {
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Invalid config body' });
    }
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    logger.info('Config updated via /api/config');
    res.json({ message: 'Config updated successfully', config });
  } catch (err) {
    logger.error(`/api/config PUT error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadAllRuns(userId) {
  try {
    let query = db.collection('runs').where('userId', '==', String(userId));
    
    // Note: Firestore requires a composite index if you query with == and orderBy on different fields.
    // To avoid complex index requirements for the hackathon, we fetch the subset and sort in-memory.
    const snapshot = await query.get();
    
    const docs = snapshot.docs
      .map(doc => doc.data())
      .filter(isScanResult);
    docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return docs;
  } catch (err) {
    logger.error(`[Database] Failed to load runs: ${err.message}`);
    throw err;
  }
}

function isScanResult(value) {
  return value &&
    typeof value === 'object' &&
    value.userId != null &&
    value.mrId != null &&
    Array.isArray(value.findings) &&
    typeof value.totalFindings === 'number' &&
    typeof value.criticalCount === 'number' &&
    typeof value.pipelinesSaved === 'number' &&
    typeof value.co2Grams === 'number';
}

export default router;

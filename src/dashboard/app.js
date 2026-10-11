/**
 * dashboard/app.js — Guardian AI
 * Renders the shared scan result objects returned by /api/runs.
 */

const token = localStorage.getItem('guardian_ai_token');
if (!token) window.location.href = '/login';

async function api(path) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('guardian_ai_token');
    window.location.href = '/login';
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`The server returned an invalid response (${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

function showDashboardError(message) {
  document.getElementById('statusText').textContent = 'Error';
  const container = document.getElementById('tableContainer');
  if (container) {
    container.textContent = `Dashboard request failed: ${message}`;
    container.style.color = 'var(--red)';
  }
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function riskClass(level) {
  if (level === 'CRITICAL') return 'high';
  if (level === 'MEDIUM-HIGH') return 'medium';
  return 'low';
}

function riskDisplayLabel(level) {
  if (level === 'CRITICAL') return 'BLOCKED / CRITICAL';
  if (level === 'MEDIUM-HIGH') return 'REVIEW / MEDIUM-HIGH';
  return 'LOW';
}

function initials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  const diff = target - current;
  const steps = 20;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    el.textContent = Math.round(current + (diff * step / steps));
    if (step >= steps) { el.textContent = target; clearInterval(timer); }
  }, 30);
}

async function loadData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('spinning');

  try {
    const [metrics, runsData] = await Promise.all([
      api('/api/metrics'),
      api('/api/runs'),
    ]);

    if (!metrics || !runsData) return;

    // Metric cards
    animateNumber('totalMRs', metrics.totalMRs || 0);
    animateNumber('totalFindings', metrics.totalFindings || 0);
    animateNumber('criticalFindings', metrics.criticalFindings || 0);

    const co2 = Math.round(metrics.co2Saved || 0);
    document.getElementById('co2Saved').textContent = co2 + 'g';

    // Count docs updated from run list
    const runs = runsData.runs || [];
    const docsCount = runs.filter(r => r.docsUpdated).length;
    document.getElementById('docsUpdated').textContent =
      `${docsCount} wiki page${docsCount !== 1 ? 's' : ''}`;

    const fixesCount = runs.filter(r => r.totalFindings > 0).length;
    document.getElementById('autoFixes').textContent =
      fixesCount > 0 ? `${fixesCount} MR${fixesCount !== 1 ? 's' : ''}` : '—';

    // Run count badge
    document.getElementById('runCount').textContent = `${runs.length} runs`;

    renderTable(runs);
    document.getElementById('statusText').textContent = 'Live';
  } catch (e) {
    console.error('Load error:', e);
    const message = e instanceof Error ? e.message : 'Could not load dashboard data.';
    showDashboardError(message);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function renderTable(runs) {
  const container = document.getElementById('tableContainer');
  container.style.color = '';

  if (!runs || runs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <p>No MR analyses yet. Open a Merge Request to trigger Guardian AI.</p>
      </div>`;
    return;
  }

  const rows = runs.slice(0, 50).map(run => {
    const score = run.riskScore;
    const level = run.riskLevel;
    const findings = run.totalFindings;
    const author = run.author || 'Unknown';
    const title = run.title || 'MR Analysis';
    const ts = run.createdAt;
    const scanFailed = run.status === 'FAILED';

    return `
      <tr>
        <td><span class="mr-id">!${run.mrId ?? '?'}</span></td>
        <td><span class="mr-title" title="${title}">${title.length > 45 ? title.slice(0, 45) + '…' : title}</span></td>
        <td>
          <div class="author-cell">
            <div class="author-avatar">${initials(author)}</div>
            ${author}
          </div>
        </td>
        <td>
          ${scanFailed
            ? `<span class="risk-badge high" title="${run.reason || 'Scan failed'}">${run.failureCode === 'GITLAB_AUTH_OR_DIFF' ? 'SCAN FAILED - GitLab token invalid' : `SCAN FAILED - ${run.reason || 'unknown reason'}`}</span>`
            : `<span class="risk-badge ${riskClass(level)}">
                <span class="risk-score">${score}/100</span>
                ${riskDisplayLabel(level)}
              </span>`}
        </td>
        <td>
          <div class="findings-cell">
            <span class="finding-tag total">${findings} total</span>
          </div>
        </td>
        <td><span class="time-cell">${timeAgo(ts)}</span></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>MR</th>
          <th>Title</th>
          <th>Author</th>
          <th>Risk Score</th>
          <th>Findings</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function logout() {
  localStorage.removeItem('guardian_ai_token');
  localStorage.removeItem('guardian_ai_user');
  localStorage.removeItem('guardian_ai_role');
  window.location.href = '/login';
}

let _webhookUrl = null;
function copyUrl() {
  if (!_webhookUrl) return;
  navigator.clipboard.writeText(_webhookUrl).then(() => {
    const btn = event.target;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
}

async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const d = await response.json();
    if (!response.ok) {
      throw new Error(d.error || `Request failed (${response.status}).`);
    }
    if (d.webhookUrl) {
      _webhookUrl = d.webhookUrl;
      const banner = document.getElementById('webhookBanner');
      const urlEl = document.getElementById('webhookBannerUrl');
      if (banner && urlEl) {
        urlEl.textContent = d.webhookUrl;
        banner.style.display = 'flex';
      }
    }
  } catch (err) {
    showDashboardError(err instanceof Error ? err.message : 'Could not load dashboard status.');
  }
}

// Init
loadData();
loadStatus();
setInterval(loadData, 10000);

// CSP Compliance: Attach event listeners
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

const copyUrlBtn = document.getElementById('copyUrlBtn');
if (copyUrlBtn) copyUrlBtn.addEventListener('click', copyUrl);

const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) refreshBtn.addEventListener('click', loadData);

// --- LIVE TERMINAL POLLING ---
let lastLogCount = 0;
async function pollActiveRuns() {
  try {
    const data = await api('/api/runs/active');
    const termSec = document.getElementById('terminalSection');
    const termTitle = document.getElementById('activeRunTitle');
    const termBody = document.getElementById('terminalBody');
    
    if (!data || !data.active || data.active.length === 0) {
      if (termSec.style.display !== 'none') {
        termSec.style.display = 'none';
        lastLogCount = 0;
        // Run just finished! Refresh the table immediately to show the result
        loadData();
      }
      return;
    }

    const run = data.active[0]; // Render the most recent active run
    termSec.style.display = 'block';
    termTitle.textContent = `${run.mrIid} - ${run.mrTitle}`;
    
    const logs = run.logs || [];
    if (logs.length > lastLogCount) {
      termBody.innerHTML = logs.map(l => `<div><span style="color:#71717a">[${new Date().toLocaleTimeString()}]</span> ${l}</div>`).join('');
      termBody.scrollTop = termBody.scrollHeight;
      lastLogCount = logs.length;
    }
  } catch (err) {
    showDashboardError(err instanceof Error ? err.message : 'Could not load active runs.');
  }
}

pollActiveRuns();
setInterval(pollActiveRuns, 2000);

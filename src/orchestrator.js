/**
 * orchestrator.js
 * Runs the MR scan and persists one shared result for GitLab and the dashboard.
 */

import logger from './middleware/logger.js';
import { buildContext } from './agents/contextEngine.js';
import { auditSecurity } from './agents/securityAuditor.js';
import { guardDocs } from './agents/docsGuardian.js';
import { scoreRisk } from './agents/riskScorer.js';
import { trackGreen } from './agents/greenSentinel.js';
import { takeAction } from './agents/actionAgent.js';
import { gitlabAuthContext } from './tools/gitlabClient.js';
import { db, usingLocalStorage } from './db.js';
import admin from 'firebase-admin';

/**
 * Run all scan agents for an MR and persist a single dashboard/GitLab result.
 * @param {{ mr: object, project: object, user: object }} payload
 */
export async function orchestrate({ mr, project, user }) {
  return gitlabAuthContext.run(user || {}, async () => {
    const runId = `${mr.iid}-${Date.now()}`;
    const startTime = Date.now();
    const projectId = project?.id || mr.project_id;
    const userId = String(user?.userId || user?.id || 'anonymous');
    let activeLogs = [`[Guardian AI] Intercepted MR !${mr.iid} - Starting scan...`];
    let context = null;
    let audit = null;
    let docs = null;
    let green = null;
    let risk = null;
    let status = 'OK';
    let failureReason = null;
    let failureCode = null;

    const addLog = async (message) => {
      logger.info(message);
      if (userId === 'anonymous') return;
      try {
        const updatedLogs = [...activeLogs, message];
        await db.collection('runs_active').doc(runId).update({
          logs: usingLocalStorage ? updatedLogs : admin.firestore.FieldValue.arrayUnion(message),
          updatedAt: new Date().toISOString(),
        });
        if (usingLocalStorage) activeLogs = updatedLogs;
      } catch (err) {
        logger.warn(`[Orchestrator] Could not update live logs: ${err.message}`);
      }
    };

    logger.info(`[Orchestrator] Starting run ${runId} for MR !${mr.iid} in project ${projectId} (User: ${user?.username || 'unknown'})`);
    if (userId !== 'anonymous') {
      try {
        await db.collection('runs_active').doc(runId).set({
          runId,
          userId,
          mrIid: mr.iid,
          mrTitle: mr.title,
          status: 'In Progress',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          logs: activeLogs,
        });
      } catch (err) {
        logger.error(`[Orchestrator] Could not create active run record: ${err.message}`);
      }
    }

    try {
      await addLog('[Orchestrator] → Agent 1: Context Engine');
      context = await buildContext({ mr, project });
      if (!context?.diff?.trim()) {
        status = 'FAILED';
        failureCode = 'GITLAB_AUTH_OR_DIFF';
        failureReason = 'GitLab token invalid or MR diff unavailable: the merge request diff is empty';
        await addLog('SCAN FAILED - GitLab token invalid');
      }
    } catch (err) {
      if (err.code === 'GITLAB_SCAN_FETCH_FAILED') {
        status = 'FAILED';
        failureCode = 'GITLAB_AUTH_OR_DIFF';
        failureReason = `GitLab token invalid or MR diff unavailable: ${err.message}`;
        await addLog('SCAN FAILED - GitLab token invalid');
      } else {
        logger.error(`[Orchestrator] Context Engine failed: ${err.message}`);
        context = null;
      }
    }

    if (status === 'OK') {
      try {
        await addLog('[Orchestrator] → Agent 2: Security Auditor');
        audit = await auditSecurity({ mr, context });
        if (audit?.error) {
          status = 'FAILED';
          failureCode = 'SECURITY_AUDIT_FAILED';
          failureReason = audit.error;
        }
      } catch (err) {
        logger.error(`[Orchestrator] Security Auditor failed: ${err.message}`);
        status = 'FAILED';
        failureCode = 'SECURITY_AUDIT_FAILED';
        failureReason = `Security audit failed: ${err.message}`;
      }
    }

    if (status === 'OK') {
      try {
        await addLog('[Orchestrator] → Agent 3: Docs Guardian');
        docs = await guardDocs({ mr, context, audit });
      } catch (err) {
        logger.error(`[Orchestrator] Docs Guardian failed: ${err.message}`);
        docs = null;
      }
    }

    const findings = status === 'OK' && Array.isArray(audit?.findings)
      ? audit.findings
      : [];
    if (status === 'OK') {
      await addLog('[Orchestrator] → Agent 4: Risk Scorer');
      try {
        risk = scoreRisk(findings);
      } catch (err) {
        status = 'FAILED';
        failureCode = 'RISK_SCORE_FAILED';
        failureReason = `Risk calculation failed: ${err.message}`;
        logger.error(`[Orchestrator] ${failureReason}`);
      }
    }

    if (status === 'OK') {
      try {
        await addLog('[Orchestrator] → Agent 5: Green Sentinel');
        green = await trackGreen({ mr, audit: { findings } });
      } catch (err) {
        logger.error(`[Orchestrator] Green Sentinel failed: ${err.message}`);
        green = null;
      }
    }

    const result = {
      mrId: mr.iid,
      projectId,
      title: mr.title || context?.mrDetails?.title || 'Merge Request',
      author: mr.author?.name || context?.mrDetails?.author?.name || 'Unknown',
      userId,
      status,
      ...(failureReason ? { reason: failureReason, failureCode } : {}),
      riskScore: risk?.score ?? null,
      riskLevel: risk?.riskLevel ?? null,
      findings,
      totalFindings: findings.length,
      criticalCount: findings.filter(f =>
        typeof f.severity === 'string' && f.severity.toLowerCase() === 'critical'
      ).length,
      docsUpdated: Boolean(docs?.updated),
      co2Grams: green?.co2Saved ?? 0,
      pipelinesSaved: green?.pipelinesSaved ?? 0,
      commentPosted: false,
      createdAt: new Date().toISOString(),
    };

    if (result.status === 'OK') {
      try {
        await addLog('[Orchestrator] → Agent 6: GitLab comments, labels, and email');
        await takeAction({ result, context, project, user });
      } catch (err) {
        logger.error(`[Orchestrator] Action Agent failed: ${err.message}`);
      }
    }

    const saved = await saveRunResult(runId, result);
    const resultLog = `[Result] userId=${result.userId} MR !${result.mrId} score=${result.riskScore ?? 'N/A'} level=${result.riskLevel ?? 'N/A'} findings=${result.totalFindings} commentPosted=${result.commentPosted} saved=${saved}`;
    await addLog(resultLog);

    logger.info(`[Orchestrator] Run ${runId} finished in ${Date.now() - startTime}ms with status ${result.status}.`);
    if (userId !== 'anonymous') {
      try {
        await db.collection('runs_active').doc(runId).delete();
      } catch (err) {
        logger.warn(`[Orchestrator] Could not remove active run record: ${err.message}`);
      }
    }

    return result;
  });
}

async function saveRunResult(runId, result) {
  try {
    await db.collection('runs').doc(runId).set(result);
    logger.info(`[Orchestrator] Shared result saved to ${usingLocalStorage ? 'local storage' : 'Firestore'}: ${runId}`);
    return true;
  } catch (err) {
    logger.error(`[Orchestrator] Failed to save shared result: ${err.message}`);
    return false;
  }
}

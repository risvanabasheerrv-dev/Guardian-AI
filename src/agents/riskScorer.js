/**
 * agents/riskScorer.js
 * Calculates scan risk exclusively from the security findings.
 */

import logger from '../middleware/logger.js';

const FINDING_WEIGHTS = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 2,
};

export function calculateRiskScore(findings = []) {
  const score = Math.min(100, (Array.isArray(findings) ? findings : []).reduce(
    (total, finding) => {
      const severity = typeof finding?.severity === 'string' ? finding.severity.toLowerCase() : '';
      return total + (FINDING_WEIGHTS[severity] || 0);
    },
    0
  ));

  let riskLevel;
  if (score >= 70) {
    riskLevel = 'CRITICAL';
  } else if (score >= 30) {
    riskLevel = 'MEDIUM-HIGH';
  } else {
    riskLevel = 'LOW';
  }

  return { score, riskLevel };
}

export function scoreRisk(findings) {
  const result = calculateRiskScore(findings);
  logger.info(`[Agent 4: Risk Scorer] Score: ${result.score} (${result.riskLevel}) from ${findings?.length || 0} finding(s)`);
  return result;
}

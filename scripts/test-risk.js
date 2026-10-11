import { calculateRiskScore } from '../src/agents/riskScorer.js';

const cases = [
  {
    name: '1 critical + 2 high findings score 80',
    findings: [
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'high' },
    ],
    expectedScore: 80,
    expectedLevel: 'CRITICAL',
  },
  {
    name: '0 findings score 0',
    findings: [],
    expectedScore: 0,
    expectedLevel: 'LOW',
  },
];

let failed = false;
for (const testCase of cases) {
  const result = calculateRiskScore(testCase.findings);
  const passed = result.score === testCase.expectedScore &&
    result.riskLevel === testCase.expectedLevel;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.name}: score=${result.score}, level=${result.riskLevel}`);
  if (!passed) failed = true;
}

if (failed) process.exitCode = 1;

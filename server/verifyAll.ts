process.env.NODE_ENV = 'test';

import { runStaticAndUiAudit, AuditResult } from './tests/testStaticAudit.js';
import { runUnitLogicTests } from './tests/testUnitLogic.js';
import { runIntegrationApiTests } from './tests/testIntegrationApi.js';
import { resetDatabaseToSeed } from './seed.js';

async function main() {
  console.log('\n=============================================================');
  console.log('   MINI WORKROOM MVP - COMPREHENSIVE END-TO-END SYSTEM AUDIT');
  console.log('   Adhering to GEMINI.md & High-Craft Anti-Slop Specifications');
  console.log('=============================================================\n');

  console.log('[1/4] Running Category 1 & 2: Static, Build, Line-Count & UI Anti-Slop Audit...');
  const staticResults = runStaticAndUiAudit();

  console.log('[2/4] Running Category 3: Pure Logic & Algorithm Unit Tests...');
  const unitResults = runUnitLogicTests();

  console.log('[3/4] Running Category 4: Full REST API & SQLite Integration Tests...');
  const integrationResults = await runIntegrationApiTests();

  console.log('[4/4] Category 5: Resetting SQLite Database to Pristine Seed State...');
  resetDatabaseToSeed();
  console.log('      Database server/workroom.db reset successfully.\n');

  const allResults: AuditResult[] = [
    ...staticResults,
    ...unitResults,
    ...integrationResults,
  ];

  const total = allResults.length;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('=============================================================');
  console.log(`                     AUDIT SUMMARY RESULTS: ${passed}/${total} PASS`);
  console.log('=============================================================\n');

  allResults.forEach((r, idx) => {
    const statusTag = r.passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    const indexStr = String(idx + 1).padStart(2, '0');
    console.log(`${indexStr}. ${statusTag} ${r.name}`);
    console.log(`    ↳ ${r.details}\n`);
  });

  console.log('-------------------------------------------------------------');
  if (failed === 0) {
    console.log(`\x1b[32m✔ ALL ${total} SYSTEM & INTEGRATION AUDITS PASSED WITH 100% SUCCESS.\x1b[0m`);
    console.log('The codebase strictly conforms to all GEMINI.md engineering rules.');
    console.log('=============================================================\n');
    process.exit(0);
  } else {
    console.error(`\x1b[31m✘ ${failed} AUDIT(S) FAILED. Please review the details above.\x1b[0m\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});

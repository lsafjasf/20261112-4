import { runAllSuites } from '../js/run-tests.js';
import { runScenario, continuousChain } from '../js/scenario.js';
import { defaultConfig } from '../js/defaults.js';
import { writeFileSync } from 'node:fs';

const report = runAllSuites();

const chain = runScenario(defaultConfig(), continuousChain.script, continuousChain.steps);
const transitions = chain.events.filter((e) => e.type === 'transition');
const frames = chain.events.filter((e) => e.type === 'frame');
const sfx = chain.events.filter((e) => e.type === 'sfx');

console.log('=== 连续状态切换链 ===');
  console.log(`traceHash=${chain.traceHash} eventHash=${chain.eventHash}`);
  console.log(`transitions=${transitions.length} frames=${frames.length} sfx=${sfx.length}`);
  for (const tr of transitions) console.log(`  ${tr.t.toFixed(3)}s ${tr.from}->${tr.to} (${tr.reason})`);

console.log('\n=== 三类测试场景 ===');
for (const r of report.results) {
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.suite} / ${r.id} — ${r.desc}`);
  for (const d of r.details) console.log(`    · ${d}`);
  if (r.metrics) {
    const { before, after } = r.metrics;
    console.log(`    before: hash=${before.traceHash}/${before.eventHash} objs=${before.objects} px=${before.shot.pixelHash}`);
    console.log(`    after : hash=${after.traceHash}/${after.eventHash} objs=${after.objects} px=${after.shot.pixelHash}`);
  }
}
console.log(`\n汇总: ${report.summary.passed}/${report.summary.total} 通过, ${report.summary.failed} 失败`);

writeFileSync(
  new URL('../artifacts/node-report.json', import.meta.url),
  JSON.stringify({
    summary: report.summary,
    results: report.results.map((r) => ({
      suite: r.suite, id: r.id, ok: r.ok, desc: r.desc, details: r.details,
      metrics: r.metrics ? {
        before: {
          traceHash: r.metrics.before.traceHash,
          eventHash: r.metrics.before.eventHash,
          objects: r.metrics.before.objects,
          pixelHash: r.metrics.before.shot.pixelHash,
          nonzero: r.metrics.before.shot.nonzero,
        },
        after: {
          traceHash: r.metrics.after.traceHash,
          eventHash: r.metrics.after.eventHash,
          objects: r.metrics.after.objects,
          pixelHash: r.metrics.after.shot.pixelHash,
          nonzero: r.metrics.after.shot.nonzero,
        },
      } : null,
    })),
    chain: {
      traceHash: chain.traceHash,
      eventHash: chain.eventHash,
      transitions,
      frameEventCount: frames.length,
      sfxEventCount: sfx.length,
    },
  }, null, 2),
);

if (report.summary.failed > 0) process.exit(1);

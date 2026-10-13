const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { EditingEngine, fileHash, textOf } = require('../out/core');

// Diagnostic benchmark. The CI runner is not a controlled benchmark host;
// timings and heap deltas are reported, not treated as hard performance gates.
test('monitor benchmark: sustained edits in a 100 KiB source file', () => {
  const engine = new EditingEngine();
  const base = 'const x = 1; // comment\n'.repeat(4800);
  const file = engine.ensure('benchmark.ts', base);
  const initialHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let i = 0; i < 2000; i++) {
    engine.apply('benchmark.ts', { start: base.length + i, deleteCount: 0, insert: 'x' }, i * 100);
  }
  const editingMs = performance.now() - started;
  const hashStarted = performance.now();
  fileHash(file);
  const report = engine.report();
  const checkpointMs = performance.now() - hashStarted;
  const heapDeltaMiB = (process.memoryUsage().heapUsed - initialHeap) / 1048576;
  assert.equal(engine.events.length, 128);
  assert.equal(textOf(file).length, base.length + 2000);
  assert.ok(report.score !== null);
  console.log(JSON.stringify({
    benchmark: 'pohw-2000-edits-100k-source',
    edits: 2000, editingMs: Math.round(editingMs),
    checkpointMs: Math.round(checkpointMs),
    heapDeltaMiB: Math.round(heapDeltaMiB * 100) / 100,
    retainedCoreEvents: engine.events.length
  }));
});

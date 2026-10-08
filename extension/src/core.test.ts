import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditingEngine, textOf } from './core';
const score = (e: EditingEngine) => e.report().score ?? 0;
const append = (e: EditingEngine, path: string, text: string, time: number) =>
  e.apply(path, { start: textOf(e.ensure(path)).length, deleteCount: 0, insert: text }, time);

test('case 1: agent writes files externally: no human score; one-shot huge editor insertion low', () => {
  const external = new EditingEngine();
  external.reconcile('agent.ts', 'function ai() { return 1; }\n'.repeat(10000));
  assert.equal(external.report().coverage, 0);
  assert.equal(external.report().score, null);
  const pasted = new EditingEngine();
  append(pasted, 'agent.ts', 'function ai() { return 1; }\n'.repeat(10000), 1);
  assert.ok(score(pasted) < 0.25);
});

test('case 2: incremental code with some Stack Overflow paste: higher score than bulk', () => {
  const e = new EditingEngine(); let t = 10000;
  for (let i = 0; i < 70; i++) {
    append(e, 'main.ts', `let human${i} = ${i};\n`.slice(0, 12), t += 250);
    append(e, 'main.ts', ` // edit${i}\n`, t += 250);
  }
  append(e, 'main.ts', '// external code snippet\n'.repeat(20), t += 1000);
  // Revise around the imported block. Not all pasted content becomes human.
  const p = textOf(e.ensure('main.ts')).length;
  e.apply('main.ts', { start: p - 2, deleteCount: 0, insert: ' // fixed' }, t += 1200);
  assert.ok(score(e) > 0.7, `score = ${score(e)}`);
  assert.ok(score(e) < 0.95);
});

test('case 3: human scaffold, most functions pasted from agent: lower score', () => {
  const e = new EditingEngine(); let t = 1000;
  for (let i = 0; i < 20; i++) append(e, 'main.ts', `function f${i}()`, t += 500);
  append(e, 'main.ts', '\nfunction generated(){return 42;}\n'.repeat(200), t += 1500);
  assert.ok(score(e) < 0.5, `score = ${score(e)}`);
});

test('case 4: code cut and pasted elsewhere retains provenance and score', () => {
  const e = new EditingEngine(); let t = 200;
  for (let i = 0; i < 20; i++) append(e, 'main.ts', `let abc${i}=12;\n`, t += 600);
  const before = score(e);
  const full = textOf(e.ensure('main.ts'));
  const piece = full.slice(0, 13);
  e.apply('main.ts', { start: 0, deleteCount: piece.length, insert: '' }, t += 500);
  const signal = append(e, 'main.ts', piece, t += 500);
  assert.equal(signal.kind, 'move');
  assert.ok(Math.abs(score(e) - before) < 0.00001, `${score(e)} != ${before}`);
});

test('baseline is unverified; new edits only affect coverage and their own spans', () => {
  const e = new EditingEngine(); e.ensure('a.ts', 'const old = 10;\n');
  append(e, 'a.ts', 'const fresh = 2;\n', 1234);
  const r = e.report();
  assert.ok(r.coverage > 0 && r.coverage < 1);
  assert.ok(r.score !== null);
  assert.equal(r.files[0].byOrigin.baseline, 'constold=10;'.length);
});

test('external replacement preserves unchanged suffix/prefix and makes new text unverified', () => {
  const e = new EditingEngine();
  append(e, 'a.ts', 'const human = 1;\n', 1000);
  e.reconcile('a.ts', 'const human = 1;\nconst auto = 2;\n');
  assert.ok(e.report().coverage < 1);
  assert.ok(e.report().coverage > 0);
});

test('multichange range edits preserve exact UTF16 content', () => {
  const e = new EditingEngine(); e.ensure('a.ts', 'abc🚀XYZ');
  e.apply('a.ts', { start: 3, deleteCount: 2, insert: 'x' });
  assert.equal(textOf(e.ensure('a.ts')), 'abcxXYZ');
});

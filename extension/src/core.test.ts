import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditingEngine, fileHash, sha256, textOf } from './core';
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
    append(e, 'main.ts', `let human${i} = ${i};\n`.slice(0, 12), t += 220 + (i % 7) * 31);
    append(e, 'main.ts', ` // edit${i}\n`, t += 220 + (i % 7) * 31);
  }
  append(e, 'main.ts', '// external code snippet\n'.repeat(20), t += 1000);
  // Revise around the imported block. Not all pasted content becomes human.
  const p = textOf(e.ensure('main.ts')).length;
  e.apply('main.ts', { start: p - 2, deleteCount: 0, insert: ' // fixed' }, t += 1200);
  assert.ok(score(e) > 0.53, `score = ${score(e)}`);
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

test('long edit sessions retain only bounded recent events and lazily compute hashes', () => {
  const e = new EditingEngine();
  const f = e.ensure('long.go', 'package main\n');
  const initial = e.report();
  assert.strictEqual(e.report(), initial, 'unchanged reports reuse the cached summary');
  for (let i = 0; i < 2500; i++) {
    e.apply('long.go', { start: textOf(f).length, deleteCount: 0, insert: 'x' }, i * 100);
  }
  assert.equal(e.events.length, 128, 'event memory remains bounded');
  assert.equal(f.hash, '', 'full-file SHA-256 is deferred while editing');
  assert.equal(fileHash(f), sha256(textOf(f)), 'save-time SHA-256 matches current text');
  const fresh = e.report();
  assert.notStrictEqual(fresh, initial, 'edits invalidate cached summaries');
  assert.strictEqual(e.report(), fresh, 'repeated reads use cached summaries');
  e.reconcile('long.go', textOf(f) + 'external');
  assert.notStrictEqual(e.report(), fresh, 'external file changes also invalidate cached summaries');
});

test('explicit provenance restoration invalidates report cache', () => {
  const e = new EditingEngine();
  const f = e.ensure('a.ts', 'original');
  assert.equal(e.report().coverage, 0);
  f.segments = [{ text: 'original', score: 0.9, origin: 'incremental' }];
  e.invalidateReport();
  assert.equal(e.report().coverage, 1);
  assert.equal(e.report().score, 0.9);
});


test('burst continuity increases evidence, with input-only scores capped', () => {
  const e=new EditingEngine(), values=[];
  for(let i=0;i<10;i++) values.push(append(e,'typed.ts','x',1000+i*250+i*i*11).score);
  assert.equal(values[0],0.60);
  assert.ok(Math.abs((values[4]??0)-0.76)<1e-9);
  assert.ok(values.every(x=>x!==null&&x<=0.76));
});

test('perfectly periodic and extremely fast inputs are weak negative signals', () => {
  const natural=new EditingEngine(),periodic=new EditingEngine(),fast=new EditingEngine();
  let time=1000;
  for(let i=0;i<13;i++){
    time+=180+i*17;
    append(natural,'n.ts','x',time);
    append(periodic,'p.ts','x',1000+i*250);
    append(fast,'f.ts','x',1000+i*5);
  }
  assert.ok(score(natural)>score(periodic));
  assert.ok(score(natural)>score(fast));
  assert.ok(periodic.events.at(-1)!.signal.score!<=0.45);
  assert.ok(fast.events.at(-1)!.signal.score!<=0.45);
});

test('revision requires old tracked code and rejects repeated nearby modifications', () => {
  const e=new EditingEngine();
  append(e,'rev.ts','let count = 10; let total = 50;',1000);
  for(let i=0;i<5;i++) append(e,'rev.ts','x',160000+i*320);
  const old=textOf(e.ensure('rev.ts'));
  const first=e.apply('rev.ts',{start:old.indexOf('count'),deleteCount:5,insert:'items'},162000);
  assert.ok(first.score!>0.76);
  const second=e.apply('rev.ts',{start:textOf(e.ensure('rev.ts')).indexOf('total'),
    deleteCount:5,insert:'price'},162300);
  assert.ok(second.score!<=0.76);
});

test('baseline, no-op formatting, and immediate rewrites cannot create revision evidence', () => {
  const baseline=new EditingEngine();
  baseline.ensure('a.ts','counter');
  assert.ok(baseline.apply('a.ts',{start:0,deleteCount:7,insert:'updated'},180000).score!<=0.76);
  const recent=new EditingEngine();
  append(recent,'a.ts','counter',1000);
  assert.ok(recent.apply('a.ts',{start:0,deleteCount:7,insert:'updated'},1500).score!<=0.76);
  const formatting=new EditingEngine();
  append(formatting,'a.ts','count = 1',1000);
  assert.ok(formatting.apply('a.ts',{start:0,deleteCount:9,insert:'count  =  1'},180000).score!<=0.76);
});

test('short-term behavior history follows renamed files and memory remains bounded', () => {
  const e=new EditingEngine();
  append(e,'old.ts','x',1000);
  append(e,'old.ts','x',1300);
  e.relocateBehavior('old.ts','new.ts');
  const file=e.files.get('old.ts')!;
  e.files.delete('old.ts');
  file.path='new.ts';
  e.files.set('new.ts',file);
  assert.ok(append(e,'new.ts','x',1600).score!>0.60);
  for(let i=0;i<3000;i++) append(e,'new.ts','x',2000+i*101);
  assert.equal(e.events.length,128);
  assert.equal(file.hash,'');
});

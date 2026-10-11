import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventJournal, replayJournal, eventHash } from './event-log';
import { textOf } from './core';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-log-'));
  return { file: path.join(dir, 'events.jsonl'), clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('journal replays over 1000 edits, Unicode, moves, external changes and save state', async () => {
  const f = fixture();
  const j = await EventJournal.open(f.file);
  try {
    j.ensure('a.ts', 'base😀'); j.session(true, 1000);
    for (let i = 0; i < 1005; i++) j.apply('a.ts', { start: textOf(j.engine.files.get('a.ts')!).length, deleteCount: 0, insert: 'x' }, 1100 + i);
    j.apply('a.ts', { start: 6, deleteCount: 10, insert: '' }, 3000);
    j.ensure('b.ts', ''); j.apply('b.ts', { start: 0, deleteCount: 0, insert: 'xxxxxxxxxx' }, 3100);
    j.reconcile('a.ts', 'external' + textOf(j.engine.files.get('a.ts')!), 3200);
    j.save('b.ts', 3300); j.session(false, 3400); j.flush();
    const replay = await replayJournal(f.file);
    assert.deepEqual([...replay.engine.files.values()], [...j.engine.files.values()]);
    assert.deepEqual(replay.engine.report(), j.engine.report());
    assert.equal(replay.seq, 1013);
    assert.equal(replay.tip, j.tip);
    assert.equal(replay.engine.files.get('b.ts')!.segments[0].score, 0.84);
    assert.equal(replay.engine.files.get('b.ts')!.segments[1].score, 0.94);
    assert.equal(replay.engine.files.get('b.ts')!.saves, 1);
    assert.equal(replay.active, false);
  } finally { j.close(); f.clean(); }
});
test('restart restores transient scoring context and prevents concurrent writers', async () => {
  const f = fixture(); let j = await EventJournal.open(f.file);
  try {
    j.ensure('a.ts', ''); j.session(true, 1000);
    j.apply('a.ts', { start: 0, deleteCount: 0, insert: 'abcdefghij' }, 1100);
    j.apply('a.ts', { start: 0, deleteCount: 10, insert: '' }, 1200);
    await assert.rejects(EventJournal.open(f.file), /in use/);
    j.close(); j = await EventJournal.open(f.file);
    j.ensure('b.ts', ''); j.apply('b.ts', { start: 0, deleteCount: 0, insert: 'abcdefghij' }, 1300);
    assert.equal(j.engine.files.get('b.ts')!.segments[0].score, 0.84);
    assert.equal(j.engine.files.get('a.ts')!.edits, 2);
  } finally { j.close(); f.clean(); }
});
test('rejects altered, deleted, duplicated, reordered and partially written events', async () => {
  const f = fixture(); const j = await EventJournal.open(f.file);
  j.ensure('a.ts', 'abc'); j.session(true, 1000); j.apply('a.ts', { start: 3, deleteCount: 0, insert: 'd' }, 1100); j.close();
  const source = fs.readFileSync(f.file, 'utf8'); const lines = source.trimEnd().split('\n');
  try {
    for (const bad of [lines.slice(0, 2).concat(lines.slice(3)), [lines[0], lines[2], lines[1], lines[3]], [...lines, lines[3]]]) {
      fs.writeFileSync(f.file, bad.join('\n') + '\n'); await assert.rejects(replayJournal(f.file));
    }
    const records = lines.map(s => JSON.parse(s)); records[3].edit.inserted = 'fake';
    fs.writeFileSync(f.file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    await assert.rejects(replayJournal(f.file), /hash/);
    records[3].eventHash = eventHash(records[3]);
    fs.writeFileSync(f.file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    await assert.rejects(replayJournal(f.file), /afterHash/);
    fs.writeFileSync(f.file, source.slice(0, -1)); await assert.rejects(replayJournal(f.file), /incomplete/);
  } finally { f.clean(); }
});
test('receipt prefix accepts later events, rejects truncation and wrong identity', async () => {
  const f = fixture(); const j = await EventJournal.open(f.file);
  try {
    j.ensure('a.ts', 'abc'); const commitment = j.commitment();
    j.session(true, 1000); j.apply('a.ts', { start: 3, deleteCount: 0, insert: 'd' }, 1100);
    assert.equal(textOf((await replayJournal(f.file, commitment)).engine.files.get('a.ts')!), 'abc');
    await assert.rejects(replayJournal(f.file, { ...commitment, logId: 'wrong' }));
    await assert.rejects(replayJournal(f.file, { ...commitment, eventCount: 999 }));
    await assert.rejects(replayJournal(f.file, { ...commitment, tip: 'f'.repeat(64) }));
  } finally { j.close(); f.clean(); }
});
test('failed append blocks later writes and commitment issuance', async () => {
  const f = fixture(); const j = await EventJournal.open(f.file);
  try {
    j.ensure('a.ts', '');
    fs.truncateSync(f.file, 0);
    assert.throws(() => j.session(true), /changed/);
    assert.throws(() => j.commitment(), /unavailable/);
    assert.throws(() => j.ensure('b.ts', ''), /unavailable/);
  } finally { j.close(); f.clean(); }
});

test('committed prefix must end with a complete JSONL record', async () => {
  const f = fixture(); const j = await EventJournal.open(f.file);
  j.ensure('a.ts', 'abc'); const commitment = j.commitment(); j.close();
  try {
    const contents = fs.readFileSync(f.file, 'utf8');
    fs.writeFileSync(f.file, contents.slice(0, -1));
    await assert.rejects(replayJournal(f.file, commitment), /incomplete/);
  } finally { f.clean(); }
});

test('two hosts recovering a dead owner cannot both acquire the journal', async () => {
  const { spawn } = await import('node:child_process');
  const f = fixture(); const j = await EventJournal.open(f.file); j.close();
  fs.writeFileSync(f.file + '.lock', JSON.stringify({ pid: 2147483647, token: 'dead' }));
  const child = `
    const fs = require('node:fs');
    const original = fs.readFileSync;
    fs.readFileSync = function(name, ...args) {
      const value = original.call(this, name, ...args);
      if (name === process.argv[1] + '.lock' && String(value).includes('2147483647')) {
        process.stdout.write('reading\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
      }
      return value;
    };
    const { EventJournal } = require(process.argv[3]);
    EventJournal.open(process.argv[1]).then(j => {
      process.stdout.write('open\\n');
      setTimeout(() => { j.close(); }, 1000);
    }).catch(e => { process.stdout.write('blocked\\n'); });
  `;
  const launch = (delay: number) => {
    const p = spawn(process.execPath, ['-e', child, f.file, String(delay), path.join(__dirname, 'event-log.js')]);
    let output = '';
    const ready = new Promise<void>(resolve => p.stdout.on('data', data => { output += data; if (output.includes('reading')) resolve(); }));
    const done = new Promise<string>((resolve, reject) => { p.on('error', reject); p.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Child exited ${code}`))); });
    return { ready, done };
  };
  try {
    const a = launch(500); await a.ready;
    const b = launch(800);
    const outputs = await Promise.all([a.done, b.done]);
    assert.equal(outputs.filter(o => o.includes('open')).length, 1, outputs.join(' | '));
    assert.equal(outputs.filter(o => o.includes('blocked')).length, 1);
  } finally { f.clean(); }
});

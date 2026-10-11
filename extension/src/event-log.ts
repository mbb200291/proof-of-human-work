/** Local replayable evidence. Source text never belongs in a public receipt. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Edit, EditingEngine, sha256, textOf } from './core';
import { canonicalJson } from './proof';

export const LOG_SCHEMA = 'pohw-event-log/v1';
export interface LogHeader {
  schema: typeof LOG_SCHEMA; logId: string; algorithm: 'rule-based-v0.1'; offsetUnits: 'utf-16';
}
export interface LogCommitment {
  schema: typeof LOG_SCHEMA; logId: string; algorithm: 'rule-based-v0.1'; eventCount: number; tip: string;
}
export interface LogEvent {
  seq: number; prevHash: string; timestamp: string; file: string | null;
  kind: 'baseline' | 'edit' | 'external' | 'save' | 'session-start' | 'session-stop';
  beforeHash: string | null; edit: { offset: number; deleted: number; inserted: string } | null;
  afterHash: string | null; eventHash: string;
}
export function eventHash(event: LogEvent): string {
  const { eventHash: _hash, ...body } = event;
  return sha256(canonicalJson(body));
}
function keys(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === expected.sort().join(',');
}
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function validateHeader(h: LogHeader): void {
  if (!h || !keys(h, ['schema', 'logId', 'algorithm', 'offsetUnits']) || h.schema !== LOG_SCHEMA ||
      h.algorithm !== 'rule-based-v0.1' || h.offsetUnits !== 'utf-16' ||
      typeof h.logId !== 'string' || !/^[a-f0-9-]{36}$/.test(h.logId)) throw new Error('Unsupported event log header');
}
export function validCommitment(c: LogCommitment): boolean {
  return !!c && keys(c, ['schema', 'logId', 'algorithm', 'eventCount', 'tip']) && c.schema === LOG_SCHEMA &&
    c.algorithm === 'rule-based-v0.1' && typeof c.logId === 'string' && /^[a-f0-9-]{36}$/.test(c.logId) &&
    Number.isSafeInteger(c.eventCount) && c.eventCount >= 0 && digest(c.tip);
}
export class EventReplay {
  engine = new EditingEngine();
  seq = 0;
  tip: string;
  active = false;
  startedAt: string | null = null;
  stoppedAt: string | null = null;
  recent: LogEvent[] = [];
  constructor(readonly header: LogHeader) { validateHeader(header); this.tip = sha256(canonicalJson(header)); }
  commitment(): LogCommitment {
    return { schema: LOG_SCHEMA, logId: this.header.logId, algorithm: this.header.algorithm, eventCount: this.seq, tip: this.tip };
  }
  accept(e: LogEvent): void {
    if (!e || !keys(e, ['seq', 'prevHash', 'timestamp', 'file', 'kind', 'beforeHash', 'edit', 'afterHash', 'eventHash']) ||
        !Number.isSafeInteger(e.seq) || e.seq !== this.seq + 1 || e.prevHash !== this.tip) throw new Error('Event sequence/prevHash mismatch');
    if (!digest(e.eventHash) || e.eventHash !== eventHash(e)) throw new Error('Event hash mismatch');
    if (typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp)) || new Date(e.timestamp).toISOString() !== e.timestamp) throw new Error('Invalid event timestamp');
    const at = Date.parse(e.timestamp);
    if (e.kind === 'session-start' || e.kind === 'session-stop') {
      if (e.file !== null || e.beforeHash !== null || e.afterHash !== null || e.edit !== null ||
          (e.kind === 'session-start') === this.active) throw new Error('Invalid session boundary');
      this.active = e.kind === 'session-start';
      if (this.active) { this.startedAt = e.timestamp; this.stoppedAt = null; }
      else this.stoppedAt = e.timestamp;
    } else {
      if (typeof e.file !== 'string' || !e.file || e.file.includes('\\') || e.file.includes('\0') ||
          e.file.startsWith('/') || /^[A-Za-z]:/.test(e.file) || e.file.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Invalid event file');
      if (!digest(e.beforeHash) || !digest(e.afterHash)) throw new Error('Invalid content hash');
      const f = this.engine.files.get(e.file);
      if (e.kind === 'baseline') {
        if (f || e.beforeHash !== sha256('')) throw new Error('Invalid baseline');
      } else if (!f || f.hash !== e.beforeHash) throw new Error('beforeHash mismatch');
      if (e.kind === 'save') {
        if (e.edit !== null || e.afterHash !== e.beforeHash) throw new Error('Invalid save');
        f!.saves++;
      } else if (['baseline', 'edit', 'external'].includes(e.kind)) {
        const edit = e.edit;
        if (!edit || !keys(edit, ['offset', 'deleted', 'inserted']) || !Number.isSafeInteger(edit.offset) ||
            !Number.isSafeInteger(edit.deleted) || edit.offset < 0 || edit.deleted < 0 || typeof edit.inserted !== 'string') throw new Error('Invalid edit range');
        const before = f ? textOf(f) : '';
        if (edit.offset + edit.deleted > before.length || (e.kind === 'baseline' && (edit.offset !== 0 || edit.deleted !== 0))) throw new Error('Invalid edit range');
        const after = before.slice(0, edit.offset) + edit.inserted + before.slice(edit.offset + edit.deleted);
        if (sha256(after) !== e.afterHash) throw new Error('afterHash mismatch');
        if (e.kind === 'baseline') this.engine.ensure(e.file, after);
        else {
          if (e.kind === 'edit' && !this.active) throw new Error('Editor edit outside active session');
          this.engine.apply(e.file, { start: edit.offset, deleteCount: edit.deleted, insert: edit.inserted }, at, e.kind === 'external');
        }
      } else throw new Error('Unsupported event kind');
    }
    this.seq = e.seq; this.tip = e.eventHash;
    this.recent.push(e); if (this.recent.length > 30) this.recent.shift();
    // This is an optional UI cache, never the evidence journal.
    if (this.engine.events.length > 30) this.engine.events.splice(0, this.engine.events.length - 30);
  }
}

/** A receipt may bind an earlier prefix; its later suffix is outside that claim. */
export async function replayJournal(filename: string, commitment?: LogCommitment): Promise<EventReplay> {
  if (commitment && !validCommitment(commitment)) throw new Error('Invalid event log commitment');
  const input = fs.createReadStream(filename, { encoding: 'utf8' });
  let replay: EventReplay | undefined;
  let pending = '';
  try {
    for await (const chunk of input) {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line) throw new Error('Empty event log line');
        const value = JSON.parse(line);
        if (!replay) {
          replay = new EventReplay(value);
          if (commitment && replay.header.logId !== commitment.logId) throw new Error('Event log identity mismatch');
        } else replay.accept(value);
        if (commitment && replay.seq === commitment.eventCount) {
          if (replay.tip !== commitment.tip) throw new Error('Event log commitment tip mismatch');
          return replay;
        }
      }
    }
    if (pending) throw new Error('Event log has an incomplete final line');
    if (!replay || commitment) throw new Error('Event log is missing the committed prefix');
    return replay;
  } finally { input.destroy(); }
}

/** Single-writer journal; any persistence failure poisons this instance. */
export class EventJournal extends EventReplay {
  private failed = false;
  private closed = false;
  private size: number;
  private constructor(readonly filename: string, state: EventReplay, private fd: number, private lock: string) {
    super(state.header);
    this.engine = state.engine; this.seq = state.seq; this.tip = state.tip; this.recent = state.recent;
    this.active = state.active; this.startedAt = state.startedAt; this.stoppedAt = state.stoppedAt;
    this.size = fs.fstatSync(fd).size;
  }
  static async open(filename: string): Promise<EventJournal> {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const lockPath = filename + '.lock';
    const lock = JSON.stringify({ pid: process.pid, token: randomUUID() });
    try { fs.writeFileSync(lockPath, lock, { flag: 'wx', mode: 0o600 }); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Recovery itself needs an exclusive guard: stale-owner checks alone
      // allow two hosts to delete one another's newly acquired lock.
      const recovery = lockPath + '.recovery';
      let guard: number;
      try { guard = fs.openSync(recovery, 'wx', 0o600); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Event log is in use or lock recovery needs inspection');
        throw e;
      }
      try {
        let owner: { pid?: number } | undefined;
        try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Event log is in use; inspect its lock'); }
        if (owner !== undefined) {
          let dead = false;
          if (owner && Number.isSafeInteger(owner.pid) && owner.pid! > 0) {
            try { process.kill(owner.pid!, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
          }
          if (!dead) throw new Error('Event log is in use by another extension host');
          fs.unlinkSync(lockPath);
        }
        // A normal writer can win this race after stale-lock deletion;
        // exclusive creation preserves its ownership in that case.
        fs.writeFileSync(lockPath, lock, { flag: 'wx', mode: 0o600 });
      } finally { fs.closeSync(guard); fs.unlinkSync(recovery); }
    }
    let fd: number | undefined;
    try {
      try { fs.accessSync(filename); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const header: LogHeader = { schema: LOG_SCHEMA, logId: randomUUID(), algorithm: 'rule-based-v0.1', offsetUnits: 'utf-16' };
        fs.writeFileSync(filename, canonicalJson(header) + '\n', { flag: 'wx', mode: 0o600 });
      }
      const replay = await replayJournal(filename);
      fd = fs.openSync(filename, 'a');
      return new EventJournal(filename, replay, fd, lock);
    } catch (err) {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.readFileSync(lockPath, 'utf8') === lock) fs.unlinkSync(lockPath);
      throw err;
    }
  }
  private healthy(): void { if (this.failed || this.closed) throw new Error('Event log unavailable; recording and receipts are blocked'); }
  override commitment(): LogCommitment { this.healthy(); return super.commitment(); }
  private append(kind: LogEvent['kind'], file: string | null, edit: LogEvent['edit'], at: number): void {
    this.healthy();
    const before = file === null ? null : this.engine.files.get(file);
    const beforeText = before ? textOf(before) : '';
    const e: LogEvent = {
      seq: this.seq + 1, prevHash: this.tip, timestamp: new Date(at).toISOString(), file, kind,
      beforeHash: file === null ? null : sha256(beforeText), edit,
      afterHash: file === null ? null : sha256(edit ? beforeText.slice(0, edit.offset) + edit.inserted + beforeText.slice(edit.offset + edit.deleted) : beforeText),
      eventHash: ''
    };
    e.eventHash = eventHash(e);
    try {
      const disk = fs.statSync(this.filename), opened = fs.fstatSync(this.fd);
      if (disk.size !== this.size || disk.ino !== opened.ino || disk.dev !== opened.dev) throw new Error('Event log changed outside this writer');
      this.accept(e);
      const bytes = Buffer.from(canonicalJson(e) + '\n');
      let written = 0;
      while (written < bytes.length) written += fs.writeSync(this.fd, bytes, written, bytes.length - written);
      this.size += written;
    } catch (err) { this.failed = true; throw err; }
  }
  ensure(file: string, baseline = '', at = Date.now()): void {
    this.healthy();
    if (!this.engine.files.has(file)) this.append('baseline', file, { offset: 0, deleted: 0, inserted: baseline }, at);
  }
  apply(file: string, edit: Edit, at = Date.now(), external = false): void {
    this.ensure(file, '', at);
    this.append(external ? 'external' : 'edit', file, { offset: edit.start, deleted: edit.deleteCount, inserted: edit.insert }, at);
  }
  reconcile(file: string, content: string, at = Date.now()): void {
    this.ensure(file, '', at);
    const old = textOf(this.engine.files.get(file)!);
    if (old === content) return;
    let start = 0, suffix = 0;
    while (start < old.length && start < content.length && old[start] === content[start]) start++;
    while (suffix < old.length - start && suffix < content.length - start && old[old.length - 1 - suffix] === content[content.length - 1 - suffix]) suffix++;
    this.apply(file, { start, deleteCount: old.length - start - suffix, insert: content.slice(start, content.length - suffix) }, at, true);
  }
  save(file: string, at = Date.now()): void { this.ensure(file, '', at); this.append('save', file, null, at); }
  session(active: boolean, at = Date.now()): void { this.append(active ? 'session-start' : 'session-stop', null, null, at); }
  flush(): void { this.healthy(); try { fs.fsyncSync(this.fd); } catch (e) { this.failed = true; throw e; } }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { fs.closeSync(this.fd); } finally {
      const filename = this.filename + '.lock';
      if (fs.readFileSync(filename, 'utf8') === this.lock) fs.unlinkSync(filename);
    }
  }
}

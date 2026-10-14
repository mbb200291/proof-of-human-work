import { createHash } from 'node:crypto';

export type Origin = 'baseline' | 'incremental' | 'bulk' | 'move' | 'external';
export interface Segment { text: string; score: number | null; origin: Origin; createdAt?: number }
export interface Edit { start: number; deleteCount: number; insert: string }
export interface Signal { kind: 'incremental' | 'bulk' | 'move' | 'external'; score: number | null; added: number; removed: number }
export interface StoredFile { path: string; segments: Segment[]; edits: number; saves: number; hash: string }
interface Burst { at: number; start: number; edits: number; intervals: number[] }
interface Revision { at: number; start: number }
export interface FileReport { path: string; score: number | null; coverage: number; units: number; verifiedUnits: number; byOrigin: Record<Origin, number> }
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const textOf = (file: StoredFile): string => file.segments.map(s => s.text).join('');
/** The canonical file hash is materialized only at checkpoints (save/persistence). */
export function fileHash(file: StoredFile): string {
  if (!file.hash) file.hash = sha256(textOf(file));
  return file.hash;
}
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const weightedLength = (s: string): number => s.replace(/\s/g, '').length;
const TYPES: Origin[] = ['baseline', 'incremental', 'bulk', 'move', 'external'];

export function newFile(path: string, text = ''): StoredFile {
  return { path, segments: text ? [{ text, score: null, origin: 'baseline' }] : [], edits: 0, saves: 0, hash: sha256(text) };
}
function coalesce(segments: Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const prev = result[result.length - 1];
    if (prev && prev.origin === s.origin && prev.score === s.score && prev.createdAt === s.createdAt) prev.text += s.text;
    else result.push({ ...s });
  }
  return result;
}
function partition(file: StoredFile, pos: number): number {
  let offset = 0;
  for (let i = 0; i < file.segments.length; i++) {
    const seg = file.segments[i];
    const end = offset + seg.text.length;
    if (pos === offset) return i;
    if (pos < end) {
      const at = pos - offset;
      file.segments.splice(i, 1,
        { ...seg, text: seg.text.slice(0, at) },
        { ...seg, text: seg.text.slice(at) });
      return i + 1;
    }
    offset = end;
  }
  if (pos === offset) return file.segments.length;
  throw new Error(`edit offset ${pos} exceeds file length ${offset}`);
}

export class EditingEngine {
  files = new Map<string, StoredFile>();
  private cuts: Array<{ text: string; segments: Segment[]; at: number }> = [];
  // Bounded behavior state per tracked file; never used as standalone proof.
  private bursts = new Map<string, Burst>();
  private revisions = new Map<string, Revision[]>();
  readonly events: Array<{ path: string; signal: Signal; at: number }> = [];
  private static readonly EVENT_LIMIT = 128;
  private reportCache?: ReturnType<EditingEngine['computeReport']>;
  /** Direct provenance restoration can replace segments without running apply(). */
  invalidateReport(): void { this.reportCache = undefined; }

  constructor(initial: StoredFile[] = []) {
    for (const f of initial) this.files.set(f.path, f);
  }
  ensure(path: string, baseline = ''): StoredFile {
    let f = this.files.get(path);
    if (!f) { f = newFile(path, baseline); this.files.set(path, f); this.invalidateReport(); }
    return f;
  }
  /** Follow file rename without treating it as a new editing event. */
  relocateBehavior(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    const burst = this.bursts.get(oldPath);
    const revisions = this.revisions.get(oldPath);
    this.bursts.delete(oldPath);
    this.revisions.delete(oldPath);
    if (burst) this.bursts.set(newPath, burst);
    if (revisions) this.revisions.set(newPath, revisions);
  }
  /** Event offsets use UTF-16 code units, identical to VS Code rangeOffset. */
  apply(path: string, edit: Edit, at = Date.now(), external = false): Signal {
    const file = this.ensure(path);
    const length = file.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    if (edit.start < 0 || edit.deleteCount < 0 || edit.start + edit.deleteCount > length) {
      throw new Error('edit range outside tracked content');
    }
    const from = partition(file, edit.start);
    const to = partition(file, edit.start + edit.deleteCount);
    const removed = file.segments.slice(from, to).map(s => ({ ...s }));
    const deletedText = removed.map(s => s.text).join('');
    if (deletedText && weightedLength(deletedText) >= 8 && !external) {
      this.cuts.push({ text: deletedText, segments: removed, at });
      if (this.cuts.length > 40) this.cuts.shift();
    }
    let cutIndex = -1;
    if (!external && edit.insert.length >= 8) {
      for (let i = this.cuts.length - 1; i >= 0; i--) {
        if (this.cuts[i].text === edit.insert && at - this.cuts[i].at < 600_000) { cutIndex = i; break; }
      }
    }
    let kind: Signal['kind'];
    let inserted: Segment[];
    let score: number | null;
    if (external) {
      kind = 'external'; score = null;
      inserted = edit.insert ? [{ text: edit.insert, score, origin: kind }] : [];
    } else if (cutIndex >= 0) {
      kind = 'move';
      const [cut] = this.cuts.splice(cutIndex, 1);
      inserted = cut.segments.map(s => ({ ...s }));
      const meaningful = inserted.filter(s => weightedLength(s.text) > 0 && s.score !== null);
      const count = meaningful.reduce((a, s) => a + weightedLength(s.text), 0);
      score = count ? meaningful.reduce((a, s) => a + weightedLength(s.text) * (s.score ?? 0), 0) / count : null;
    } else {
      // Editing behavior evidence, not a calibrated human-authorship probability.
      const size = weightedLength(edit.insert);
      const prev = this.bursts.get(path);
      const gap = prev ? at - prev.at : -1;
      const nearby = !!prev && gap > 0 && gap <= 30_000 &&
        Math.abs(prev.start - edit.start) < 160;
      const burst: Burst = nearby
        ? { at, start: edit.start, edits: Math.min(32, prev.edits + (size ? 1 : 0)),
          intervals: [...prev.intervals.slice(-7), gap] }
        : { at, start: edit.start, edits: size ? 1 : 0, intervals: [] };
      this.bursts.set(path, burst);

      const intervals = burst.intervals;
      const periodic = intervals.length >= 8 && intervals[0] >= 30 &&
        intervals[0] <= 2_000 && intervals.every(ms => Math.abs(ms - intervals[0]) <= 2);
      const tooFast = intervals.length >= 6 &&
        intervals.slice(-6).every(ms => ms <= 12);
      const mechanical = periodic || tooFast;

      // Only a substantive revisit of older attributed text is revision evidence.
      // Previous scores and opaque baseline/external text cannot create this bonus.
      const aged = removed.some(s => s.score !== null &&
        s.createdAt !== undefined && at - s.createdAt >= 60_000);
      const history = (this.revisions.get(path) ?? []).filter(r =>
        at >= r.at && at - r.at < 600_000);
      const repeated = history.some(r => Math.abs(r.start - edit.start) < 64);
      const changed = deletedText.replace(/\s/g, '') !== edit.insert.replace(/\s/g, '');
      const revised = size > 0 && size <= 40 && weightedLength(deletedText) >= 4 &&
        aged && changed && !repeated;
      if (revised) history.push({ at, start: edit.start });
      this.revisions.set(path, history.slice(-32));

      const base = size > 400 ? 0.10 : size > 100 ? 0.18 :
        size > 40 ? 0.32 : size > 12 ? 0.48 : 0.60;
      const continuity = size > 0 && size <= 40 ?
        Math.min(0.16, Math.max(0, burst.edits - 1) * 0.04) : 0;
      score = size ? clamp(Math.min(revised ? 0.88 : 0.76,
        base + continuity + (revised ? 0.12 : 0))) : null;
      // Timing alone is weak evidence: discount, do not categorically label AI.
      if (mechanical && score !== null) score = Math.min(score, 0.45);
      kind = size > 40 ? 'bulk' : 'incremental';
      inserted = edit.insert ? [{
        text: edit.insert, score, origin: kind,
        ...(size ? { createdAt: Math.ceil(at / 60_000) * 60_000 } : {})
      }] : [];
    }
    file.segments.splice(from, to - from, ...inserted);
    file.segments = coalesce(file.segments);
    file.hash = ''; // invalidate until the next save/checkpoint
    file.edits++;
    const signal: Signal = { kind, score, added: edit.insert.length, removed: edit.deleteCount };
    this.events.push({ path, signal, at });
    if (this.events.length > EditingEngine.EVENT_LIMIT) this.events.shift();
    this.invalidateReport();
    return signal;
  }
  /** Reconcile disk changes not represented by editor events (git checkout, agent write, etc). */
  reconcile(path: string, diskText: string, at = Date.now()): boolean {
    const f = this.ensure(path);
    if (textOf(f) === diskText) return false;
    // Conservative: do not attribute unexplained replacements to a human.
    // Preserve identical prefix/suffix and their provenance.
    const old = textOf(f);
    let start = 0;
    while (start < old.length && start < diskText.length && old[start] === diskText[start]) start++;
    let suffix = 0;
    while (suffix < old.length - start && suffix < diskText.length - start &&
      old[old.length - 1 - suffix] === diskText[diskText.length - 1 - suffix]) suffix++;
    this.apply(path, { start, deleteCount: old.length - start - suffix,
      insert: diskText.slice(start, diskText.length - suffix) }, at, true);
    return true;
  }
  report(): { score: number | null; coverage: number; units: number; verifiedUnits: number; files: FileReport[] } {
    return this.reportCache ?? (this.reportCache = this.computeReport());
  }
  private computeReport(): { score: number | null; coverage: number; units: number; verifiedUnits: number; files: FileReport[] } {
    const files: FileReport[] = [];
    let weighted = 0, verifiedUnits = 0, units = 0;
    for (const f of this.files.values()) {
      const byOrigin = Object.fromEntries(TYPES.map(x => [x, 0])) as Record<Origin, number>;
      let total = 0, known = 0, sum = 0;
      for (const s of f.segments) {
        const n = weightedLength(s.text);
        total += n;
        byOrigin[s.origin] += n;
        if (s.score !== null) { known += n; sum += n * s.score; }
      }
      files.push({ path: f.path, score: known ? sum / known : null,
        coverage: total ? known / total : 0, units: total, verifiedUnits: known, byOrigin });
      units += total; verifiedUnits += known; weighted += sum;
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { score: verifiedUnits ? weighted / verifiedUnits : null,
      coverage: units ? verifiedUnits / units : 0, units, verifiedUnits, files };
  }
}

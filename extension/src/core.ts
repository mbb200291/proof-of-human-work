import { createHash } from 'node:crypto';

export type Origin = 'baseline' | 'incremental' | 'bulk' | 'move' | 'external';
export interface Segment { text: string; score: number | null; origin: Origin }
export interface Edit { start: number; deleteCount: number; insert: string }
export interface Signal { kind: 'incremental' | 'bulk' | 'move' | 'external'; score: number | null; added: number; removed: number }
export interface StoredFile { path: string; segments: Segment[]; edits: number; saves: number; hash: string }
export interface FileReport { path: string; score: number | null; coverage: number; units: number; verifiedUnits: number; byOrigin: Record<Origin, number> }
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const textOf = (file: StoredFile): string => file.segments.map(s => s.text).join('');
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
    if (prev && prev.origin === s.origin && prev.score === s.score) prev.text += s.text;
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
  private lastEdit = new Map<string, { at: number; start: number }>();
  readonly events: Array<{ path: string; signal: Signal; at: number }> = [];

  constructor(initial: StoredFile[] = []) {
    for (const f of initial) this.files.set(f.path, f);
  }
  ensure(path: string, baseline = ''): StoredFile {
    let f = this.files.get(path);
    if (!f) { f = newFile(path, baseline); this.files.set(path, f); }
    return f;
  }
  /** Event offsets use UTF-16 code units, identical to VS Code rangeOffset. */
  apply(path: string, edit: Edit, at = Date.now(), external = false): Signal {
    const file = this.ensure(path);
    const before = textOf(file);
    if (edit.start < 0 || edit.deleteCount < 0 || edit.start + edit.deleteCount > before.length) {
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
      // Heuristic *evidence score*, not a calibrated probability of authorship.
      // Large atomic insertions are consistent with paste/code generation.
      const size = weightedLength(edit.insert);
      const prior = this.lastEdit.get(path);
      const nearby = prior && at - prior.at < 120_000 && Math.abs(prior.start - edit.start) < 160;
      score = size > 400 ? 0.10 : size > 100 ? 0.18 : size > 40 ? 0.38 : size > 12 ? 0.60 : 0.84;
      if (size <= 12 && nearby) score += 0.10;
      // A small, local revision adds weak process evidence, never certainty.
      if (edit.deleteCount > 0 && size <= 40) score += 0.04;
      score = clamp(score);
      kind = size > 40 ? 'bulk' : 'incremental';
      inserted = edit.insert ? [{ text: edit.insert, score, origin: kind }] : [];
    }
    file.segments.splice(from, to - from, ...inserted);
    file.segments = coalesce(file.segments);
    file.hash = sha256(textOf(file));
    file.edits++;
    this.lastEdit.set(path, { at, start: edit.start });
    const signal: Signal = { kind, score, added: edit.insert.length, removed: edit.deleteCount };
    this.events.push({ path, signal, at });
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

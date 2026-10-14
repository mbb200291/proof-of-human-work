/** Commit-bound code span provenance. Receipts contain spans, not source text. */
import { execFileSync } from 'node:child_process';
import { Origin, Segment, StoredFile, textOf, sha256 } from './core';
import { CodeManifest, ProvenanceSnapshot, SignedReceipt, codeManifestForCommit,
  gitCommitFile, verifySignedReceipt } from './proof';

export function coalesce(parts: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.score === part.score && last.origin === part.origin) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

/** Read the signed compact provenance back into text spans for a particular Git tree. */
export function unpackFile(content: string, spans: ProvenanceSnapshot['files'][number]['spans']): Segment[] {
  const result: Segment[] = [];
  let offset = 0;
  for (const [length, score, origin] of spans) {
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > content.length) throw new Error('Invalid provenance span length');
    result.push({ text: content.slice(offset, offset + length), score, origin });
    offset += length;
  }
  if (offset !== content.length) throw new Error('Provenance does not cover committed code');
  return coalesce(result);
}

export function provenanceSnapshot(manifest: CodeManifest, files: Map<string, Segment[]>): ProvenanceSnapshot {
  return {
    version: 1,
    files: manifest.files.map(f => ({ path: f.path,
      spans: coalesce(files.get(f.path) ?? []).map(s => [s.text.length, s.score, s.origin] as [number,number|null,Origin]) }))
  };
}

export function scoreSnapshot(snapshot: ProvenanceSnapshot, contentByPath: Map<string, string>): {
  units: number; monitoredUnits: number; scorePercent: number | null; coveragePercent: number
} {
  let units = 0, monitoredUnits = 0, weighted = 0;
  for (const file of snapshot.files) {
    const text = contentByPath.get(file.path);
    if (text === undefined) throw new Error('Missing code for signed provenance');
    const parts = unpackFile(text, file.spans);
    for (const part of parts) {
      const n = part.text.replace(/\s/g, '').length;
      units += n;
      if (part.score !== null) { monitoredUnits += n; weighted += n * part.score; }
    }
  }
  return { units, monitoredUnits,
    scorePercent: monitoredUnits ? Math.round(weighted / monitoredUnits * 10000) / 100 : null,
    coveragePercent: units ? Math.round(monitoredUnits / units * 10000) / 100 : 0 };
}

export type ProvenanceCandidate = { commit: string; file: string; content: string; segments: Segment[] };

/** Only exact, unique lines can transfer their attributable spans. Unmatched edits stay unverified. */
export function inheritSpans(target: string, local: Segment[] | null, candidates: ProvenanceCandidate[]): Segment[] {
  // Local editor evidence takes precedence, including conflict-resolution edits captured by the extension.
  const baseline = local && local.map(s => s.text).join('') === target
    ? local.map(s => ({...s})) : (target ? [{ text: target, score: null, origin: 'baseline' as Origin }] : []);
  if (!target || !candidates.length) return coalesce(baseline);
  const lines = (text: string): { text: string; start: number; end: number }[] => {
    const result: {text:string;start:number;end:number}[] = [];
    const regex = /[^\n]*\n|[^\n]+$/g;
    for (const m of text.matchAll(regex)) result.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return result;
  };
  const targetLines = lines(target);
  const targetCounts = new Map<string,number>();
  for (const line of targetLines) targetCounts.set(line.text, (targetCounts.get(line.text) ?? 0) + 1);

  // Splits existing spans at an absolute offset, preserving their origin/score.
  const slice = (parts: Segment[], start: number, end: number): Segment[] => {
    const output: Segment[] = []; let pos = 0;
    for (const s of parts) {
      const a = Math.max(start,pos), b = Math.min(end,pos+s.text.length);
      if (b > a) output.push({ text: s.text.slice(a-pos,b-pos), score:s.score, origin:s.origin });
      pos += s.text.length;
      if (pos >= end) break;
    }
    return output;
  };
  const overlay = (existing:Segment[], addition:Segment[]):Segment[] => {
    const output:Segment[] = []; let ei=0,ai=0,eOff=0,aOff=0;
    while (ei<existing.length && ai<addition.length) {
      const e=existing[ei], a=addition[ai], n=Math.min(e.text.length-eOff,a.text.length-aOff);
      if (n<=0) throw Error('Invalid zero-length overlay');
      output.push({text:e.text.slice(eOff,eOff+n),score:e.score===null?a.score:e.score,
        origin:e.score===null && a.score!==null ? a.origin : e.origin});
      eOff+=n;aOff+=n;
      if(eOff===e.text.length){ei++;eOff=0;}
      if(aOff===a.text.length){ai++;aOff=0;}
    }
    if(ei!==existing.length||ai!==addition.length)throw Error('Mismatched inherited segments');
    return coalesce(output);
  };

  const merged = new Map<number, Segment[]>();
  for (let i=0;i<targetLines.length;i++) merged.set(i, slice(baseline,targetLines[i].start,targetLines[i].end));
  for (const candidate of candidates) {
    if (textOf({segments:candidate.segments} as StoredFile) !== candidate.content) continue;
    const candidateLines=lines(candidate.content);
    const counts=new Map<string,number>();
    for(const line of candidateLines)counts.set(line.text,(counts.get(line.text)??0)+1);
    const sourceLine=new Map<string,{start:number;end:number}>();
    for(const line of candidateLines) if(counts.get(line.text)===1)sourceLine.set(line.text,line);
    for(let i=0;i<targetLines.length;i++) {
      const t=targetLines[i];
      // Full-file exact matches can transfer every span, including braces and short lines.
      if(candidate.content===target) {
        merged.set(i,overlay(merged.get(i)!,slice(candidate.segments,t.start,t.end)));
        continue;
      }
      // For changed files, reject structural boilerplate and ambiguous repetitions.
      if(t.text.replace(/\s/g,'').length<8 || targetCounts.get(t.text)!==1) continue;
      const source=sourceLine.get(t.text);
      if(!source)continue;
      const sourceSegments=slice(candidate.segments,source.start,source.end);
      if(sourceSegments.length) merged.set(i,overlay(merged.get(i)!,sourceSegments));
    }
  }
  return coalesce(targetLines.flatMap((_,i)=>merged.get(i)!));
}

/** Load signed snapshots from parent commits and recent existing evidence (supports squash merges). */
export function loadCandidates(root: string, target: string, publicKey: string, maxRecent=64, includeTarget=false): Map<string,ProvenanceCandidate[]> {
  const buckets=new Map<string,ProvenanceCandidate[]>();
  const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024}).trim();
  const ref='refs/pohw/evidence';
  let evidence='';
  try { evidence=git(['rev-parse',ref]); } catch { /* no local evidence ref */ }
  try {
    git(['fetch','--no-tags','origin','refs/heads/pohw-evidence']);
    const remote=git(['rev-parse','FETCH_HEAD']);
    if(!evidence) evidence=remote;
    else {
      // Prefer local, possibly unpushed evidence when it descends from the remote tip.
      try { git(['merge-base','--is-ancestor',remote,evidence]); }
      catch { evidence=remote; }
    }
  } catch { /* Local evidence remains available when offline. */ }
  if(!evidence) return buckets;
  const targetTime=Number(git(['show','-s','--format=%ct',target]));
  const parents=git(['rev-list','--parents','-n','1',target]).split(/\s+/).slice(1);
  const shas:string[]=[];
  if (includeTarget) shas.push(target);
  for(const p of parents)shas.push(p);
  try {
    const recent=git(['log',`--max-count=${maxRecent}`,'--format=%s',evidence])
      .split('\n').map(s=>/pohw: evidence for ([a-f0-9]{40})/.exec(s)?.[1]).filter((s):s is string=>!!s);
    shas.push(...recent);
  } catch { /* no evidence history */ }
  const cache=new Map<string,CodeManifest>();
  for(const sha of new Set(shas)) {
    if(sha===target && !includeTarget)continue;
    // Do not retroactively attribute an earlier commit to code written in a later commit.
    try { if (Number(git(['show','-s','--format=%ct',sha])) > targetTime) continue; }
    catch { continue; }
    try {
      const raw=git(['show',`${evidence}:receipts/${sha}.json`]);
      const receipt=JSON.parse(raw) as SignedReceipt;
      if(receipt.body.targetCommit!==sha || receipt.body.schema!=='pohw-editing-receipt/v3'||!receipt.body.provenance)continue;
      let manifest=cache.get(sha);
      if(!manifest){manifest=codeManifestForCommit(root,sha);cache.set(sha,manifest);}
      verifySignedReceipt(receipt,publicKey,manifest,root);
      for(const f of receipt.body.provenance.files){
        const content=gitCommitFile(root,sha,f.path);
        if(content===null)continue;
        if(!f.spans.some(s=>s[1]!==null))continue;
        const segments=unpackFile(content,f.spans);
        const list=buckets.get(f.path)??[];
        list.push({commit:sha,file:f.path,content,segments});
        buckets.set(f.path,list);
        const hashKey='@sha256:'+sha256(content);
        const identical=buckets.get(hashKey)??[];
        identical.push({commit:sha,file:f.path,content,segments});
        buckets.set(hashKey,identical);
      }
    } catch { /* Reject corrupted, mismatched or unavailable evidence. */ }
  }
  return buckets;
}

/** Git-detected parent-to-child renames; scores still require signed source spans. */
export function renameSourcesForCommit(root: string, target: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const git = (args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024
  });
  const parents = git(['rev-list', '--parents', '-n', '1', target]).trim().split(/\s+/).slice(1, 9);
  for (const parent of parents) {
    const tokens = git(['diff', '--find-renames=50%', '--name-status', '-z',
      parent, target, '--']).split('\0');
    for (let i = 0; i < tokens.length;) {
      const status = tokens[i++];
      if (!status) continue;
      if (/^R[0-9]{1,3}$/.test(status)) {
        const oldPath = tokens[i++], newPath = tokens[i++];
        if (!oldPath || !newPath) continue;
        const list = result.get(newPath) ?? [];
        if (!list.includes(oldPath)) list.push(oldPath);
        result.set(newPath, list);
      } else if (/^C[0-9]{1,3}$/.test(status)) i += 2;
      else i++;
    }
  }
  return result;
}

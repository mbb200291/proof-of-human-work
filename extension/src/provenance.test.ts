import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Segment } from './core';
import { codeManifestForCommit, createLocalKeys, gitCommitFile, issueReceipt, keyFingerprint,
  ReceiptBody, verifySignedReceipt } from './proof';
import { inheritSpans, loadCandidates, renameSourcesForCommit, provenanceSnapshot, scoreSnapshot } from './provenance';
import { writeEvidenceCommit, pushEvidence } from './evidence-git';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-lineage-'));
  const root = path.join(tmp, 'repo'), remote=path.join(tmp,'remote.git');
  const run = (dir:string,...args:string[]) => execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  fs.mkdirSync(root);
  run(tmp,'init','--bare','-q',remote);
  run(tmp,'init','-q','-b','dev',root);
  run(root,'config','user.name','Tester');run(root,'config','user.email','tester@example.com');
  run(root,'remote','add','origin',remote);
  fs.writeFileSync(path.join(root,'code.ts'),'export function stableImplementation() { return 1; }\n');
  run(root,'add','code.ts');run(root,'commit','-qm','baseline');
  run(root,'push','-u','origin','dev');
  const base=run(root,'rev-parse','HEAD');
  const keys=createLocalKeys();
  function sign(commit:string,files:Map<string,Segment[]>) {
    const manifest=codeManifestForCommit(root,commit);
    const code=new Map<string,string>();
    for(const f of manifest.files)code.set(f.path,gitCommitFile(root,commit,f.path)!);
    const provenance=provenanceSnapshot(manifest,files);
    const metrics=scoreSnapshot(provenance,code);
    const body:ReceiptBody={schema:'pohw-editing-receipt/v3',claim:'self-attested-editor-behavior',
      targetCommit:commit,issuedAt:new Date().toISOString(),keyId:keyFingerprint(keys.publicKeyPem),
      code:{rootHash:manifest.rootHash,files:manifest.files.length,algorithm:manifest.algorithm},
      metrics:{...metrics,algorithm:'rule-based-v0.1'},provenance,
      session:{startedAt:null,endedAt:null,auditTip:'a'.repeat(64)}};
    const receipt=issueReceipt(body,keys.privateKeyPem);
    verifySignedReceipt(receipt,keys.publicKeyPem,manifest,root);
    writeEvidenceCommit(root,receipt,keys.publicKeyPem);
    pushEvidence(root);
    return receipt;
  }
  return {tmp,root,remote,run:(...args:string[])=>run(root,...args),keys,sign,base};
}

const featureText='export function humanFeature() { return "handwritten-func"; }\n';
const devText='export function otherDevelopment() { return "unverified-main"; }\n';

test('merge commit inherits signed feature spans without crediting unknown main changes', () => {
  const env=setup();
  try {
    const {root,run,sign,keys,base}=env;
    run('switch','-c','feature');
    fs.appendFileSync(path.join(root,'code.ts'),featureText);
    run('add','code.ts');run('commit','-qm','feature code');
    const feature=run('rev-parse','HEAD');
    sign(feature,new Map([['code.ts',[
      {text:gitCommitFile(root,feature,'code.ts')!.slice(0,-featureText.length),score:null,origin:'baseline'},
      {text:featureText,score:0.91,origin:'incremental'}
    ]]]));
    // Fast-forward/checkout of an already signed commit restores identical spans.
    const direct=loadCandidates(root,feature,keys.publicKeyPem,16,true).get('code.ts') ?? [];
    const restored=inheritSpans(gitCommitFile(root,feature,'code.ts')!,null,direct);
    assert.equal(restored.find(s=>s.text.includes('humanFeature'))?.score,0.91);
    run('switch','dev');
    // Distinct file added on dev ensures non-fast-forward merge without conflicts.
    fs.writeFileSync(path.join(root,'other.ts'),devText);
    run('add','other.ts');run('commit','-qm','other unverified work');
    run('merge','--no-ff','-m','merge feature','feature');
    const merged=run('rev-parse','HEAD');
    const map=loadCandidates(root,merged,keys.publicKeyPem);
    const code=gitCommitFile(root,merged,'code.ts')!;
    const got=inheritSpans(code,null,map.get('code.ts')??[]);
    assert.equal(got.map(s=>s.text).join(''),code);
    assert.ok(got.some(s=>s.text.includes('humanFeature') && s.score===0.91));
    const all=new Map<string,Segment[]>();
    all.set('code.ts',got);
    all.set('other.ts',inheritSpans(devText,null,map.get('other.ts')??[]));
    const receipt=sign(merged,all);
    assert.ok(receipt.body.metrics.coveragePercent>0);
    assert.ok(receipt.body.metrics.coveragePercent<100);
    const altered=JSON.parse(JSON.stringify(receipt));
    altered.body.provenance.files[0].spans[1][1]=0.99;
    assert.throws(()=>verifySignedReceipt(altered,keys.publicKeyPem,codeManifestForCommit(root,merged),root));
  } finally {fs.rmSync(env.tmp,{recursive:true,force:true});}
});

test('squash merge inherits matching unique feature lines from non-parent signed evidence', () => {
  const env=setup();
  try {
    const {root,run,sign,keys}=env;
    run('switch','-c','feature');
    fs.appendFileSync(path.join(root,'code.ts'),featureText);
    run('add','code.ts');run('commit','-qm','feature code');
    const feature=run('rev-parse','HEAD');
    sign(feature,new Map([['code.ts',[
      {text:gitCommitFile(root,feature,'code.ts')!.slice(0,-featureText.length),score:null,origin:'baseline'},
      {text:featureText,score:0.87,origin:'incremental'}
    ]]]));
    run('switch','dev');
    run('merge','--squash','feature');
    fs.appendFileSync(path.join(root,'code.ts'),devText);
    run('add','code.ts');run('commit','-qm','squash feature with extra unverified lines');
    const squash=run('rev-parse','HEAD');
    const candidates=loadCandidates(root,squash,keys.publicKeyPem);
    const got=inheritSpans(gitCommitFile(root,squash,'code.ts')!,null,candidates.get('code.ts')??[]);
    assert.equal(got.find(s=>s.text.includes('humanFeature'))?.score,0.87);
    assert.equal(got.find(s=>s.text.includes('otherDevelopment'))?.score,null);
    const receipt=sign(squash,new Map([['code.ts',got]]));
    assert.ok(receipt.body.provenance?.files[0].spans.length);
  } finally {fs.rmSync(env.tmp,{recursive:true,force:true});}
});

test('exact file rename preserves provenance without trusting filename', () => {
  const target='export function renamedFileKeepsHistory() { return 12345; }\n';
  const candidate=[{commit:'a'.repeat(40),file:'old-name.ts',content:target,
    segments:[{text:target,score:0.88,origin:'incremental' as const}]}];
  const found=inheritSpans(target,null,candidate);
  assert.equal(found[0].score,0.88);
});

test('conflict resolution keeps local editor evidence and does not score unmatched code', () => {
  const target='export function manuallyResolvedConflict() { return 42; }\n';
  const local:Segment[]=[{text:target,score:0.95,origin:'incremental'}];
  const candidate=[{commit:'a'.repeat(40),file:'file.ts',content:target,
    segments:[{text:target,score:0.35,origin:'bulk' as const}]}];
  const result=inheritSpans(target,local,candidate);
  assert.equal(result[0].score,0.95);
  const unknown='export function newUntrackedCode() { return 100; }\n';
  const unmatched=inheritSpans(unknown,null,candidate);
  assert.equal(unmatched[0].score,null);
});

test('reordered unique lines inherit evidence without copying duplicate boilerplate', () => {
  const source='export function firstUnique() {return 1;}\n}\nexport function secondUnique() {return 2;}\n}\n';
  const candidate=[{commit:'b'.repeat(40),file:'file.ts',content:source,segments:[{text:source,score:0.91,origin:'incremental' as const}]}];
  const target='export function secondUnique() {return 2;}\n}\nexport function firstUnique() {return 1;}\n}\n';
  const result=inheritSpans(target,null,candidate);
  assert.equal(result.map(s=>s.text).join(''),target);
  assert.ok(result.some(s=>s.score===0.91));
  assert.ok(result.some(s=>s.score===null));
});

test('git rename with edits inherits signed unchanged lines, not rewritten lines', () => {
  const env=setup();
  try {
    const {root,run,sign,keys}=env;
    const original=[
      'export const first = "distinct_old_source_111";',
      'export const second = "distinct_old_source_222";',
      'export const third = "distinct_old_source_333";',
      'export const fourth = "distinct_old_source_444";',
      'export const fifth = "distinct_old_source_555";',
      'export const sixth = "distinct_old_source_666";'
    ].join('\n')+'\n';
    fs.writeFileSync(path.join(root,'old.ts'),original);
    run('add','old.ts');run('commit','-qm','tracked original');
    const oldCommit=run('rev-parse','HEAD');
    sign(oldCommit,new Map([
      ['code.ts',[{text:gitCommitFile(root,oldCommit,'code.ts')!,score:null,origin:'baseline'}]],
      ['old.ts',[{text:original,score:0.86,origin:'incremental'}]]
    ]));
    fs.mkdirSync(path.join(root,'lib'));
    run('mv','old.ts','lib/moved.ts');
    const rewritten=original.replace('distinct_old_source_333','distinct_new_source_333');
    fs.writeFileSync(path.join(root,'lib/moved.ts'),rewritten);
    run('add','-A');run('commit','-qm','move and edit');
    const target=run('rev-parse','HEAD');
    const renameHints=renameSourcesForCommit(root,target);
    assert.ok(renameHints.get('lib/moved.ts')?.includes('old.ts'));
    const sourceCandidates=loadCandidates(root,target,keys.publicKeyPem);
    const matched=(renameHints.get('lib/moved.ts')??[])
      .flatMap(oldPath=>sourceCandidates.get(oldPath)??[]);
    const result=inheritSpans(rewritten,null,matched);
    assert.equal(result.map(s=>s.text).join(''),rewritten);
    assert.ok(result.some(s=>s.score===0.86),'unchanged lines must retain score');
    assert.ok(result.some(s=>s.score===null),'modified line must be unverified');
  } finally {fs.rmSync(env.tmp,{recursive:true,force:true});}
});

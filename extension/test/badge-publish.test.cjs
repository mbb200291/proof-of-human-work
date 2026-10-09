const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../templates/pohw-verify.yml'), 'utf8');
assert.match(workflow, /always\(\).*github\.event_name/);
assert.match(workflow, /needs\.verify\.result == 'success'/);

function stepScript(name) {
  const marker = '      - name: ' + name + '\n';
  const index = workflow.indexOf(marker);
  assert.ok(index >= 0, 'missing step ' + name);
  const run = workflow.indexOf('        run: |\n', index);
  assert.ok(run > index, 'missing run for ' + name);
  const start = run + '        run: |\n'.length;
  const end = workflow.indexOf('      - name:', start);
  const body = workflow.slice(start, end < 0 ? undefined : end);
  return body.split('\n').filter(line => line.trim()).map(line => {
    assert.ok(line.startsWith('          '), 'invalid script indentation');
    return line.slice(10);
  }).join('\n') + '\n';
}
const prepare = stepScript('Create badge output');
const publish = stepScript('Publish independent badge branch');
const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

test('publishes unified values on success and removes them after verification failure', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'pohw-badge-test-'));
  const root=path.join(tmp,'source'), remote=path.join(tmp,'origin.git');
  const output=path.join(tmp,'generated'), verified=path.join(tmp,'verified.json');
  fs.mkdirSync(root);
  try {
    execFileSync('git',['init','--bare','-q',remote]);
    execFileSync('git',['init','-q','-b','dev',root]);
    git(root,'config','user.name','Test');
    git(root,'config','user.email','test@example.com');
    git(root,'remote','add','origin',remote);
    fs.writeFileSync(path.join(root,'main.go'),'package main\n');
    git(root,'add','main.go');
    git(root,'commit','-qm','initial');
    git(root,'push','-u','origin','dev');
    const commit=git(root,'rev-parse','HEAD');
    fs.writeFileSync(verified,JSON.stringify({
      verification:'signature-and-content-valid',
      humanScore:86.5,monitoredCoverage:92.3,sourceCommit:commit,
      sourceCodeHash:'a'.repeat(64),issuedAt:'2026-10-09T00:00:00.000Z'
    }));
    const env={...process.env,GITHUB_SHA:commit,GITHUB_REPOSITORY:'demo/repo',
      BADGE_OUTPUT:output,VERIFIED_FILE:verified};
    const run=(state)=>{
      env.VERIFY_RESULT=state;
      execFileSync('bash',['-e','-c',prepare],{cwd:root,env,stdio:['ignore','pipe','pipe']});
      execFileSync('bash',['-e','-c',publish],{cwd:root,env,stdio:['ignore','pipe','pipe']});
      const show=file=>git(tmp,'--git-dir='+remote,'show','refs/heads/pohw-badges:'+file);
      return {show,svg:show('badge.svg'),report:show('REPORT.md')};
    };
    const pass=run('success');
    assert.match(pass.svg,/Human 86\.5% \| Coverage 92\.3%/);
    assert.match(pass.report,/PoHW Verified Editing Report/);
    assert.equal(JSON.parse(pass.show('summary.json')).sourceCommit,commit);
    assert.equal(git(root,'rev-parse','refs/heads/dev'),commit);
    git(root,'switch','dev');
    const fail=run('failure');
    assert.match(fail.svg,/width="1" height="1"/);
    assert.doesNotMatch(fail.svg,/Human 86/);
    assert.match(fail.report,/Evidence Unavailable/);
    assert.throws(()=>fail.show('summary.json'));
    assert.equal(git(root,'rev-parse','refs/heads/dev'),commit);
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});

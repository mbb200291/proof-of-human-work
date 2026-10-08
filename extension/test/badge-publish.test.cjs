const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../templates/pohw-verify.yml'), 'utf8');
const marker = '      - name: Publish verified summary to independent badge branch';
const publishSection = workflow.slice(workflow.indexOf(marker));
assert.ok(publishSection.startsWith(marker), 'missing badge publishing step');
const runMarker = '        run: |\n';
assert.ok(publishSection.includes(runMarker), 'missing publishing script');
const publishScript = publishSection.split(runMarker)[1].split('\n').filter(line => line.trim()).map(line => {
  assert.ok(line.startsWith('          '), 'publishing script indentation changed');
  return line.slice(10);
}).join('\n') + '\n';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('badge publishing creates missing orphan branch and updates existing branch', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pohw-badge-publish-'));
  const repository = path.join(temp, 'repository');
  const remote = path.join(temp, 'remote.git');
  const verifiedFile = path.join(temp, 'verified-summary.json');
  fs.mkdirSync(repository);
  try {
    execFileSync('git', ['init', '--bare', '--quiet', remote]);
    execFileSync('git', ['init', '--quiet', '-b', 'dev', repository]);
    git(repository, 'config', 'user.name', 'Example Developer');
    git(repository, 'config', 'user.email', 'developer@example.com');
    git(repository, 'remote', 'add', 'origin', remote);
    fs.writeFileSync(path.join(repository, 'main.go'), 'package main\n');
    git(repository, 'add', 'main.go');
    git(repository, 'commit', '-qm', 'source code');
    git(repository, 'push', '-u', 'origin', 'dev');
    const sourceSha = git(repository, 'rev-parse', 'HEAD');

    const publish = (summary) => {
      fs.writeFileSync(verifiedFile, JSON.stringify(summary) + '\n');
      execFileSync('bash', ['-e', '-c', publishScript], {
        cwd: repository,
        env: { ...process.env, VERIFIED_FILE: verifiedFile, GITHUB_SHA: sourceSha, GITHUB_REPOSITORY: 'demo/repo' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const published = JSON.parse(git(temp, '--git-dir=' + remote, 'show', 'refs/heads/pohw-badges:summary.json'));
      assert.deepEqual(published, summary);
      const report = git(temp, '--git-dir=' + remote, 'show', 'refs/heads/pohw-badges:REPORT.md');
      assert.match(report, /PoHW Verified Editing Report/);
      assert.match(report, new RegExp(sourceSha));
      assert.match(report, /self-attested/i);
      assert.equal(git(repository, 'rev-parse', 'refs/heads/dev'), sourceSha, 'source branch remains unchanged');
    };

    // Initial publishing used to fail when git switch --orphan left an empty index.
    publish({ humanScore: 86, monitoredCoverage: 92 });
    git(repository, 'switch', 'dev');
    publish({ humanScore: 87, monitoredCoverage: 93 });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
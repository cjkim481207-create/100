import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repo = path.resolve(option('--repo', '.'));
const requireClean = process.argv.includes('--require-clean');
if (!existsSync(path.join(repo, 'package.json')) || !existsSync(path.join(repo, 'lib', 'build.js'))) {
  throw new Error(`Not a photo-daeji repository: ${repo}`);
}

function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

function runNpm(label, args) {
  if (process.platform === 'win32') {
    run(label, process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]);
  } else {
    run(label, 'npm', args);
  }
}

for (const file of [
  'public/app.js',
  'api/analyze.js',
  'api/forms.js',
  'api/render.js',
  'api/xlsx.js',
  'lib/build.js',
  'render-service/server.js',
  'tools/add-form.js',
]) run(`syntax ${file}`, process.execPath, ['--check', file]);

for (const test of ['test:client', 'test:render-setup', 'test:fixed-tabs']) {
  runNpm(test, ['run', test]);
}

for (const template of [
  'templates/template.xlsx',
  'templates/jeongribi-photo.xlsx',
  'templates/jeongribi-photo2.xlsx',
  'templates/yongyeok-photo.xlsx',
]) run(`template ${template}`, process.execPath, ['tools/check.js', '--file', template]);

run('git diff --check', 'git', ['diff', '--check']);
if (requireClean) {
  console.log('\n== clean worktree ==');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', shell: false });
  if (status.error) throw status.error;
  if (status.status !== 0) throw new Error(`git status failed with exit code ${status.status}`);
  if (status.stdout.trim()) throw new Error(`Worktree is not clean:\n${status.stdout.trim()}`);
}
console.log('\nPhoto-daeji repository checks passed.');

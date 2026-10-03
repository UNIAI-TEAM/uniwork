// Linux cloud-only diagnostics; not an application entry or acceptance test.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';

const [operation, revision] = process.argv.slice(2);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const scratch = path.join(root, '.go-tmp/xlsx-failure-probe');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 }).trim();
const rows = read(path.join(directory, 'xlsx-failure-probe.transforms.json'));
const cases = read(path.join(directory, 'xlsx-failure-probe.cases.json'));
const target = file => path.join(root, file);

function preflight() {
  if (process.platform !== 'linux') throw Error('Cloud-only probe refuses this host');
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || git('rev-parse', 'HEAD') !== revision) throw Error('Expected full revision does not match');
  if (rows.length !== 6 || cases.length !== 28 || new Set(rows.map(row => row.file)).size !== 6) throw Error('Diagnostic inventory changed');
  for (const row of rows) {
    if (path.isAbsolute(row.file) || !target(row.file).startsWith(root + path.sep) || row.file.split(/[\\/]/).includes('..')) throw Error('Target escapes checkout');
  }
}

function inventory() {
  const selectors = {};
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [name, command, count] of [['web', 5, 22], ['server', 9, 6]]) {
    const selected = cases.filter(test => test.priorCommand === command);
    if (selected.length !== count) throw Error(`Unexpected ${name} selection count`);
    const selector = '^(?:' + selected.map(test => escape(test.fullName)).join('|') + ')$';
    const expression = new RegExp(selector);
    for (const test of selected) {
      if (!expression.test(test.fullName) || expression.test('extra ' + test.fullName) || expression.test(test.fullName + ' extra')) throw Error('Selector does not match exactly');
    }
    selectors[name] = selector;
  }
  return { selected: cases, selectors };
}

function restore() {
  const file = path.join(scratch, 'backups.json');
  if (!fs.existsSync(file)) throw Error('No owned backup manifest; source restoration unproven');
  const saved = read(file);
  if (saved.revision !== revision || saved.rows.length !== rows.length) throw Error('Backup revision/inventory mismatch');
  for (const [i, backup] of saved.rows.entries()) {
    if (backup.file !== rows[i].file || backup.beforeSha256 !== rows[i].beforeSha256 || backup.afterSha256 !== rows[i].afterSha256 || backup.backup !== path.join(scratch, `backup-${i}`)) throw Error('Backup binding changed');
    const actual = hash(fs.readFileSync(target(backup.file)));
    if (actual !== backup.beforeSha256 && actual !== backup.afterSha256) throw Error(`Independent source change: ${backup.file}`);
    if (hash(fs.readFileSync(backup.backup)) !== backup.beforeSha256) throw Error(`Backup bytes changed: ${backup.file}`);
  }
  for (const backup of saved.rows) {
    fs.writeFileSync(target(backup.file), fs.readFileSync(backup.backup));
    if (hash(fs.readFileSync(target(backup.file))) !== backup.beforeSha256) throw Error(`Restoration mismatch: ${backup.file}`);
    console.log(`XLSX_DIAGNOSTIC_RESTORED ${backup.file} ${backup.beforeSha256}`);
  }
  for (const file of ['applied.ok', 'diagnostic.ts']) if (fs.existsSync(path.join(scratch, file))) fs.unlinkSync(path.join(scratch, file));
  if (git('status', '--porcelain=v1', '--untracked-files=no')) throw Error('Tracked source not clean after restoration');
  console.log(`XLSX_DIAGNOSTIC_FINAL_SHA ${git('rev-parse', 'HEAD')}`);
}

function apply() {
  if (git('status', '--porcelain=v1', '--untracked-files=no')) throw Error('Initial tracked source dirty');
  if (fs.existsSync(path.join(scratch, 'backups.json'))) throw Error('Existing backups refuse overwrite; settle their owner first');
  const pending = rows.map((row, index) => {
    const bytes = fs.readFileSync(target(row.file));
    if (hash(bytes) !== row.beforeSha256) throw Error(`Original bytes mismatch: ${row.file}`);
    let text = bytes.toString('utf8');
    for (const transform of row.ops) {
      if (transform.kind === 'prepend') text = transform.text + text;
      else if (transform.kind === 'append') text += transform.text;
      else if (transform.kind === 'replace') {
        if (text.split(transform.from).length - 1 !== transform.count) throw Error(`Marker count mismatch: ${row.file}`);
        text = text.split(transform.from).join(transform.to);
      } else throw Error('Unknown transform');
    }
    if (hash(text) !== row.afterSha256) throw Error(`Transformed bytes mismatch: ${row.file}`);
    return { ...row, text, bytes, backup: path.join(scratch, `backup-${index}`) };
  });
  fs.mkdirSync(scratch, { recursive: true });
  for (const row of pending) fs.writeFileSync(row.backup, row.bytes);
  fs.writeFileSync(path.join(scratch, 'backups.json'), JSON.stringify({ revision, rows: pending.map(({ file, backup, beforeSha256, afterSha256 }) => ({ file, backup, beforeSha256, afterSha256 })) }, null, 2));
  try {
    const helper = fs.readFileSync(path.join(directory, 'xlsx-failure-probe.helper.txt'));
    fs.writeFileSync(path.join(scratch, 'diagnostic.ts'), helper);
    for (const row of pending) fs.writeFileSync(target(row.file), row.text);
    const patch = execFileSync('git', ['diff', '--no-ext-diff', '--', ...rows.map(row => row.file)], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
    console.log('XLSX_DIAGNOSTIC_PATCH_BEGIN\n' + patch + 'XLSX_DIAGNOSTIC_PATCH_END');
    console.log(`XLSX_DIAGNOSTIC_PATCH_SHA256 ${hash(patch)}`);
    console.log(`XLSX_DIAGNOSTIC_HELPER_SHA256 ${hash(helper)}`);
    console.log(JSON.stringify({ revision, node: process.version, platform: process.platform, release: os.release(), architecture: os.arch(), cpus: os.cpus().length, trackedStatus: git('status', '--porcelain=v1', '--untracked-files=no') }));
    fs.writeFileSync(path.join(scratch, 'applied.ok'), revision);
  } catch (error) {
    restore();
    throw error;
  }
}

function run(name) {
  if (fs.readFileSync(path.join(scratch, 'applied.ok'), 'utf8') !== revision) throw Error('Probe was not applied at this revision');
  for (const row of rows) if (hash(fs.readFileSync(target(row.file))) !== row.afterSha256) throw Error(`Diagnostic source drift: ${row.file}`);
  const { selectors } = inventory();
  const web = name === 'web';
  const args = ['--dir', web ? 'apps/web' : 'apps/office-engine', 'exec', 'vitest', 'run', ...(web ? ['platform/office/xlsx-runtime.test.ts', 'platform/office/draft-key-provider.test.ts'] : ['src/server.test.ts']), '--testNamePattern', selectors[name], '--reporter=verbose', '--maxWorkers=1', '--no-file-parallelism'];
  const environment = { ...process.env };
  delete environment.NODE_ENV;
  delete environment.OPENAI_API_KEY;
  console.log(JSON.stringify({ executable: 'pnpm', args, revision, diagnosticOnly: true }));
  const result = spawnSync('pnpm', args, { cwd: root, env: environment, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.signal) throw Error(`Test subprocess ended by ${result.signal}`);
  process.exitCode = result.status ?? 2;
}

try {
  preflight();
  if (operation === 'inventory') console.log(JSON.stringify(inventory(), null, 2));
  else if (operation === 'apply') apply();
  else if (operation === 'restore') restore();
  else if (operation === 'run-web') run('web');
  else if (operation === 'run-server') run('server');
  else throw Error('Use inventory, apply, run-web, run-server or restore, followed by the expected full revision');
} catch (error) {
  console.error('XLSX_DIAGNOSTIC_PROBE_FAILURE');
  console.error(inspect(error, { depth: null, maxStringLength: null, maxArrayLength: null }));
  process.exitCode = 2;
}

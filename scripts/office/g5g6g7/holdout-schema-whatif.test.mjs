// Tests of the G7-12-SCHEMA offline what-if validator (UNI-1964, review r1 F2-F4).
// Uses synthetic inputs and sentinels only; no holdout case text or run file is read.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SCHEMAS_FILE,
  declaredShapeViolations,
  parseArgs,
  renderWhatif,
  schemaOf,
  strictViolations,
  validateSession,
} from './holdout-schema-whatif.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const whatifCli = path.join(here, 'holdout-schema-whatif.mjs');
const schemasDoc = JSON.parse(fs.readFileSync(DEFAULT_SCHEMAS_FILE, 'utf8'));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g712-whatif-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('holdout-schema-whatif', () => {
  it('refuses --out inside the repo, including through a symlink, and allows an outside temp path (review r1 F2)', (t) => {
    const runsDir = path.join(tmpRoot, 'runs-f2');
    fs.mkdirSync(runsDir, { recursive: true });
    const inRepoOut = path.join(repoRoot, 'docs/office/g5g6g7/whatif-in-repo.md');
    assert.throws(
      () => parseArgs(['--runs', runsDir, '--out', inRepoOut]),
      /inside the repo/,
    );
    assert.throws(
      () => parseArgs(['--runs', runsDir, '--out', inRepoOut, '--allow-in-repo']),
      /unknown argument|--out .* is inside the repo/,
    );

    const allowedOut = path.join(tmpRoot, 'allowed-whatif.md');
    assert.equal(parseArgs(['--runs', runsDir, '--out', allowedOut]).out, allowedOut);

    const link = path.join(tmpRoot, 'link-into-repo');
    try {
      fs.symlinkSync(path.join(repoRoot, 'docs'), link);
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        t.skip(`this host does not permit creating a symlink (${err.code})`);
        return;
      }
      throw err;
    }
    assert.throws(
      () => parseArgs(['--runs', runsDir, '--out', path.join(link, 'whatif-via-link.md')]),
      /inside the repo/,
    );
  });

  it('aggregates undeclared argument keys under unexpected <undeclared-key> and never emits a model-supplied key (review r1 F3)', () => {
    const sentinelKey = 'SYNTHETIC_SENTINEL_UNDECLARED_KEY_91B4';
    const sentinelValue = 'SYNTHETIC_SENTINEL_VALUE_91B4';
    const runsDir = path.join(tmpRoot, 'runs-f3');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'run-01.json'),
      JSON.stringify({
        runIndex: 1,
        asks: [
          {
            id: 'HO-SYNTH-001',
            lang: 'en',
            group: 'other',
            modules: ['pdf'],
            writeLog: [
              {
                name: 'edit_text',
                args: { page: 1, [sentinelKey]: sentinelValue },
              },
            ],
          },
        ],
      }),
      'utf8',
    );

    const pdfEditText = schemaOf(schemasDoc, 'pdf', 'edit_text');
    assert.deepEqual(declaredShapeViolations(pdfEditText, { page: 1, [sentinelKey]: sentinelValue }), [
      { kind: 'missing required', key: 'old_text' },
      { kind: 'missing required', key: 'new_text' },
      { kind: 'unexpected', key: '<undeclared-key>' },
    ]);

    const result = validateSession({ runsDir, schemasDoc, groups: ['other', 'cross'] });
    assert.deepEqual(result.violatedKeys, {
      'pdf/edit_text missing required new_text': 1,
      'pdf/edit_text missing required old_text': 1,
      'pdf/edit_text unexpected <undeclared-key>': 1,
    });
    const rendered = renderWhatif(result, {
      runsDir,
      schemasFile: DEFAULT_SCHEMAS_FILE,
      groups: ['other', 'cross'],
      schemasSha256: '0'.repeat(64),
    });
    assert.ok(!rendered.includes(sentinelKey), 'rendered markdown must not contain the model-supplied key');
    assert.ok(!rendered.includes(sentinelValue), 'rendered markdown must not contain the model-supplied value');
    assert.ok(rendered.includes('pdf/edit_text unexpected <undeclared-key>'));
    assert.ok(rendered.includes('pdf/edit_text missing required old_text'));

    const outMd = path.join(tmpRoot, 'out-f3.md');
    const cli = spawnSync(process.execPath, [whatifCli, '--runs', runsDir, '--out', outMd], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.ok(!cli.stdout.includes(sentinelKey), 'CLI stdout must not contain the model-supplied key');
    assert.ok(!cli.stdout.includes(sentinelValue), 'CLI stdout must not contain the model-supplied value');
    assert.ok(cli.stdout.includes('pdf/edit_text unexpected <undeclared-key>'));
    const written = fs.readFileSync(outMd, 'utf8');
    assert.ok(!written.includes(sentinelKey), 'written report must not contain the model-supplied key');
  });

  it('strictViolations accepts integers for integer and number, rejects fractions for integer, and accepts a valid pdf/edit_text shape (review r1 F4)', () => {
    assert.deepEqual(strictViolations({ type: 'integer' }, 1), []);
    assert.deepEqual(strictViolations({ type: 'integer' }, 1.5), [{ kind: 'type', key: '$' }]);
    assert.deepEqual(strictViolations({ type: 'number' }, 1), []);
    assert.deepEqual(strictViolations({ type: 'number' }, 1.5), []);

    const pdfEditText = schemaOf(schemasDoc, 'pdf', 'edit_text');
    assert.ok(pdfEditText, 'committed schemas carry pdf/edit_text');
    assert.deepEqual(
      strictViolations(pdfEditText, { page: 1, old_text: 'synthetic-old', new_text: 'synthetic-new' }),
      [],
    );
  });
});

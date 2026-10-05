// UNI-926 B4 r4 - the xlsx filter funnel suppression.
//
// The vendored renderer's SheetsFilterRenderController paints a filter funnel
// button in every header cell of a filtered range. UniWork replaces the pinned
// filter panel (en-US only) with its own Advanced Filter dialog, so
// sheet.operation.open-filter-panel stays policy-denied and every funnel would
// be a visible affordance whose click is silently cancelled - a dead click.
// Patch 0007 stubs the funnel painter at the same render-module interception
// point that already stubs the range outline.
//
// This harness applies that patch to a scratch copy of the vendored file (the
// vendored tree itself is provenance-locked) and proves both painters are
// neutralized while unrelated render modules are untouched.
//
// Run: node --test scripts/office/xlsx-renderer-filter-funnel.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const PACKAGE_DIR = path.join(REPO_ROOT, 'packages/office-upstream');
const VENDORED = path.join(PACKAGE_DIR, 'upstream', 'apps/sheets/src/renderer/filter-range-outline.ts');
const PATCH = path.join(PACKAGE_DIR, 'patches', '0007-xlsx-filter-funnel-suppression.patch');
const SCRATCH = path.join(REPO_ROOT, '.go-tmp', 'xlsx-filter-funnel-test');

/** Apply patch 0007 to a scratch copy of the vendored file, as the build does.
 *  The apply runs with the scratch root as cwd and the ceiling one level above
 *  it: git apply silently skips patch paths that resolve outside the current
 *  directory when it walks up to the enclosing repository root (SERIES.md). */
function materializePatchedOutline() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  const upstream = path.join(SCRATCH, 'upstream');
  const target = path.join(upstream, 'apps/sheets/src/renderer/filter-range-outline.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(VENDORED, target);
  const applied = spawnSync('git', ['apply', '-p1', '--whitespace=nowarn', PATCH], {
    cwd: upstream,
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: SCRATCH },
  });
  assert.equal(applied.status, 0, `patch 0007 must apply: ${applied.stderr || applied.stdout}`);
  // Reverse-check: a patch that no longer changes the tree must fail loudly
  // (the same guard the build applies to every series patch).
  const reversed = spawnSync('git', ['apply', '-R', '--check', '-p1', '--whitespace=nowarn', PATCH], {
    cwd: upstream,
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: SCRATCH },
  });
  assert.equal(reversed.status, 0, 'patch 0007 must change the tree (reverse check)');
  return target;
}

/** Bundle the (patched) suppression module with its Univer seam stubbed. */
async function loadSuppression(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    plugins: [{
      name: 'filter-funnel-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^@univerjs\/engine-render$/ }, () => ({ path: 'engine-render', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const IRenderManagerService = "IRenderManagerService";',
        }));
      },
    }],
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

function serviceWithRegistrations() {
  return {
    registered: [],
    registerRenderModule(type, dep) { this.registered.push([type, dep]); return { dispose() {} }; },
  };
}

test('patch 0007 adds the funnel stub beside the range stub', () => {
  const body = fs.readFileSync(materializePatchedOutline(), 'utf8');
  assert.match(
    body,
    /prototype\._renderRange = \(\) => \{\}\r?\n\s*prototype\._renderButtons = \(\) => \{\}/,
    'the patched module stubs both painters at the same interception point',
  );
});

test('the suppression neutralizes the range outline and the funnel buttons', async () => {
  const { installFilterRangeOutlineSuppression } = await loadSuppression(materializePatchedOutline());
  const service = serviceWithRegistrations();
  installFilterRangeOutlineSuppression({ univer: { __getInjector: () => ({ get: () => service }) } });

  class SheetsFilterRenderController {
    _renderRange() { throw new Error('range outline painted'); }
    _renderButtons() { throw new Error('funnel button painted'); }
  }
  service.registerRenderModule('UNIVER_SHEET', [SheetsFilterRenderController]);

  assert.equal(SheetsFilterRenderController.prototype._renderRange(), undefined, 'range outline suppressed');
  assert.equal(SheetsFilterRenderController.prototype._renderButtons(), undefined, 'funnel buttons suppressed');
  assert.equal(service.registered.length, 1, 'the original registration still runs');
});

test('the interception leaves a controller without the funnel painters alone', async () => {
  const { installFilterRangeOutlineSuppression } = await loadSuppression(materializePatchedOutline());
  const service = serviceWithRegistrations();
  installFilterRangeOutlineSuppression({ univer: { __getInjector: () => ({ get: () => service }) } });

  class OtherRenderController {
    _renderButtons() { return 'kept'; }
  }
  service.registerRenderModule('UNIVER_SHEET', [OtherRenderController]);

  assert.equal(OtherRenderController.prototype._renderButtons(), 'kept');
});

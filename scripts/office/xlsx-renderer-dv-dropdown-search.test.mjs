import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// UNI-953: a list dropdown shown while the cell editor is open comes without
// its self-focusing search, so typed text never splits between the two.
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const bundled = await build({
  stdin: { contents: `export * from './dv-dropdown-search';`, resolveDir: renderer, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'univer-stub',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/(core|sheets-ui)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const IEditorBridgeService = "editor-bridge"; export const ISheetCellDropdownManagerService = "cell-dropdown";',
      }));
    },
  }],
});
const mod = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(mod, mod.exports);
const { guardListSearchWhileEditing, installDvDropdownSearchGuard } = mod.exports;

function service() {
  const shown = [];
  return { shown, showDropdown(param) { shown.push(param); return 'popup'; } };
}

test('a list dropdown opened while the cell editor is open has no search', () => {
  const dropdowns = service();
  let editing = true;
  const guard = guardListSearchWhileEditing({ dropdowns, editorVisible: () => editing });
  const props = { options: [], showSearch: true, showEdit: true };
  assert.equal(dropdowns.showDropdown({ type: 'list', props }), 'popup');
  assert.equal(dropdowns.shown[0].props.showSearch, false);
  assert.equal(dropdowns.shown[0].props.showEdit, true);
  assert.equal(props.showSearch, true, 'the caller\'s props are not mutated');
  editing = false;
  dropdowns.showDropdown({ type: 'list', props: { showSearch: true } });
  assert.equal(dropdowns.shown[1].props.showSearch, true, 'opened from the arrow, the search stays');
  editing = true;
  dropdowns.showDropdown({ type: 'datepicker', props: {} });
  assert.deepEqual(dropdowns.shown[2], { type: 'datepicker', props: {} }, 'other dropdown types are untouched');
  guard.dispose();
  dropdowns.showDropdown({ type: 'list', props: { showSearch: true } });
  assert.equal(dropdowns.shown[3].props.showSearch, true, 'dispose restores the service');
});

test('the installer reads the editor bridge and the cell dropdown service from the injector', () => {
  const dropdowns = service();
  const injector = { get: (token) => (token === 'cell-dropdown' ? dropdowns : { isVisible: () => ({ visible: true }) }) };
  installDvDropdownSearchGuard(injector);
  dropdowns.showDropdown({ type: 'list', props: { showSearch: true } });
  assert.equal(dropdowns.shown[0].props.showSearch, false);
});

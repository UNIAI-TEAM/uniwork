import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const result = await build({
  entryPoints: [path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer/fonts.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'test-font-assets', setup(builder) {
    builder.onResolve({ filter: /^@genoffice\/ui\/fonts\// }, (args) => ({ path: args.path, namespace: 'font' }));
    builder.onLoad({ filter: /.*/, namespace: 'font' }, (args) => ({ contents: `export default ${JSON.stringify(args.path)};` }));
  } }],
});
const module = { exports: {} };
new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
const { loadWorkbookFonts } = module.exports;

function fontEnvironment(locals, failAssets = false) {
  const faces = [];
  const probes = [];
  const previous = globalThis.FontFace;
  globalThis.FontFace = class {
    constructor(family, source, descriptors) { Object.assign(this, { family, source, descriptors }); }
    async load() {
      if (this.source.startsWith('local(')) {
        const name = JSON.parse(this.source.slice(6, -1));
        probes.push(name);
        if (!locals.includes(name)) throw new Error('Missing local face');
      } else if (failAssets) throw new Error('Missing bundled font');
      return this;
    }
  };
  // check deliberately claims every face exists; local() probes must decide.
  const document = { fonts: { add: (face) => faces.push(face), check: () => true } };
  return { document, faces, probes, close: () => { globalThis.FontFace = previous; } };
}

test('declared local faces stay intact and theme families are included in the audit', async () => {
  const env = fontEnvironment(['Calibri', 'Verdana', 'Georgia', 'Arial']);
  try {
    const mappings = await loadWorkbookFonts({ styles: [{ fontFamily: 'Calibri' }, { fontFamily: 'Verdana' }],
      themeFonts: { major: 'Georgia', minor: 'Arial' } }, env.document);
    assert.deepEqual(mappings, ['Calibri', 'Verdana', 'Georgia', 'Arial'].map((declared) => ({ declared, used: declared, source: 'local' })));
    assert.equal(env.faces.length, 0);
    assert.deepEqual(env.probes, ['Calibri', 'Verdana', 'Georgia', 'Arial']);
  } finally { env.close(); }
});

test('only missing Calibri receives bundled Carlito and other missing declarations stay intact', async () => {
  const env = fontEnvironment(['Verdana']);
  try {
    const file = { styles: [{ fontFamily: 'Calibri' }, { fontFamily: 'Verdana' }, { fontFamily: 'Missing Custom' }] };
    const mappings = await loadWorkbookFonts(file, env.document);
    assert.deepEqual(mappings, [
      { declared: 'Calibri', used: 'Carlito', source: 'carlito' },
      { declared: 'Verdana', used: 'Verdana', source: 'local' },
      { declared: 'Missing Custom', used: null, source: 'browser-fallback' },
    ]);
    assert.equal(env.faces.length, 2);
    assert.ok(env.faces.every((face) => face.family === 'Calibri'));
    assert.match(env.faces[0].source, /Carlito-Regular/);
    assert.match(env.faces[1].source, /Carlito-Bold/);
    assert.deepEqual(await loadWorkbookFonts(file, env.document), mappings);
    assert.equal(env.faces.length, 2, 'reloading does not register duplicate aliases');
  } finally { env.close(); }
});

test('failed fallback font loads are reported as unresolved browser fallback', async () => {
  const env = fontEnvironment([], true);
  try {
    assert.deepEqual(await loadWorkbookFonts({ styles: [{ fontFamily: 'Calibri' }] }, env.document), [
      { declared: 'Calibri', used: null, source: 'browser-fallback' },
    ]);
    assert.equal(env.faces.length, 0);
  } finally { env.close(); }
});

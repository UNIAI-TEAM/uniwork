// UNI-927 (P0-1) — contract tests for the pptx browser build.
//
//   node --test scripts/office/build-pptx-browser.test.mjs
//
// Runs the real build (provenance -> scratch -> patches -> esbuild), then
// pins three things the browser host depends on:
//   1. the record + artifact surface (no external imports, all symbols),
//   2. the Node-facility shims behave exactly like the node implementations
//      they replace (SHA-256 vs node:crypto, DEFLATE vs node:zlib inflate),
//   3. the artifact opens, edits, saves and reopens a committed fixture deck.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { buildPptxBrowser, PPTX_ARTIFACT_SYMBOLS, PPTX_BROWSER_SHIMS } from './build-pptx-browser.mjs';
import { PATCHES_DIR } from './build-upstream.mjs';
import { PACKAGE_DIR } from './vendor-upstream.mjs';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const DIST = path.join(PACKAGE_DIR, 'dist');
const RECORD_PATH = path.join(DIST, 'pptx-renderer-build.json');
const ARTIFACT_PATH = path.join(DIST, 'pptx-renderer.mjs');
const FIXTURE_PATH = path.join(REPO_ROOT, 'docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx');
const SHIM_VERIFY_DIR = path.join(REPO_ROOT, '.go-tmp', 'pptx-shim-verify');

let record;

before(async () => {
  const result = await buildPptxBrowser();
  assert.ok(result.bytes > 0, 'build produced bytes');
  record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
});

describe('pptx browser build record', () => {
  it('applies the whole patch series fail-loud and records provenance', () => {
    const patchFiles = fs.readdirSync(PATCHES_DIR).filter((file) => file.endsWith('.patch')).sort();
    assert.deepEqual(record.patchesApplied.map((entry) => entry.patch), patchFiles);
    for (const entry of record.patchesApplied) assert.match(entry.sha256, /^[0-9A-F]{64}$/);
    assert.equal(record.kind, 'uniwork-pptx-browser-build');
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    assert.ok(record.gzipBytes > 0 && record.gzipBytes < record.bytes);
  });

  it('bundles engine, ops, render and the UniWork shims, with no external import', () => {
    const inputs = record.inputs;
    for (const suffix of [
      'upstream/packages/pptx-engine/src/index.ts',
      'upstream/packages/pptx-engine/src/zip.ts',
      'upstream/packages/pptx-engine/src/media-insert.ts',
      'upstream/packages/pptx-engine/src/sections.ts',
      'upstream/packages/pptx-ops/src/ops/executor.ts',
      'upstream/packages/pptx-ops/src/op-docs.ts',
      'upstream/packages/pptx-render/src/build-slide.ts',
      'upstream/packages/pptx-render/src/text-layout.ts',
      'shims/pptx-renderer/crypto.ts',
      'shims/pptx-renderer/zlib.ts',
      'shims/pptx-renderer/bidi.ts',
      'shims/pptx-renderer/node-file-io.ts',
    ]) {
      assert.ok(inputs.some((input) => input.endsWith(suffix)), `missing bundled input ${suffix}`);
    }
    assert.deepEqual(record.externalImports, []);
    assert.deepEqual(record.shims.map((shim) => shim.path), PPTX_BROWSER_SHIMS.map((shim) => `packages/office-upstream/${shim}`));
    for (const shim of record.shims) assert.match(shim.sha256, /^[0-9A-F]{64}$/);
  });

  it('the built artifact carries every contract symbol and no node: specifier', () => {
    const artifact = fs.readFileSync(ARTIFACT_PATH, 'utf8');
    for (const symbol of PPTX_ARTIFACT_SYMBOLS) assert.ok(artifact.includes(symbol), `missing symbol ${symbol}`);
    for (const specifier of ['node:crypto', 'node:zlib', 'bidi-js', 'node:fs', 'node:stream/promises']) {
      assert.ok(!artifact.includes(`"${specifier}"`), `artifact still references ${specifier}`);
    }
  });
});

describe('pptx browser shims match the node implementations', () => {
  let shims;

  before(async () => {
    fs.rmSync(SHIM_VERIFY_DIR, { recursive: true, force: true });
    fs.mkdirSync(SHIM_VERIFY_DIR, { recursive: true });
    const shimDir = path.join(SHIM_VERIFY_DIR, 'shims');
    fs.cpSync(path.join(PACKAGE_DIR, 'shims', 'pptx-renderer'), shimDir, { recursive: true });
    // esbuild resolves entry imports as module specifiers, not URLs: a `file://`
    // href fails with "Could not resolve". The copied shims sit beside the
    // entry, so relative specifiers bundle exactly the same files.
    const shim = (file) => `./shims/${file}`;
    const entry = [
      `export { createHash, randomUUID } from ${JSON.stringify(shim('crypto.ts'))};`,
      `export { deflateSync } from ${JSON.stringify(shim('zlib.ts'))};`,
      `export { Buffer } from ${JSON.stringify(shim('buffer.ts'))};`,
      `export { default as bidiFactory } from ${JSON.stringify(shim('bidi.ts'))};`,
      `export { createWriteStream, pipeline } from ${JSON.stringify(shim('node-file-io.ts'))};`,
    ].join('\n');
    const entryPath = path.join(SHIM_VERIFY_DIR, 'entry.mjs');
    fs.writeFileSync(entryPath, entry);
    const outfile = path.join(SHIM_VERIFY_DIR, 'shims.mjs');
    await build({ entryPoints: [entryPath], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    shims = await import(pathToFileURL(outfile).href);
  });

  it('createHash("sha256") matches node:crypto for empty, ascii and unicode input', () => {
    for (const text of ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'Xin chào Việt Nam 🇻🇳']) {
      const mine = shims.createHash('sha256').update(new TextEncoder().encode(text)).digest('hex');
      const node = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      assert.equal(mine, node, `sha256 mismatch for ${JSON.stringify(text.slice(0, 12))}`);
    }
    assert.throws(() => shims.createHash('md5'), /not bound/);
  });

  it('randomUUID produces distinct RFC 4122 v4 ids', () => {
    const first = shims.randomUUID();
    const second = shims.randomUUID();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  });

  it('deflateSync output is a zlib stream node:zlib inflates back', () => {
    const solid = new Uint8Array(680 * (1 + 320 * 3));
    const noisy = new Uint8Array(70000);
    for (let i = 0; i < noisy.length; i += 1) noisy[i] = (i * 2654435761) & 0xff;
    for (const [name, input] of Object.entries({ empty: new Uint8Array(0), text: new TextEncoder().encode('hello hello hello'), solid, noisy })) {
      const compressed = shims.deflateSync(input);
      assert.equal(compressed[0], 0x78, `${name}: zlib CMF`);
      assert.equal(compressed[1], 0x9c, `${name}: zlib FLG`);
      const restored = new Uint8Array(zlib.inflateSync(Buffer.from(compressed)));
      assert.deepEqual(restored, input, `${name}: round trip`);
      assert.ok(compressed.length < input.length + 64, `${name}: real compression`);
    }
  });

  it('the Buffer shim covers the closure operations', () => {
    const { Buffer: ShimBuffer } = shims;
    assert.equal(ShimBuffer.from('Việt').toString('utf8'), 'Việt');
    assert.deepEqual(Array.from(ShimBuffer.from('AQID', 'base64')), [1, 2, 3]);
    assert.equal(ShimBuffer.from(new Uint8Array([0xde, 0xad])).toString('hex'), 'dead');
    assert.equal(ShimBuffer.from(new Uint8Array([1, 2, 3])).toString('base64'), 'AQID');
    const header = ShimBuffer.alloc(8);
    header.writeUInt32BE(0x01020304, 0);
    assert.deepEqual(Array.from(header.slice(0, 4)), [1, 2, 3, 4]);
    assert.equal(ShimBuffer.concat([ShimBuffer.from('ab'), ShimBuffer.from([0x63])]).toString('utf8'), 'abc');
    assert.equal(ShimBuffer.isBuffer(ShimBuffer.alloc(1)), true);
  });

  it('the bidi shim returns per-code-unit levels for ltr, rtl and mixed text', () => {
    const bidi = shims.bidiFactory();
    assert.ok(Array.from(bidi.getEmbeddingLevels('Hello world').levels).every((level) => level === 0));
    assert.ok(Array.from(bidi.getEmbeddingLevels('مرحبا بالعالم').levels).every((level) => level === 1));
    const mixedText = 'Hello مرحبا 42';
    const mixed = bidi.getEmbeddingLevels(mixedText);
    assert.equal(mixed.levels[0], 0);
    assert.equal(mixed.levels[6], 1);
    assert.equal(mixed.levels[13], 2);
    assert.deepEqual(mixed.paragraphs, [{ start: 0, end: mixedText.length, level: 0 }]);
  });

  it('the node file-io shim refuses instead of silently writing nothing', async () => {
    assert.throws(() => shims.createWriteStream(), /not available in the browser/);
    // `pipeline` is async: it rejects rather than throwing synchronously.
    await assert.rejects(() => shims.pipeline(), /not available in the browser/);
  });
});

describe('pptx browser artifact end to end', () => {
  it('opens a committed deck, applies a real op, saves and reopens it', async () => {
    const artifact = await import(pathToFileURL(ARTIFACT_PATH).href);
    const source = fs.readFileSync(FIXTURE_PATH);
    const opened = await artifact.openPptx(new Uint8Array(source));
    assert.ok(opened.deck.slides.length > 0);
    const target = opened.deck.slides[0].elements.find((element) => element.type === 'text' || element.type === 'shape');
    assert.ok(target, 'fixture has a text element');
    const ops = [{ op: 'setText', target: { slide: 0, el: target.id }, paragraphs: [{ runs: [{ text: 'UNI-927 BROWSER EDIT' }] }] }];
    const dry = artifact.runTxn(opened, { dryRun: true, ops });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.failures?.length ?? 0, 0);
    const applied = artifact.runTxn(opened, { ops });
    assert.equal(applied.applied, true);
    assert.ok((applied.records?.length ?? 0) > 0);
    const saved = await artifact.savePptx(opened);
    assert.ok(saved.length > 0);
    artifact.commitSaved(opened);
    const reopened = await artifact.openPptx(saved);
    assert.equal(reopened.deck.slides.length, opened.deck.slides.length);
    const texts = reopened.deck.slides.flatMap((slide) => slide.elements.map((element) => (element.text?.paragraphs ?? []).map((paragraph) => (paragraph.runs ?? []).map((run) => run.text ?? '').join('')).join('\n')));
    assert.ok(texts.some((text) => text.includes('UNI-927 BROWSER EDIT')), 'edited text survives save + reopen');
    const render = artifact.buildRenderSlide(reopened.deck.slides[0], reopened.deck.size, { fitWidthPx: 960, metrics: new artifact.HeuristicMetrics() });
    assert.equal(render.widthPx, 960);
    assert.ok(render.nodes.length > 0);
    assert.ok(artifact.makeViewport(reopened.deck.size, 960).scale > 0);
    assert.equal(typeof artifact.presetPath, 'function');
    assert.ok(Array.isArray(artifact.presetPolygon('triangle', 100, 50)));
    assert.equal(typeof artifact.layoutText, 'function');
    assert.ok(Array.isArray(artifact.listSlideLayouts(reopened.archive)));
  });

  it('fails closed on bytes that are not an OOXML package', async () => {
    const artifact = await import(pathToFileURL(ARTIFACT_PATH).href);
    await assert.rejects(() => artifact.openPptx(new TextEncoder().encode('not a pptx')));
  });

});

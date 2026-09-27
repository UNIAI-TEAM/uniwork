#!/usr/bin/env node
// G2-06b replay executor for md + html (scripts/office/replay-fixtures.mjs
// runs it through the generic executor hook).
//
//   node packages/office-engine/test/replay/g2-06-replay.mjs \
//     --build-dir .go-tmp/office-upstream-build --format md|html \
//     [--fixture <primary G0 fixture>] --out <evidence dir>
//
// It (a) esbuild-bundles the VENDORED upstream sources from the verified
// build tree - after checking their bytes against packages/office-upstream/
// provenance.json - and (b) esbuild-bundles THIS worktree's seam, binds one to
// the other, and runs the G2-06 scenarios on the vendored engine: every G0
// fixture round-trips byte-identically, create blank, edit/save/reopen twice,
// Vietnamese UTF-8, an image path with spaces, save-as rebasing, a no-op
// roundtrip and asset-failure injection. The oracle is independent of the
// engine: bytes by sha256, text by decoding, staged assets against the
// fixture files on disk. Writes <out>/<format>-result.json; exit 0 only when
// every row passes (a missing input is a failure, never a skip).
/* global process, console, TextEncoder, TextDecoder */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const PKG = path.join(REPO_ROOT, 'packages', 'office-engine');
const FIXTURES = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'fixtures');
const PROVENANCE_PATH = path.join(REPO_ROOT, 'packages', 'office-upstream', 'provenance.json');
const PINNED_COMMIT = '09485f884dc845cf3bf27fb7edfe489f9d457aad';

const VENDORED = {
  md: { 'asset-lifecycle': 'apps/markdown/src/main/asset-lifecycle.ts' },
  html: {
    'parse-map': 'apps/html/src/renderer/document/parse-map.ts',
    patch: 'apps/html/src/renderer/document/patch.ts',
    blank: 'apps/html/src/renderer/document/blank.ts',
    'asset-lifecycle': 'apps/html/src/main/asset-lifecycle.ts',
  },
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const utf8 = (s) => new TextEncoder().encode(s);
const text = (bytes) => new TextDecoder().decode(bytes);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

function parseArgs(argv) {
  const out = { buildDir: null, format: null, fixture: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--build-dir') out.buildDir = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else throw new Error('unknown argument: ' + a);
  }
  if (!out.buildDir || !out.format || !out.out) throw new Error('--build-dir, --format and --out are required');
  if (out.format !== 'md' && out.format !== 'html') throw new Error('unsupported --format ' + out.format + ' (this lane owns md + html)');
  return out;
}

class Probe {
  constructor() {
    this.rows = [];
  }
  async row(name, fn) {
    try {
      const proof = await fn();
      this.rows.push({ row: name, status: 'pass', proof: String(proof) });
    } catch (e) {
      this.rows.push({ row: name, status: 'fail', proof: e instanceof Error ? e.message : String(e) });
    }
  }
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

/** In-memory host: committed bytes per document, staging receipts, publishes. */
function store(documentId, initial = {}) {
  const committed = new Map([[documentId, new Map(Object.entries(initial))]]);
  const staged = new Map();
  const s = {
    committed,
    published: [],
    failStage: false,
    source: {
      async read(key) {
        const bytes = committed.get(documentId)?.get(key);
        if (!bytes) throw new Error('missing ' + key);
        return bytes;
      },
    },
    staging: {
      async stage(input) {
        if (s.failStage) throw new Error('staging unavailable (injected)');
        const id = 'stg-' + (staged.size + 1);
        staged.set(id, input.bytes);
        return { staged_id: id };
      },
    },
    async publish(input) {
      committed.set(input.document_id, new Map(input.staged.map((x) => [x.key, staged.get(x.staged_id)])));
      s.published.push(input);
      return { version: s.published.length };
    },
  };
  return s;
}

async function manifestFrom(documentPath, files) {
  const entries = [];
  for (const [key, bytes, mediaType] of files) {
    entries.push({ key, sha256: sha256(bytes), byte_length: bytes.byteLength, media_type: mediaType, origin: 'imported' });
  }
  return { version: 1, document_path: documentPath, entries };
}

async function openOrThrow(engine, input) {
  const outcome = await engine.open(input);
  if (outcome.outcome !== 'opened') throw new Error('open failed: ' + outcome.failure_class);
  return outcome.document_model_ref;
}

async function reopen(engine, st, documentId, format) {
  const last = st.published.at(-1);
  return openOrThrow(engine, { bytes: last.text_bytes, format, document_id: documentId, asset_manifest: last.manifest });
}

function sameBytes(a, b) {
  return sha256(a) === sha256(b);
}

// ── shared scenarios (run for both formats) ──────────────────────────────

async function commonRows({ probe, engine, format, docPath, blankEdit, imageRef, append, rebaseDoc }) {
  const pngName = 'ảnh chụp màn hình.png';

  await probe.row('create blank, edit/save/reopen twice (Vietnamese UTF-8, spaced image path)', async () => {
    const st = store('B1');
    let ref = engine.createBlank({ document_id: 'B1', document_path: docPath }).document_model_ref;
    check((await engine.serialize({ document_model_ref: ref, format })).bytes.byteLength === 0, 'blank is not empty');
    const asset = await engine.addAsset(ref, { name: pngName, bytes: PNG });
    check(asset.key.endsWith('assets/' + pngName), 'asset key ' + asset.key);
    const first = blankEdit(imageRef(asset.reference));
    engine.replaceText(ref, first);
    check(engine.snapshot(ref).references.includes(asset.reference), 'vendored scan does not find the spaced image path');
    await engine.save(ref, st);
    ref = await reopen(engine, st, 'B1', format);
    check(engine.snapshot(ref).text === first, 'first reopen text differs');
    const second = append(first, 'Lần hai: ưu tiên cao — ổn định.');
    engine.replaceText(ref, second);
    await engine.save(ref, st);
    ref = await reopen(engine, st, 'B1', format);
    const saved = st.published.at(-1);
    check(text(saved.text_bytes) === second, 'second save text differs');
    check(engine.snapshot(ref).text === second, 'second reopen text differs');
    check(sameBytes(st.committed.get('B1').get(asset.key), PNG), 'image bytes changed across two saves');
    return `2 saves, text sha ${sha256(saved.text_bytes).slice(0, 12)}, image ${asset.key} kept (${PNG.byteLength} B)`;
  });

  await probe.row('save-as rebases a reference that would escape the new package', async () => {
    const logo = PNG;
    const st = store('S1', { 'shared/logo png.png': logo });
    const manifest = await manifestFrom(rebaseDoc.from, [['shared/logo png.png', logo, 'image/png']]);
    const ref = await openOrThrow(engine, { bytes: utf8(rebaseDoc.text), format, document_id: 'S1', asset_manifest: manifest });
    const { report } = await engine.saveAs(ref, { target_document_id: 'S2', target_document_path: rebaseDoc.to, ...st });
    const saved = text(st.published.at(-1).text_bytes);
    check(saved.includes(rebaseDoc.expect), 'rewritten reference missing: ' + saved);
    check(report.manifest.entries.map((e) => e.key).includes('assets/logo png.png'), 'target key missing');
    check(sameBytes(st.committed.get('S2').get('assets/logo png.png'), logo), 'rebased bytes differ');
    return `${rebaseDoc.from} -> ${rebaseDoc.to}: ${rebaseDoc.expect}`;
  });

  await probe.row('asset failure after text serialisation does not publish', async () => {
    const st = store('F1');
    const ref = engine.createBlank({ document_id: 'F1', document_path: docPath }).document_model_ref;
    const asset = await engine.addAsset(ref, { name: 'a.png', bytes: PNG });
    engine.replaceText(ref, blankEdit(imageRef(asset.reference)));
    const before = engine.snapshot(ref);
    st.failStage = true;
    let error = null;
    await engine.save(ref, st).catch((e) => (error = e));
    check(error && error.code === 'commit_failed', 'save did not fail with commit_failed');
    check(st.published.length === 0, 'a version was published');
    check(JSON.stringify(engine.snapshot(ref)) === JSON.stringify(before), 'session changed on failure');
    st.failStage = false;
    await engine.save(ref, st);
    check(st.published.length === 1 && sameBytes(st.committed.get('F1').get(asset.key), PNG), 'retry did not publish the image');
    return 'commit_failed/asset_stage_failed, 0 publishes; retry publishes 1';
  });
}

// ── md ───────────────────────────────────────────────────────────────────

async function replayMd({ probe, seam, vendored, fixtures }) {
  const engine = seam.createMarkdownEngine({ upstream: seam.bindMarkdownUpstream(vendored) });

  for (const fx of fixtures) {
    await probe.row(`${fx.id}: open + serialize is byte-identical (no-op roundtrip)`, async () => {
      const bytes = fs.readFileSync(path.join(FIXTURES, 'files', fx.path));
      const ref = await openOrThrow(engine, { bytes, format: 'md', document_id: fx.id });
      const out = await engine.serialize({ document_model_ref: ref, format: 'md' });
      check(sameBytes(out.bytes, bytes), 'bytes differ');
      return `${bytes.byteLength} B, sha ${sha256(bytes).slice(0, 12)}, refs ${JSON.stringify(engine.snapshot(ref).references)}`;
    });
  }

  await probe.row('F-MD-FRONTMATTER: front matter survives an edit and a save', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'files', 'text/markdown-frontmatter.md'));
    const st = store('FM');
    const ref = await openOrThrow(engine, { bytes, format: 'md', document_id: 'FM' });
    const fm = engine.frontmatter(ref);
    check(fm !== null, 'front matter not found');
    const original = text(bytes);
    engine.replaceText(ref, original + '\nThêm một dòng.\n');
    await engine.save(ref, st);
    const saved = text(st.published[0].text_bytes);
    check(saved.slice(fm.start, fm.end) === original.slice(fm.start, fm.end), 'front matter changed');
    return `front matter bytes 0..${fm.end} unchanged`;
  });

  await probe.row('F-MD-ASSET: the sibling image resolves and its bytes are carried by a save', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'files', 'text/markdown-local-asset.md'));
    const image = fs.readFileSync(path.join(FIXTURES, 'files', 'text/assets/fixture-image.png'));
    const manifest = await manifestFrom('markdown-local-asset.md', [['assets/fixture-image.png', image, 'image/png']]);
    const st = store('MA', { 'assets/fixture-image.png': image });
    const ref = await openOrThrow(engine, { bytes, format: 'md', document_id: 'MA', asset_manifest: manifest });
    check(engine.snapshot(ref).references.includes('assets/fixture-image.png'), 'vendored scan misses the image');
    await engine.save(ref, st);
    check(sameBytes(st.committed.get('MA').get('assets/fixture-image.png'), image), 'image bytes differ after save');
    return `assets/fixture-image.png ${image.byteLength} B staged and committed`;
  });

  await commonRows({
    probe,
    engine,
    format: 'md',
    docPath: 'document.md',
    blankEdit: (img) => '# Báo cáo tuần\n\nĐã hoàn thành việc kiểm thử.\n\n' + img + '\n',
    imageRef: (ref) => '![Ảnh](<' + ref + '>)',
    append: (t, line) => t + '\n' + line + '\n',
    rebaseDoc: { from: 'notes/a.md', to: 'b.md', text: 'Logo ![l](<../shared/logo png.png>) ở đây.\n', expect: 'assets/logo png.png' },
  });
}

// ── html ─────────────────────────────────────────────────────────────────

async function replayHtml({ probe, seam, vendored, fixtures }) {
  const upstream = seam.bindHtmlUpstream(vendored);
  const engine = seam.createHtmlEngine({ upstream });

  for (const fx of fixtures) {
    await probe.row(`${fx.id}: open + serialize is byte-identical (no-op roundtrip)`, async () => {
      const bytes = fs.readFileSync(path.join(FIXTURES, 'files', fx.path));
      const ref = await openOrThrow(engine, { bytes, format: 'html', document_id: fx.id });
      const out = await engine.serialize({ document_model_ref: ref, format: 'html' });
      check(sameBytes(out.bytes, bytes), 'bytes differ');
      const upstreamImages = vendored.assets.extractDocumentImageSources(text(bytes));
      const refs = engine.snapshot(ref).references;
      check(upstreamImages.every((s) => refs.includes(s)), 'lane scan misses an image the vendored scan finds');
      return `${bytes.byteLength} B, sha ${sha256(bytes).slice(0, 12)}, vendored images ${JSON.stringify(upstreamImages)} within lane refs`;
    });
  }

  await probe.row('F-HTML-VI: vendored parse map, then a patch-set edit saved and reopened', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'files', 'text/html-vietnamese.html'));
    const st = store('HV');
    let ref = await openOrThrow(engine, { bytes, format: 'html', document_id: 'HV' });
    const map = engine.parseMap(ref);
    const heading = map.elements.find((e) => e.tag === 'h1') ?? map.elements.find((e) => /^h[1-6]$/.test(e.tag));
    check(map.elements.length > 0 && heading, 'parse map has no heading');
    const insert = '<p>Đoạn mới do UniWork chèn.</p>';
    const snap = engine.snapshot(ref);
    engine.applyPatchSet(ref, { patches: [{ from: heading.range[1], to: heading.range[1], text: insert }], baseVersion: snap.revision, origin: 'manual', label: 'insert' });
    let stale = null;
    try {
      engine.applyPatchSet(ref, { patches: [], baseVersion: snap.revision, origin: 'ai', label: 'stale' });
    } catch (e) {
      stale = e;
    }
    check(stale && stale.code === 'base_version_mismatch', 'stale patch set was not refused');
    await engine.save(ref, st);
    ref = await reopen(engine, st, 'HV', 'html');
    const saved = text(st.published[0].text_bytes);
    check(saved.includes(insert) && saved.indexOf(insert) === heading.range[1], 'inserted paragraph misplaced');
    check(engine.parseMap(ref).elements.some((e) => e.tag === 'p' && saved.slice(e.range[0], e.range[1]) === insert), 'reopened parse map lacks the paragraph');
    return `${map.elements.length} elements (errors ${map.errorCount}); inserted after <${heading.tag}> at ${heading.range[1]}; stale set refused`;
  });

  await probe.row('F-HTML-ASSET: stylesheet and image carried by a save; the preview copy points them at the proxy', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'files', 'text/html-local-asset.html'));
    const files = [
      ['assets/site.css', fs.readFileSync(path.join(FIXTURES, 'files', 'text/assets/site.css')), 'text/css'],
      ['assets/fixture-image.png', fs.readFileSync(path.join(FIXTURES, 'files', 'text/assets/fixture-image.png')), 'image/png'],
    ];
    const manifest = await manifestFrom('html-local-asset.html', files);
    const st = store('HA', Object.fromEntries(files.map(([k, b]) => [k, b])));
    const ref = await openOrThrow(engine, { bytes, format: 'html', document_id: 'HA', asset_manifest: manifest });
    await engine.save(ref, st);
    for (const [key, b] of files) check(sameBytes(st.committed.get('HA').get(key), b), key + ' bytes differ');
    const proxy = 'https://preview-assets.example/s/HA/';
    const copy = seam.buildHtmlPreviewCopy({
      text: engine.snapshot(ref).text,
      manifest,
      assetUrl: (key) => proxy + encodeURIComponent(key),
      scripts: false,
      csp: "default-src 'none'",
    });
    check(copy.includes(proxy + 'assets%2Fsite.css') && copy.includes(proxy + 'assets%2Ffixture-image.png'), 'preview copy lacks proxy URLs');
    check(text(st.published[0].text_bytes) === text(bytes), 'source changed by the preview');
    return files.map(([k, b]) => `${k} ${b.byteLength} B`).join(', ') + '; preview copy proxied, source unchanged';
  });

  await probe.row('blank HTML document is empty for the vendored blank check', async () => {
    const ref = engine.createBlank({ document_id: 'HB' }).document_model_ref;
    check(engine.isEmpty(ref) === true, 'blank is not empty');
    engine.replaceText(ref, '<p>Xin chào</p>');
    check(engine.isEmpty(ref) === false, 'text reads as empty');
    return 'isDocEmpty true -> false after typing';
  });

  await commonRows({
    probe,
    engine,
    format: 'html',
    docPath: 'index.html',
    blankEdit: (img) => '<!doctype html>\n<h1>Báo cáo tuần</h1>\n<p>Đã hoàn thành việc kiểm thử.</p>\n' + img + '\n',
    imageRef: (ref) => '<img alt="Ảnh" src="' + ref + '">',
    append: (t, line) => t + '<p>' + line + '</p>\n',
    rebaseDoc: {
      from: 'site/pages/p.html',
      to: 'copy.html',
      text: '<div style="background:url(\'../../shared/logo png.png\')"></div><img src="../../shared/logo%20png.png">',
      expect: 'assets/logo png.png',
    },
  });
}

// ── main ─────────────────────────────────────────────────────────────────

async function bundle(esbuild, entry, outfile) {
  await esbuild.build({ ...entry, bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildDir = path.resolve(args.buildDir);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const probe = new Probe();
  const requireRoot = createRequire(path.join(REPO_ROOT, 'package.json'));
  const esbuild = requireRoot('esbuild');
  const upstreamRoot = path.join(buildDir, 'upstream');

  // 1. the vendored sources in the build tree must be the provenance bytes
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  const recorded = new Map((provenance.files ?? []).map((entry) => [entry.path, entry]));
  const sources = {};
  for (const [name, rel] of Object.entries(VENDORED[args.format])) {
    const file = path.join(upstreamRoot, rel);
    check(fs.existsSync(file), `vendored source missing from the build tree: ${rel} (run scripts/office/build-upstream.mjs)`);
    const digest = sha256(fs.readFileSync(file)).toUpperCase();
    const entry = recorded.get(rel);
    check(entry && String(entry.sha256).toUpperCase() === digest, `${rel} does not match provenance.json`);
    sources[name] = { path: rel, sha256: digest.toLowerCase() };
  }

  // 2. bundle the vendored upstream (parse5 resolves from the build tree's install)
  const exportsFor = {
    md: [`export * from ${JSON.stringify('./' + VENDORED.md['asset-lifecycle'])};`],
    html: [
      `export * as parseMap from ${JSON.stringify('./' + VENDORED.html['parse-map'])};`,
      `export * as patch from ${JSON.stringify('./' + VENDORED.html.patch)};`,
      `export * as blank from ${JSON.stringify('./' + VENDORED.html.blank)};`,
      `export * as assets from ${JSON.stringify('./' + VENDORED.html['asset-lifecycle'])};`,
    ],
  };
  const vendoredBundle = path.join(outDir, `${args.format}-vendored-bundle.mjs`);
  const vendored = await bundle(
    esbuild,
    { stdin: { contents: exportsFor[args.format].join('\n'), resolveDir: upstreamRoot, loader: 'ts', sourcefile: 'g2-06-vendored-entry.ts' } },
    vendoredBundle,
  );

  // 3. bundle THIS worktree's seam from the real TS sources
  const seamBundle = path.join(outDir, `${args.format}-seam-bundle.mjs`);
  const seam = await bundle(
    esbuild,
    {
      stdin: {
        contents: [
          `export { createMarkdownEngine, bindMarkdownUpstream } from ${JSON.stringify(path.join(PKG, 'src/markdown/index.ts'))};`,
          `export { createHtmlEngine, bindHtmlUpstream, buildHtmlPreviewCopy } from ${JSON.stringify(path.join(PKG, 'src/html/index.ts'))};`,
        ].join('\n'),
        resolveDir: PKG,
        loader: 'ts',
        sourcefile: 'g2-06-seam-entry.ts',
      },
    },
    seamBundle,
  );

  // 4. scenarios on every G0 fixture of the format
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));
  const fixtures = (manifest.fixtures ?? []).filter((f) => f.format === args.format);
  check(fixtures.length > 0, 'no G0 fixtures for ' + args.format);
  if (args.format === 'md') await replayMd({ probe, seam, vendored, fixtures });
  else await replayHtml({ probe, seam, vendored, fixtures });

  const failed = probe.rows.filter((r) => r.status === 'fail');
  const result = {
    kind: 'uniwork-office-replay-result',
    lane: 'g2-06-markdown-html',
    format: args.format,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail: failed.length === 0 ? `${probe.rows.length} rows passed on the vendored engine` : `${failed.length}/${probe.rows.length} rows failed`,
    rows: probe.rows,
    evidence: {
      upstreamCommit: provenance.upstream?.pinnedCommit ?? provenance.pinnedCommit ?? null,
      expectedCommit: PINNED_COMMIT,
      filesDigest: provenance.integrity?.filesDigest ?? null,
      vendoredSources: sources,
      bundles: { vendored: path.basename(vendoredBundle), seam: path.basename(seamBundle) },
      primaryFixture: args.fixture ? { path: path.relative(REPO_ROOT, path.resolve(args.fixture)), sha256: sha256(fs.readFileSync(args.fixture)) } : null,
      tools: { node: process.version, esbuild: requireRoot('esbuild/package.json').version },
    },
  };
  fs.writeFileSync(path.join(outDir, `${args.format}-result.json`), JSON.stringify(result, null, 2));
  for (const r of probe.rows) console.log(`  ${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.row} - ${r.proof}`);
  console.log(`${args.format}: ${result.detail}; wrote ${path.join(outDir, args.format + '-result.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('replay setup failed: ' + (e?.stack ?? e));
  process.exit(2);
});

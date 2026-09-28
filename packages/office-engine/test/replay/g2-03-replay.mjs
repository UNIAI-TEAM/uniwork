#!/usr/bin/env node
// G2-03b (UNI-686) - vendored-engine replay executor for docx and pptx.
//
// scripts/office/replay-fixtures.mjs invokes this once per format after the
// shared input gate passes:
//   node packages/office-engine/test/replay/g2-03-replay.mjs \
//     --build-dir .go-tmp/office-upstream-build --format docx \
//     --fixture <abs-path> --out <evidence-dir>
//
// The driver (a) esbuild-bundles THIS worktree's adapter seam so the proof
// runs over the real TS sources, (b) binds it to the vendored build artifacts
// through src/{docx,pptx}/vendor.ts, and (c) replays the G0 capability rows,
// verifying every claim with an independent jszip/regex extraction - the
// engine under test never grades its own output.
//
// Artifacts under --out:
//   <format>-result.json        per-row verdicts (read back by replay-fixtures.mjs)
//   <format>-extraction.json    independent package extraction snapshots
//   <format>-render-diff.json   pptx: RenderSlide geometry before/after transform
//   <format>-saved-*.bin        wire bytes per save case
//   version-manifest.json       pinned commit, artifact/fixture hashes, tool versions
// Exit: 0 every row pass / 1 a row failed / 2 setup error.
/* global Buffer, process, console */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const PKG = path.join(REPO_ROOT, 'packages', 'office-engine');
const FIXTURE_FILES = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'fixtures', 'files');
const PROVENANCE_PATH = path.join(REPO_ROOT, 'packages', 'office-upstream', 'provenance.json');
const PINNED_COMMIT = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
const OFFICECRYPTO_VERSION = '0.0.19'; // vendored pnpm-lock pin
const FIXTURE_PASSWORD = 'Password1234_'; // G0 evidence password for the encrypted corpus
const EMU_PER_PX_96 = 9525;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readFx = (rel) => fs.readFileSync(path.join(FIXTURE_FILES, rel));
const artifactSha = (p) => sha256(fs.readFileSync(p));

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
  return out;
}

// ── independent extraction (jszip + regex; never the engine under test) ────

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function docxExtract(JSZip, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  const texts = [...docXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unescapeXml(m[1]));
  const headerXmls = {};
  for (const p of parts.filter((n) => /^word\/header\d*\.xml$/.test(n))) headerXmls[p] = await zip.file(p).async('string');
  return {
    parts,
    texts,
    joined: texts.join('\n'),
    tblCount: (docXml.match(/<w:tbl[ >]/g) || []).length,
    media: parts.filter((p) => p.startsWith('word/media/')),
    charts: parts.filter((p) => p.startsWith('word/charts/')),
    embeddings: parts.filter((p) => p.startsWith('word/embeddings/')),
    headers: Object.keys(headerXmls),
    headerText: Object.values(headerXmls).map((x) => [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unescapeXml(m[1])).join('')),
    footers: parts.filter((p) => /^word\/footer\d*\.xml$/.test(p)),
  };
}

const slideSort = (a, b) => Number(a.match(/slide(\d+)/)?.[1] ?? 0) - Number(b.match(/slide(\d+)/)?.[1] ?? 0);

async function pptxExtract(JSZip, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const presXml = (await zip.file('ppt/presentation.xml')?.async('string')) ?? '';
  const slidePaths = parts.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort(slideSort);
  const slideXmls = {};
  for (const p of slidePaths) slideXmls[p] = await zip.file(p).async('string');
  return {
    parts,
    slidePaths,
    slideCount: slidePaths.length,
    sldIdOrder: [...presXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]),
    slideTexts: Object.fromEntries(
      Object.entries(slideXmls).map(([p, x]) => [p, [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]))]),
    ),
    slideXmls,
    media: parts.filter((p) => p.startsWith('ppt/media/')),
    charts: parts.filter((p) => p.startsWith('ppt/charts/')),
    embeddings: parts.filter((p) => p.startsWith('ppt/embeddings/')),
    layouts: parts.filter((p) => /^ppt\/slideLayouts\/[^/]*\.xml$/.test(p)),
    masters: parts.filter((p) => /^ppt\/slideMasters\/[^/]*\.xml$/.test(p)),
  };
}

/** First <a:off>/<a:ext> inside the shape block for a deck element. The
 * engine's element.id is minted (sp_0); the stable handle in serialized XML
 * is the cNvPr id parsed out of element.anchor.originalXml, with the shape
 * name as fallback. */
function shapeXfrm(slideXml, element) {
  const cnvId = /<p:cNvPr id="(\d+)"/.exec(element?.anchor?.originalXml ?? '')?.[1];
  const markers = [];
  if (cnvId) markers.push('id="' + cnvId + '"');
  if (element?.name) markers.push('name="' + element.name + '"');
  let idx = -1;
  for (const m of markers) {
    idx = slideXml.indexOf(m);
    if (idx >= 0) break;
  }
  if (idx < 0) return null;
  const openTags = ['<p:sp>', '<p:sp ', '<p:pic>', '<p:cxnSp>', '<p:graphicFrame>'];
  const closeFor = { '<p:sp>': '</p:sp>', '<p:sp ': '</p:sp>', '<p:pic>': '</p:pic>', '<p:cxnSp>': '</p:cxnSp>', '<p:graphicFrame>': '</p:graphicFrame>' };
  let start = -1;
  let closeTag = '</p:sp>';
  for (const o of openTags) {
    const i = slideXml.lastIndexOf(o, idx);
    if (i > start) { start = i; closeTag = closeFor[o]; }
  }
  if (start < 0) return null;
  const end = slideXml.indexOf(closeTag, idx);
  const block = slideXml.slice(start, end < 0 ? slideXml.length : end);
  const off = /<a:off\b[^>]*?x="(-?\d+)"[^>]*?y="(-?\d+)"/.exec(block);
  const ext = /<a:ext\b[^>]*?cx="(\d+)"[^>]*?cy="(\d+)"/.exec(block);
  if (!off || !ext) return { found: true, xfrm: null, marker: cnvId ?? element?.name };
  return { found: true, xfrm: { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) }, marker: cnvId ?? element?.name };
}

// ── case runner ──────────────────────────────────────────────────────────

class Probe {
  constructor(format, outDir) {
    this.format = format;
    this.outDir = outDir;
    this.rows = [];
    this.extraction = {};
  }
  save(name, bytes) {
    const file = `${this.format}-saved-${name}.bin`;
    fs.writeFileSync(path.join(this.outDir, file), bytes);
    return file;
  }
  row(row, ok, proof) {
    this.rows.push({ row, status: ok ? 'pass' : 'fail', proof });
    return ok;
  }
  extract(name, data) {
    this.extraction[name] = data;
  }
}

const tinyPng = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

// ── docx rows ────────────────────────────────────────────────────────────

async function replayDocx({ seam, docxEngine, officeCrypto, JSZip, probe, primaryBytes }) {
  const adapter = seam.createDocxAdapter({
    engine: seam.bindDocxEngine(docxEngine, {
      enumerateParts: async (bytes) => Object.keys((await JSZip.loadAsync(bytes)).files),
    }),
    crypto: seam.bindDocxCrypto(officeCrypto),
    sha256: async (b) => sha256(b),
  });
  const openDocx = (bytes, id, extra = {}) => adapter.open({ bytes, format: 'docx', document_id: id, ...extra });
  const serialize = (ref) => adapter.serialize({ document_model_ref: ref, format: 'docx' });

  // docx-open (F-DOCX-SIMPLE or the primary fixture the gate supplied)
  {
    const res = await openDocx(primaryBytes, 'fx-primary');
    const ok = res.outcome === 'opened' && adapter.editableIndexes(res.document_model_ref).length >= 1;
    probe.row('docx-open', ok, `open -> ${res.outcome}; editable paragraphs ${res.outcome === 'opened' ? adapter.editableIndexes(res.document_model_ref).length : 0}`);
    if (res.outcome === 'opened') {
      probe.extract('open-primary', await docxExtract(JSZip, primaryBytes));
      adapter.release(res.document_model_ref);
    }
  }

  // docx-noop-save: upstream saveDocx returns originalBytes when unchanged
  {
    const res = await openDocx(primaryBytes, 'fx-noop');
    if (res.outcome !== 'opened') probe.row('docx-noop-save', false, 'open failed: ' + res.failure_class);
    else {
      const saved = await serialize(res.document_model_ref);
      const identical = sha256(saved.bytes) === sha256(primaryBytes);
      const post = await docxExtract(JSZip, saved.bytes);
      const pre = probe.extraction['open-primary'] ?? (await docxExtract(JSZip, primaryBytes));
      probe.row(
        'docx-noop-save',
        identical && post.joined === pre.joined,
        `wire sha256 ${identical ? '==' : '!='} input; text equal=${post.joined === pre.joined}`,
      );
      adapter.release(res.document_model_ref);
    }
  }

  // docx-edit-text + docx-save-docx (F-DOCX-KITCHEN)
  {
    const bytes = readFx('docs/docx-kitchen-sink.docx');
    const pre = await docxExtract(JSZip, bytes);
    probe.extract('kitchen-pre-edit', { texts: pre.texts });
    const res = await openDocx(bytes, 'fx-kitchen');
    if (res.outcome !== 'opened') {
      probe.row('docx-edit-text', false, 'open failed: ' + res.failure_class);
      probe.row('docx-save-docx', false, 'open failed: ' + res.failure_class);
    } else {
      const ref = res.document_model_ref;
      const marker = 'UNI686_EDIT_' + Date.now().toString(36);
      const idx = adapter.editableIndexes(ref)[0];
      // Texts the edit legitimately replaces = the target block's own runs
      // (a paragraph is one w:p but many w:t fragments).
      const editedBlock = adapter.sessionOf(ref).model.parsed.blocks.find((b) => b.docxIndex === idx);
      const editedTexts = new Set((editedBlock?.runs ?? []).map((r) => r.text));
      adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idx, runs: [{ text: marker }] });
      const saved = await serialize(ref);
      const post = await docxExtract(JSZip, saved.bytes);
      probe.save('kitchen-edit', saved.bytes);
      probe.extract('kitchen-post-edit', { texts: post.texts });
      const markerIn = post.joined.includes(marker);
      const otherTexts = pre.texts.filter((t) => t.trim().length > 0 && !editedTexts.has(t));
      const preserved = otherTexts.every((t) => post.joined.includes(t));
      probe.row('docx-edit-text', markerIn && preserved, `marker present=${markerIn}; ${otherTexts.length} untouched-run texts preserved=${preserved}`);
      probe.row('docx-save-docx', markerIn && saved.bytes.length > 0, `save reopened independently; ${saved.bytes.length} bytes`);
      adapter.release(ref);
    }
  }

  // docx-edit-table-image (F-DOCX-TABLE-IMG): a paragraph edit must not cost
  // the table or the media part; insert_image adds a new media part.
  {
    const bytes = readFx('docs/docx-table-image.docx');
    const pre = await docxExtract(JSZip, bytes);
    const res = await openDocx(bytes, 'fx-table-img');
    if (res.outcome !== 'opened') {
      probe.row('docx-edit-table-image', false, 'open failed: ' + res.failure_class);
    } else {
      const ref = res.document_model_ref;
      const idx = adapter.editableIndexes(ref)[0];
      adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idx, runs: [{ text: 'UNI686_TABLE_CELL_PROBE' }] });
      adapter.edit(ref, {
        op: 'insert_image',
        index: idx + 1,
        image: { base64: tinyPng().toString('base64'), mime: 'image/png', widthPx: 1, heightPx: 1 },
      });
      const saved = await serialize(ref);
      const post = await docxExtract(JSZip, saved.bytes);
      const tableKept = post.tblCount >= pre.tblCount && pre.tblCount >= 1;
      const mediaKept = pre.media.every((m) => post.media.includes(m));
      const imageAdded = post.media.length > pre.media.length;
      probe.row(
        'docx-edit-table-image',
        tableKept && mediaKept && imageAdded,
        `tbl ${pre.tblCount}->${post.tblCount}; media ${pre.media.length}->${post.media.length} (kept=${mediaKept}, added=${imageAdded})`,
      );
      adapter.release(ref);
    }
  }

  // docx-header-footer: set_header_footer must land a real header part
  {
    const res = await openDocx(primaryBytes, 'fx-hf');
    if (res.outcome !== 'opened') probe.row('docx-header-footer', false, 'open failed: ' + res.failure_class);
    else {
      const ref = res.document_model_ref;
      adapter.edit(ref, { op: 'set_header_footer', slot: 'header', hf: { text: 'UNI686_HDR_SENTINEL' } });
      const saved = await serialize(ref);
      const post = await docxExtract(JSZip, saved.bytes);
      const ok = post.headers.length >= 1 && post.headerText.some((t) => t.includes('UNI686_HDR_SENTINEL'));
      probe.row('docx-header-footer', ok, `header parts=${post.headers.join(',') || 'none'}; sentinel=${post.headerText.join('|').includes('UNI686_HDR_SENTINEL')}`);
      adapter.release(ref);
    }
  }

  // docx-content-charts = the unsupported-part oracle: unknown OOXML parts
  // survive an unrelated edit untouched (F-DOCX-CHART)
  {
    const bytes = readFx('docs/docx-chart.docx');
    const pre = await docxExtract(JSZip, bytes);
    const res = await openDocx(bytes, 'fx-chart');
    if (res.outcome !== 'opened') {
      probe.row('docx-unsupported-part', false, 'open failed: ' + res.failure_class);
    } else {
      const ref = res.document_model_ref;
      const warned = (res.warnings ?? []).length > 0;
      const idx = adapter.editableIndexes(ref)[0];
      if (idx !== undefined) adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idx, runs: [{ text: 'UNI686_CHART_PROBE' }] });
      const saved = await serialize(ref);
      const post = await docxExtract(JSZip, saved.bytes);
      const chartsKept = pre.charts.every((c) => post.charts.includes(c)) && pre.charts.length > 0;
      const embedsKept = pre.embeddings.every((e) => post.embeddings.includes(e));
      probe.row(
        'docx-unsupported-part',
        chartsKept && embedsKept && warned,
        `warnings=${warned}; chart parts ${pre.charts.length}->${post.charts.length} kept=${chartsKept}; embeddings kept=${embedsKept}`,
      );
      adapter.release(ref);
    }
  }

  // docx-encrypted-open + docx-encrypted-save (P5) on standard + agile
  for (const [rel, scheme] of [
    ['docs/docx-password-standard.docx', 'standard'],
    ['docs/docx-password-agile.docx', 'agile'],
  ]) {
    const bytes = readFx(rel);
    const detected = seam.isEncryptedOoxml(bytes);
    const noPw = await openDocx(bytes, `fx-enc-${scheme}-nopw`);
    const wrong = await openDocx(bytes, `fx-enc-${scheme}-wrong`, { password: 'definitely-wrong' });
    const good = await openDocx(bytes, `fx-enc-${scheme}`, { password: FIXTURE_PASSWORD });
    probe.row(
      `docx-encrypted-open-${scheme}`,
      detected && noPw.failure_class === 'password_required' && wrong.failure_class === 'wrong_password' && good.outcome === 'opened',
      `detected=${detected}; nopw=${noPw.failure_class}; wrong=${wrong.failure_class}; good=${good.outcome}`,
    );
    if (good.outcome === 'opened') {
      const ref = good.document_model_ref;
      const idx = adapter.editableIndexes(ref)[0];
      if (idx !== undefined) adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idx, runs: [{ text: 'UNI686_P5_' + scheme }] });
      const saved = await serialize(ref);
      const wireEncrypted = seam.isEncryptedOoxml(saved.bytes);
      let roundTrip = false;
      let detail = 'decrypt failed';
      try {
        const plain = await officeCrypto.decrypt(saved.bytes, { password: FIXTURE_PASSWORD });
        const post = await docxExtract(JSZip, plain);
        roundTrip = post.joined.includes('UNI686_P5_' + scheme);
        detail = `marker after decrypt=${roundTrip}`;
      } catch (e) {
        detail = String(e.message ?? e);
      }
      const reopen = await openDocx(saved.bytes, `fx-enc-${scheme}-re`, { password: FIXTURE_PASSWORD });
      probe.row(
        `docx-encrypted-save-${scheme}`,
        wireEncrypted && roundTrip && reopen.outcome === 'opened',
        `wire isEncryptedOoxml=${wireEncrypted}; ${detail}; adapter reopen=${reopen.outcome}`,
      );
      if (reopen.outcome === 'opened') adapter.release(reopen.document_model_ref);
      adapter.release(ref);
    }
  }

  // agile decrypted text must equal its plain sibling (manifest oracle)
  {
    const plain = await docxExtract(JSZip, readFx('docs/docx-password-agile-plain.docx'));
    const decrypted = await officeCrypto.decrypt(readFx('docs/docx-password-agile.docx'), { password: FIXTURE_PASSWORD });
    const dec = await docxExtract(JSZip, decrypted);
    probe.row(
      'docx-encrypted-text-oracle',
      dec.joined === plain.joined,
      `agile decrypted text ${dec.joined === plain.joined ? '==' : '!='} F-DOCX-PWD-AGILE-PLAIN`,
    );
  }

  // docx-two-save: save 2 must patch forward from save 1, not the input
  {
    const res = await openDocx(primaryBytes, 'fx-2save');
    if (res.outcome !== 'opened') probe.row('docx-two-save', false, 'open failed: ' + res.failure_class);
    else {
      const ref = res.document_model_ref;
      const idxs = adapter.editableIndexes(ref);
      adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idxs[0], runs: [{ text: 'UNI686_S1' }] });
      const s1 = await serialize(ref);
      const idxs2 = adapter.editableIndexes(ref);
      adapter.edit(ref, { op: 'set_paragraph_text', docxIndex: idxs2[Math.min(1, idxs2.length - 1)], runs: [{ text: 'UNI686_S2' }] });
      const s2 = await serialize(ref);
      const post = await docxExtract(JSZip, s2.bytes);
      const ok = post.joined.includes('UNI686_S1') && post.joined.includes('UNI686_S2') && s1.checksum !== s2.checksum;
      probe.row('docx-two-save', ok, `S1+S2 markers after second save=${post.joined.includes('UNI686_S1') && post.joined.includes('UNI686_S2')}; checksums differ=${s1.checksum !== s2.checksum}`);
      adapter.release(ref);
    }
  }

  // docx-cancel: released refs serialize as typed not_found, never silence
  {
    const res = await openDocx(primaryBytes, 'fx-cancel');
    let code = null;
    if (res.outcome === 'opened') {
      adapter.release(res.document_model_ref);
      try {
        await serialize(res.document_model_ref);
      } catch (e) {
        code = e.code ?? null;
      }
    }
    probe.row('docx-cancel', code === 'not_found', `released ref serialize threw code=${code}`);
  }

  // docx-open-failures: real engine classes on hostile bytes
  {
    const garbage = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.from('this is not a zip central directory')]);
    const plain = Buffer.from('plain text, not an office file');
    const a = await openDocx(garbage, 'fx-garbage');
    const b = await openDocx(plain, 'fx-plain');
    probe.row(
      'docx-open-failures',
      a.failure_class === 'corrupted' && b.failure_class === 'not_office_file',
      `PK-garbage -> ${a.failure_class}; plain -> ${b.failure_class}`,
    );
  }
}

// ── pptx rows ────────────────────────────────────────────────────────────

async function replayPptx({ seam, pptxEngine, pptxOps, pptxRender, JSZip, probe, primaryBytes }) {
  const render = seam.bindPptxRender(pptxRender);
  const adapter = seam.createPptxAdapter({
    engine: seam.bindPptxEngine(pptxEngine),
    ops: seam.bindPptxOps(pptxOps),
    render,
    sha256: async (b) => sha256(b),
  });
  const openPptx = (bytes, id) => adapter.open({ bytes, format: 'pptx', document_id: id });
  const serialize = (ref) => adapter.serialize({ document_model_ref: ref, format: 'pptx' });
  const deckOf = (ref) => adapter.sessionOf(ref).model.opened.deck;

  const firstTextElement = (ref, slideIndex) => {
    const slide = deckOf(ref).slides[slideIndex];
    const el = (slide?.elements ?? []).find((e) => seam.elementText(e).trim().length > 0);
    return el ?? null;
  };

  // pptx-open + pptx-masters-layouts
  const openRes = await openPptx(primaryBytes, 'fx-pptx-primary');
  if (openRes.outcome !== 'opened') {
    probe.row('pptx-open', false, 'open failed: ' + openRes.failure_class);
    probe.row('pptx-masters-layouts', false, 'open failed: ' + openRes.failure_class);
    probe.row('pptx-edit-text', false, 'open failed');
    probe.row('pptx-edit-shape', false, 'open failed');
    probe.row('pptx-edit-image', false, 'open failed');
    probe.row('pptx-ordering', false, 'open failed');
    probe.row('pptx-save', false, 'open failed');
    probe.row('slides-edit-transform', false, 'open failed');
    probe.row('pptx-noop-save', false, 'open failed');
    probe.row('pptx-two-save', false, 'open failed');
    probe.row('pptx-cancel', false, 'open failed');
    return;
  }
  const preExtract = await pptxExtract(JSZip, primaryBytes);
  probe.extract('pptx-pre-edit', { slideCount: preExtract.slideCount, texts: preExtract.slideTexts, sldIdOrder: preExtract.sldIdOrder });
  const ref = openRes.document_model_ref;
  const slides = deckOf(ref).slides;
  probe.row('pptx-open', slides.length >= 1, `opened with ${slides.length} slide(s); extraction counted ${preExtract.slideCount}`);
  const layoutsBound = typeof pptxEngine.listSlideLayouts === 'function';
  const layoutList = layoutsBound ? pptxEngine.listSlideLayouts(adapter.sessionOf(ref).model.opened.archive) : [];
  probe.row(
    'pptx-masters-layouts',
    preExtract.masters.length >= 1 && preExtract.layouts.length >= 1 && (!layoutsBound || layoutList.length >= 1),
    `masters=${preExtract.masters.length}; layouts=${preExtract.layouts.length}; listSlideLayouts=${layoutList.length}`,
  );

  // pptx-edit-text through the session edit channel
  {
    const el = firstTextElement(ref, 0);
    if (!el) probe.row('pptx-edit-text', false, 'no text element on slide 0');
    else {
      const marker = 'UNI686_PPTX_TEXT';
      adapter.edit(ref, { op: 'edit_text', slideIndex: 0, elementId: el.id, paragraphs: [{ runs: [{ text: marker }] }] });
      const saved = await serialize(ref);
      const post = await pptxExtract(JSZip, saved.bytes);
      probe.save('pptx-text-edit', saved.bytes);
      const inSlide = Object.values(post.slideTexts).some((ts) => ts.join(' ').includes(marker));
      probe.row('pptx-edit-text', inSlide, `marker in reopened slide xml=${inSlide}`);
    }
  }

  // pptx-edit-shape via host:slides-edit-transform + render diff
  {
    const slide0 = deckOf(ref).slides[0];
    const target = (slide0?.elements ?? []).find((e) => e.transform?.offset);
    if (!target) {
      probe.row('slides-edit-transform', false, 'no transformable element on slide 0');
      probe.row('pptx-edit-shape', false, 'no transformable element on slide 0');
    } else {
      const slide1Path = preExtract.slidePaths[0];
      const beforeXfrm = shapeXfrm(preExtract.slideXmls[slide1Path], target);
      const renderBefore = await render.buildRenderSlide(adapter.sessionOf(ref).model.opened, 0, 960);
      const box = { xPx: 40, yPx: 60, wPx: 200, hPx: 120 };
      const resp = await adapter.dispatchHostChannel(ref, 'host:slides-edit-transform', {
        slideIndex: 0,
        sourceId: target.id,
        ...box,
        fitWidthPx: 960,
      });
      const renderAfter = resp;
      const deckW = deckOf(ref).size?.cx ?? 0;
      const scale = 960 / (deckW / EMU_PER_PX_96);
      const expected = {
        x: Math.round((box.xPx / scale) * EMU_PER_PX_96),
        y: Math.round((box.yPx / scale) * EMU_PER_PX_96),
        cx: Math.round((box.wPx / scale) * EMU_PER_PX_96),
        cy: Math.round((box.hPx / scale) * EMU_PER_PX_96),
      };
      const saved = await serialize(ref);
      const post = await pptxExtract(JSZip, saved.bytes);
      probe.save('pptx-transform', saved.bytes);
      const postSlide = post.slidePaths[0];
      const afterXfrm = shapeXfrm(post.slideXmls[postSlide], target);
      const geometryMatches =
        afterXfrm?.xfrm &&
        Math.abs(afterXfrm.xfrm.x - expected.x) <= 2 &&
        Math.abs(afterXfrm.xfrm.y - expected.y) <= 2 &&
        Math.abs(afterXfrm.xfrm.cx - expected.cx) <= 2 &&
        Math.abs(afterXfrm.xfrm.cy - expected.cy) <= 2;
      const renderDiff = {
        target: target.id,
        expectedEmu: expected,
        before: beforeXfrm?.xfrm ?? null,
        after: afterXfrm?.xfrm ?? null,
        renderSlideKeys: Object.keys(renderAfter ?? {}),
      };
      fs.writeFileSync(path.join(probe.outDir, 'pptx-render-diff.json'), JSON.stringify({ renderBefore, renderAfter, ...renderDiff }, null, 2));
      probe.row(
        'slides-edit-transform',
        Boolean(renderAfter) && geometryMatches,
        `channel answered RenderSlide=${Boolean(renderAfter)}; slide xml xfrm ${JSON.stringify(afterXfrm?.xfrm)} vs expected ${JSON.stringify(expected)}`,
      );
      probe.row('pptx-edit-shape', geometryMatches, `cNvPr id=${target.id} xfrm moved to expected EMU`);
    }
  }

  // pptx-edit-image: add_picture must land a new ppt/media part
  {
    const mediaBefore = preExtract.media.length;
    adapter.edit(ref, { op: 'add_image', slideIndex: 0, bytes: tinyPng(), ext: 'png', xPx: 10, yPx: 10, wPx: 20, hPx: 20, fitWidthPx: 960 });
    const saved = await serialize(ref);
    const post = await pptxExtract(JSZip, saved.bytes);
    const added = post.media.length > mediaBefore;
    const kept = preExtract.media.every((m) => post.media.includes(m));
    probe.row('pptx-edit-image', added && kept, `media ${mediaBefore}->${post.media.length} (added=${added}, kept=${kept})`);
  }

  // pptx-ordering: duplicate (if needed) then moveSlide flips sldIdLst order
  {
    let orderBefore = preExtract.sldIdOrder;
    if (deckOf(ref).slides.length < 2) {
      adapter.edit(ref, { op: 'duplicate_slide', slideIndex: 0 });
    }
    const n = deckOf(ref).slides.length;
    adapter.edit(ref, { op: 'move_slide', slideIndex: 0, toIndex: n - 1 });
    const saved = await serialize(ref);
    const post = await pptxExtract(JSZip, saved.bytes);
    const changed = JSON.stringify(post.sldIdOrder) !== JSON.stringify(orderBefore);
    const firstMoved = orderBefore.length >= 2 ? post.sldIdOrder.indexOf(orderBefore[0]) > 0 : post.sldIdOrder.length >= 2;
    probe.row('pptx-ordering', changed && firstMoved && post.slideCount === n, `sldIdLst ${orderBefore.length}->${post.sldIdOrder.length}; first moved later=${firstMoved}; slides=${post.slideCount}`);
  }

  // pptx-save covered by every serialize above; explicit row for the gate
  {
    const saved = await serialize(ref);
    const post = await pptxExtract(JSZip, saved.bytes);
    probe.row('pptx-save', post.slideCount >= 1 && post.slideTexts !== undefined, `reopened saved deck: ${post.slideCount} slide(s), slideTexts extracted`);
  }

  // pptx-charts = unsupported-part oracle (F-PPTX-CHART)
  {
    const bytes = readFx('slides/pptx-chart.pptx');
    const pre = await pptxExtract(JSZip, bytes);
    const res = await openPptx(bytes, 'fx-pptx-chart');
    if (res.outcome !== 'opened') {
      probe.row('pptx-unsupported-part', false, 'open failed: ' + res.failure_class);
    } else {
      const ref2 = res.document_model_ref;
      const warned = (res.warnings ?? []).length > 0;
      const el = (deckOf(ref2).slides[0]?.elements ?? []).find((e) => seam.elementText(e).trim().length > 0);
      if (el) adapter.edit(ref2, { op: 'edit_text', slideIndex: 0, elementId: el.id, paragraphs: [{ runs: [{ text: 'UNI686_CHART_PROBE' }] }] });
      const saved = await serialize(ref2);
      const post = await pptxExtract(JSZip, saved.bytes);
      const chartsKept = pre.charts.every((c) => post.charts.includes(c)) && pre.charts.length > 0;
      const embedsKept = pre.embeddings.every((e) => post.embeddings.includes(e));
      probe.row(
        'pptx-unsupported-part',
        chartsKept && embedsKept && warned,
        `warnings=${warned}; charts ${pre.charts.length}->${post.charts.length}; embeddings kept=${embedsKept}`,
      );
      adapter.release(ref2);
    }
  }

  // pptx-two-save on the primary deck (new session so earlier edits don't leak)
  {
    const res = await openPptx(primaryBytes, 'fx-pptx-2save');
    if (res.outcome !== 'opened') probe.row('pptx-two-save', false, 'open failed: ' + res.failure_class);
    else {
      const ref3 = res.document_model_ref;
      const el = firstTextElement(ref3, 0);
      if (!el) {
        probe.row('pptx-two-save', false, 'no text element to edit');
      } else {
        adapter.edit(ref3, { op: 'edit_text', slideIndex: 0, elementId: el.id, paragraphs: [{ runs: [{ text: 'UNI686_P1' }] }] });
        const s1 = await serialize(ref3);
        adapter.edit(ref3, { op: 'edit_text', slideIndex: 0, elementId: el.id, paragraphs: [{ runs: [{ text: 'UNI686_P2' }] }] });
        const s2 = await serialize(ref3);
        const post = await pptxExtract(JSZip, s2.bytes);
        const has = Object.values(post.slideTexts).some((ts) => ts.join(' ').includes('UNI686_P2'));
        probe.row('pptx-two-save', has && s1.checksum !== s2.checksum, `P2 present=${has}; checksums differ=${s1.checksum !== s2.checksum}`);
      }
      adapter.release(ref3);
    }
  }

  // pptx-noop-save: untouched deck serializes and reopens intact
  {
    const res = await openPptx(primaryBytes, 'fx-pptx-noop');
    if (res.outcome !== 'opened') probe.row('pptx-noop-save', false, 'open failed: ' + res.failure_class);
    else {
      const saved = await serialize(res.document_model_ref);
      const post = await pptxExtract(JSZip, saved.bytes);
      probe.row(
        'pptx-noop-save',
        post.slideCount === preExtract.slideCount && JSON.stringify(Object.values(post.slideTexts).flat()) === JSON.stringify(Object.values(preExtract.slideTexts).flat()),
        `slides ${preExtract.slideCount}->${post.slideCount}; slide texts equal=${JSON.stringify(Object.values(post.slideTexts).flat()) === JSON.stringify(Object.values(preExtract.slideTexts).flat())}`,
      );
      adapter.release(res.document_model_ref);
    }
  }

  // pptx-cancel: released ref -> typed not_found
  {
    const res = await openPptx(primaryBytes, 'fx-pptx-cancel');
    let code = null;
    if (res.outcome === 'opened') {
      adapter.release(res.document_model_ref);
      try {
        await serialize(res.document_model_ref);
      } catch (e) {
        code = e.code ?? null;
      }
    }
    probe.row('pptx-cancel', code === 'not_found', `released ref serialize threw code=${code}`);
  }

  adapter.release(ref);
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildDir = path.resolve(args.buildDir);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const steps = [];

  const provenance = fs.existsSync(PROVENANCE_PATH) ? JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8')) : null;
  const primaryBytes = args.fixture
    ? fs.readFileSync(path.resolve(args.fixture))
    : readFx(args.format === 'docx' ? 'docs/docx-simple.docx' : 'slides/pptx-standard-business.pptx');

  // 1. bundle this lane's adapter seam from the real TS sources
  const requireRoot = createRequire(path.join(REPO_ROOT, 'package.json'));
  const esbuild = requireRoot('esbuild');
  const bundlePath = path.join(outDir, `${args.format}-adapter-bundle.mjs`);
  await esbuild.build({
    entryPoints: [path.join(PKG, 'test', 'replay', 'adapter-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  steps.push({ step: 'adapter-bundle', detail: `esbuild ${requireRoot('esbuild/package.json').version} -> ${path.basename(bundlePath)}` });
  const seam = await import(pathToFileURL(bundlePath).href);

  // 2. vendored engine artifacts + extraction/crypto libraries
  const importDist = (rel) => import(pathToFileURL(path.join(buildDir, 'dist', rel)).href);
  const requireBuild = createRequire(path.join(buildDir, 'probe.cjs'));
  let officeCrypto = null;
  if (args.format === 'docx') {
    try {
      officeCrypto = requireBuild('officecrypto-tool');
    } catch {
      execFileSync('npm', ['install', `officecrypto-tool@${OFFICECRYPTO_VERSION}`, '--no-audit', '--no-fund'], {
        cwd: buildDir,
        stdio: 'pipe',
      });
      officeCrypto = requireBuild('officecrypto-tool');
      steps.push({ step: 'crypto-dependency', detail: `installed officecrypto-tool@${OFFICECRYPTO_VERSION} (vendored lock pin) into the build scratch` });
    }
  }
  const JSZip = requireBuild('jszip');
  steps.push({ step: 'extraction-lib', detail: `jszip ${requireBuild('jszip/package.json').version}` });

  const probe = new Probe(args.format, outDir);
  const ctx = { seam, JSZip, probe, primaryBytes };
  if (args.format === 'docx') {
    const docxEngine = await importDist('docx-engine.mjs');
    await replayDocx({ ...ctx, docxEngine, officeCrypto });
  } else if (args.format === 'pptx') {
    const [pptxEngine, pptxOps, pptxRender] = await Promise.all([
      importDist('pptx-engine.mjs'),
      importDist('pptx-ops.mjs'),
      importDist('pptx-render.mjs'),
    ]);
    await replayPptx({ ...ctx, pptxEngine, pptxOps, pptxRender });
  } else {
    throw new Error('unsupported --format ' + args.format + ' (this lane owns docx + pptx)');
  }

  // 3. artifacts + verdict
  const failed = probe.rows.filter((r) => r.status === 'fail');
  fs.writeFileSync(path.join(outDir, `${args.format}-extraction.json`), JSON.stringify(probe.extraction, null, 2));
  const artifacts = Object.fromEntries(
    (args.format === 'docx' ? ['docx-engine.mjs'] : ['pptx-engine.mjs', 'pptx-ops.mjs', 'pptx-render.mjs']).map((n) => [
      n,
      artifactSha(path.join(buildDir, 'dist', n)),
    ]),
  );
  const formatRun = {
    artifacts,
    primaryFixture: { path: args.fixture ?? null, sha256: sha256(primaryBytes), bytes: primaryBytes.length },
    tools: { node: process.version, esbuild: requireRoot('esbuild/package.json').version, jszip: requireBuild('jszip/package.json').version, officecryptoTool: officeCrypto ? OFFICECRYPTO_VERSION : null },
    steps,
  };
  const manifestPath = path.join(outDir, 'version-manifest.json');
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { formats: {} };
  const manifest = {
    kind: 'uniwork-office-replay-version-manifest',
    generatedAt: new Date().toISOString(),
    lane: 'g2-03-docx-pptx',
    upstreamCommit: provenance?.upstream?.pinnedCommit ?? null,
    expectedCommit: PINNED_COMMIT,
    formats: { ...(prior.formats ?? {}), [args.format]: formatRun },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const result = {
    kind: 'uniwork-office-replay-result',
    format: args.format,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail: failed.length === 0 ? `${probe.rows.length} rows passed on the vendored engine` : `${failed.length}/${probe.rows.length} rows failed`,
    rows: probe.rows,
    artifacts: {
      extraction: `${args.format}-extraction.json`,
      versionManifest: 'version-manifest.json',
      bundle: `${args.format}-adapter-bundle.mjs`,
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

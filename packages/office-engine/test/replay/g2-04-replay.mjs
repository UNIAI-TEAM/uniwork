#!/usr/bin/env node
// G2-04 (UNI-687) - vendored-engine replay executor for xlsx.
//
// scripts/office/replay-fixtures.mjs invokes this once after the shared input
// gate passes:
//   node packages/office-engine/test/replay/g2-04-replay.mjs \
//     --build-dir .go-tmp/office-upstream-build --format xlsx \
//     --fixture <abs-path> --out <evidence-dir> [--sidecar <path>]
//
// The driver (a) esbuild-bundles THIS worktree's adapter seam so the proof
// runs over the real TS sources, (b) binds the vendored xlsx-gateway artifact
// and — when present — the Rust xlsx-sidecar binary built by
// build-upstream.mjs --with-native (default lookup under the build scratch;
// an explicit --sidecar wins), and (c) replays the G0 capability rows,
// verifying every claim with an independent jszip/regex extraction: formulas
// stay <f>, cached <v>s are re-checked against an arithmetic oracle the engine
// never sees, and untouched package parts must hash identically.
//
// Rows that need the native engine are recorded 'fail' with
// sidecar_absent proof when no binary is staged — a replay that cannot run
// the real recalculation has no honest pass.
//
// Artifacts under --out:
//   xlsx-result.json        per-row verdicts (read back by replay-fixtures.mjs)
//   xlsx-extraction.json    independent package extraction snapshots
//   xlsx-saved-*.bin        wire bytes per save case
//   version-manifest.json   pinned commit, artifact/fixture/binary hashes
// Exit: 0 every row pass / 1 a row failed / 2 setup error.
/* global Buffer, process, console */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const PKG = path.join(REPO_ROOT, 'packages', 'office-engine');
const FIXTURE_FILES = path.join(REPO_ROOT, 'docs', 'office', 'g0', 'fixtures', 'files');
const PROVENANCE_PATH = path.join(REPO_ROOT, 'packages', 'office-upstream', 'provenance.json');
const PINNED_COMMIT = '09485f884dc845cf3bf27fb7edfe489f9d457aad';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readFx = (rel) => fs.readFileSync(path.join(FIXTURE_FILES, rel));
const artifactSha = (p) => sha256(fs.readFileSync(p));

function parseArgs(argv) {
  const out = { buildDir: null, format: null, fixture: null, out: null, sidecar: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--build-dir') out.buildDir = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--sidecar') out.sidecar = argv[++i];
    else throw new Error('unknown argument: ' + a);
  }
  if (!out.buildDir || !out.format || !out.out) throw new Error('--build-dir, --format and --out are required');
  if (out.format !== 'xlsx') throw new Error('unsupported --format ' + out.format + ' (this lane owns xlsx)');
  return out;
}

/** Default sidecar lookup: explicit flag → UNIWORK_XLSX_ASSETS → the
 *  build-upstream --with-native cargo target under the build scratch. */
function resolveSidecar(args, buildDir) {
  const name = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar';
  const candidates = [
    args.sidecar,
    process.env.UNIWORK_XLSX_ASSETS ? path.join(process.env.UNIWORK_XLSX_ASSETS, name) : null,
    path.join(buildDir, 'upstream', 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release', name),
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

// ── independent extraction (jszip + regex; never the engine under test) ────

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Sheet name → worksheet part path via workbook.xml + workbook rels. */
async function sheetPartMap(zip) {
  const wbXml = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const relsXml = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const rels = Object.fromEntries(
    [...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const map = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels[m[2]];
    if (target) map[unescapeXml(m[1])] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  return map;
}

/** Cells of one sheet as {A1: {formula, value, t}} straight from sheet XML.
 *  <v> is the cached value; <f> the formula (leading '=' absent on the wire).
 *  Shared strings resolve through xl/sharedStrings.xml. */
async function sheetCells(zip, part) {
  const xml = (await zip.file(part)?.async('string')) ?? '';
  let shared = [];
  if (xml.includes('t="s"')) {
    const sst = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
    shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''),
    );
  }
  const cells = {};
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const is = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body)?.[1];
    let value = null;
    if (v !== undefined) {
      if (t === 's') value = shared[Number(v)] ?? v;
      else if (t === 'b') value = v === '1';
      else if (t === 'str' || t === 'e') value = unescapeXml(v);
      else value = Number(v);
    } else if (t === 'inlineStr' && is !== undefined) {
      value = unescapeXml(is);
    }
    cells[ref] = { formula: f !== undefined ? '=' + unescapeXml(f) : undefined, value, t };
  }
  return cells;
}

async function xlsxExtract(JSZip, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const partsSha = {};
  for (const p of parts) partsSha[p] = sha256(await zip.file(p).async('nodebuffer'));
  const sheetMap = await sheetPartMap(zip);
  const sheets = {};
  for (const [name, part] of Object.entries(sheetMap)) sheets[name] = await sheetCells(zip, part);
  return { parts, partsSha, sheetMap, sheets };
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

/** Rows gated on the real Rust sidecar record an honest failure when no
 *  binary exists — never a pass over a capability the run did not exercise. */
function needNative(probe, row, sidecarPath) {
  if (sidecarPath) return true;
  probe.row(row, false, 'sidecar_absent: no xlsx-sidecar binary (--sidecar / UNIWORK_XLSX_ASSETS / --with-native build scratch)');
  return false;
}

const KITCHEN = 'sheets/xlsx-kitchen-sink.xlsx';
const CHART = 'sheets/xlsx-chart.xlsx';
const MACRO = 'sheets/xlsx-macro.xlsm';
const PIVOT = 'sheets/xlsx-pivot.xlsx';
const SATELLITE = 'sheets/xlsx-satellite-sheets.xlsx';
const VIETNAMESE = 'sheets/xlsx-vietnamese.xlsx';
const LEGACY = 'sheets/legacy-xls.xls';

async function replayXlsx({ seam, JSZip, probe, primaryBytes, gateway, sidecarPath, outDir }) {
  const engine = seam.bindXlsxGateway(gateway);
  const openXlsx = (adapter, bytes, id) => adapter.open({ bytes, format: 'xlsx', document_id: id });
  const serialize = (adapter, ref) => adapter.serialize({ document_model_ref: ref, format: 'xlsx' });

  // Native rows own a fresh sidecar + adapter per document, mirroring the
  // service: the port is per-job and adapter.release() deliberately kills it
  // so resident state can never cross into the next open. Sharing one sidecar
  // across rows would test a topology the service never runs — and fail on
  // the release of the first row that used it.
  const sidecars = [];
  const workDirs = [];
  const native = () => {
    const workDir = fs.mkdtempSync(path.join(outDir, 'xlsx-sidecar-work-'));
    workDirs.push(workDir);
    const sidecar = seam.createXlsxSidecar({ binaryPath: sidecarPath, workDir });
    sidecars.push(sidecar);
    return seam.createXlsxAdapter({ engine, recalc: sidecar });
  };
  const browserAdapter = seam.createXlsxAdapter({ engine });

  try {
    // xlsx-open: the primary fixture parses into sheets + typed warnings.
    {
      const res = await openXlsx(browserAdapter, primaryBytes, 'fx-primary');
      const sheets = res.outcome === 'opened' ? browserAdapter.sheetNames(res.document_model_ref) : [];
      probe.row('xlsx-open', res.outcome === 'opened' && sheets.length >= 1, `open -> ${res.outcome}; sheets=[${sheets.join(',')}]`);
      if (res.outcome === 'opened') {
        probe.extract('open-primary', await xlsxExtract(JSZip, primaryBytes));
        browserAdapter.release(res.document_model_ref);
      }
    }

    // xlsx-open-failures: hostile bytes map to typed classes, never an open.
    {
      const garbage = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.from('not a zip central directory')]);
      const plain = Buffer.from('plain text, not an office file');
      const cfb = fs.existsSync(path.join(FIXTURE_FILES, LEGACY)) ? readFx(LEGACY) : Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const a = await openXlsx(browserAdapter, garbage, 'fx-garbage');
      const b = await openXlsx(browserAdapter, plain, 'fx-plain');
      const c = await openXlsx(browserAdapter, cfb, 'fx-legacy-xls');
      probe.row(
        'xlsx-open-failures',
        a.failure_class === 'corrupted' && b.failure_class === 'not_office_file' && c.failure_class === 'not_office_file',
        `PK-garbage -> ${a.failure_class}; plain -> ${b.failure_class}; CFB(.xls) -> ${c.failure_class}`,
      );
    }

    // xlsx-edit-cell + xlsx-noop-save on the formula-free fixture — the
    // browser-safe half requires no native engine.
    {
      const bytes = readFx('sheets/xlsx-compatibility-edit.xlsx');
      const res = await openXlsx(browserAdapter, bytes, 'fx-edit');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-edit-cell', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        const sheet = browserAdapter.sheetNames(ref)[0];
        browserAdapter.edit(ref, [
          { op: 'set_cell', target: { sheet, cell: 'B2' }, attributes: { value: 4242 } },
          { op: 'set_cell', target: { sheet, cell: 'B3' }, text: 'UNI687_SENTINEL' },
        ]);
        const saved = await serialize(browserAdapter, ref);
        probe.save('edit-cell', saved.bytes);
        const post = await xlsxExtract(JSZip, saved.bytes);
        const cells = post.sheets[sheet] ?? {};
        const ok = cells['B2']?.value === 4242 && cells['B3']?.value === 'UNI687_SENTINEL';
        probe.row('xlsx-edit-cell', ok, `B2=${JSON.stringify(cells['B2']?.value)} (want 4242); B3=${JSON.stringify(cells['B3']?.value)} (want sentinel)`);
        browserAdapter.release(ref);
      }
    }

    // xlsx-chart-preserved: a chart package part must hash identically after
    // an unrelated edit — assertPreserved is the guard under test. The chart
    // sheet carries formulas (it references Data), so the save needs the
    // native adapter: without the sidecar this row is a typed refusal, which
    // is honest but proves nothing about preservation.
    {
      const bytes = readFx(CHART);
      const pre = await xlsxExtract(JSZip, bytes);
      const adapter = sidecarPath ? native() : browserAdapter;
      const res = await openXlsx(adapter, bytes, 'fx-chart');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-chart-preserved', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        const chartParts = pre.parts.filter((p) => /chart/.test(p));
        const warned = (res.warnings ?? []).length > 0;
        const sheet = adapter.sheetNames(ref)[0];
        adapter.edit(ref, [{ op: 'set_cell', target: { sheet, cell: 'A1' }, attributes: { value: 5 } }]);
        try {
          const saved = await serialize(adapter, ref);
          const post = await xlsxExtract(JSZip, saved.bytes);
          const kept = chartParts.length > 0 && chartParts.every((p) => post.partsSha[p] === pre.partsSha[p]);
          probe.row('xlsx-chart-preserved', kept && warned, `chart parts ${chartParts.length} sha-identical=${kept}; open warned=${warned}`);
        } catch (e) {
          probe.row('xlsx-chart-preserved', false, `save threw ${e.code ?? e.name}: ${String(e.message).slice(0, 120)}`);
        }
        adapter.release(ref);
      }
    }

    // xlsx-unsupported-parts-preserved: pivot + macro payloads verbatim. When
    // the sidecar exists a native adapter owns the session (a formula-bearing
    // .xlsm still saves); without it a formula-bearing file fails closed here.
    for (const [rel, tag] of [[PIVOT, 'pivot'], [MACRO, 'macro']]) {
      if (!fs.existsSync(path.join(FIXTURE_FILES, rel))) continue;
      const bytes = readFx(rel);
      const pre = await xlsxExtract(JSZip, bytes);
      const adapter = sidecarPath ? native() : browserAdapter;
      const res = await openXlsx(adapter, bytes, 'fx-' + tag);
      if (res.outcome !== 'opened') {
        probe.row(`xlsx-${tag}-preserved`, false, 'open failed: ' + res.failure_class);
        continue;
      }
      const ref = res.document_model_ref;
      try {
        const saved = await adapter.serialize({ document_model_ref: ref, format: 'xlsx' });
        const post = await xlsxExtract(JSZip, saved.bytes);
        const families = tag === 'pivot' ? /pivot|customXml|externalLink/i : /vbaProject|activeX|ctrlProps/i;
        const family = pre.parts.filter((p) => families.test(p));
        const kept = family.length > 0 && family.every((p) => post.partsSha[p] === pre.partsSha[p]);
        probe.row(`xlsx-${tag}-preserved`, kept && pre.parts.length === post.parts.length, `${tag} parts [${family.join(',')}] sha-identical=${kept}; total ${pre.parts.length}->${post.parts.length}`);
      } catch (e) {
        probe.row(`xlsx-${tag}-preserved`, false, `save threw ${e.code ?? e.name}: ${String(e.message).slice(0, 120)}`);
      }
      adapter.release(ref);
    }

    // xlsx-no-native-refusal: a formula-bearing save without the port is a
    // typed refusal — the stale-<v> fallback is forbidden by design.
    {
      const bytes = readFx(KITCHEN);
      const res = await openXlsx(browserAdapter, bytes, 'fx-norefusal');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-no-native-refusal', false, 'open failed: ' + res.failure_class);
      } else {
        let code = null;
        try {
          await serialize(browserAdapter, res.document_model_ref);
        } catch (e) {
          code = e.code ?? null;
        }
        probe.row('xlsx-no-native-refusal', code === 'unsupported_operation', `serialize without recalc port threw code=${code}`);
        browserAdapter.release(res.document_model_ref);
      }
    }

    // ── native rows: the real Rust sidecar ──────────────────────────────

    // xlsx-recalc-oracle (AC-1): kitchen-sink Data!B2 -> Data!B6=SUM(B2:B4) and
    // the cross-sheet PhuLuc!B2 must equal the oracle's own arithmetic read
    // from the OUTPUT package, and the cells must still carry <f>.
    if (needNative(probe, 'xlsx-recalc-oracle', sidecarPath)) {
      const bytes = readFx(KITCHEN);
      const nativeAdapter = native();
      const res = await openXlsx(nativeAdapter, bytes, 'fx-recalc');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-recalc-oracle', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        nativeAdapter.edit(ref, [{ op: 'set_cell', target: { sheet: 'Data', cell: 'B2' }, attributes: { value: 100 } }]);
        const saved = await serialize(nativeAdapter, ref);
        probe.save('recalc-oracle', saved.bytes);
        const post = await xlsxExtract(JSZip, saved.bytes);
        // Independent oracle: read the stored literals out of the output XML
        // and compute the sums ourselves. The fixture's row-6 cells are
        // labelled B6/C6 (the malformed duplicate-B5 row was repaired), so the
        // engine recalculates the SUM formulas in place and the writer patches
        // their <v>; no formula_cache_kept warning may remain.
        const data = post.sheets['Data'] ?? {};
        const phu = post.sheets['PhuLuc'] ?? {};
        const oracleSum = ['B2', 'B3', 'B4'].reduce((n, r) => n + Number(data[r]?.value ?? 0), 0);
        const countA = ['A2', 'A3', 'A4'].filter((r) => (data[r]?.value ?? null) !== null && data[r]?.value !== '').length;
        const warns = saved.warnings ?? [];
        const keptWarned = warns.some((w) => w.code === 'formula_cache_kept');
        const ok =
          data['B6']?.formula === '=SUM(B2:B4)' &&
          phu['B2']?.formula === '=SUM(Data!B2:B4)' &&
          phu['B2']?.value === oracleSum &&
          phu['B3']?.value === countA &&
          data['B6']?.value === oracleSum &&
          !keptWarned;
        probe.extract('recalc-oracle', { b6: data['B6'], phuB2: phu['B2'], phuB3: phu['B3'], oracleSum, countA, keptWarned });
        probe.row(
          'xlsx-recalc-oracle',
          ok,
          `PhuLuc!B2 <v>=${phu['B2']?.value} (oracle ${oracleSum}); PhuLuc!B3 <v>=${phu['B3']?.value} (oracle ${countA}); B6 <v>=${data['B6']?.value} (oracle ${oracleSum}) warned=${keptWarned}`,
        );
        nativeAdapter.release(ref);
      }
    }

    // xlsx-two-save (AC-1): two consecutive saves on the real engine — the
    // second recalculates on the first's published bytes.
    if (needNative(probe, 'xlsx-two-save', sidecarPath)) {
      const bytes = readFx(KITCHEN);
      const nativeAdapter = native();
      const res = await openXlsx(nativeAdapter, bytes, 'fx-2save');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-two-save', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        nativeAdapter.edit(ref, [{ op: 'set_cell', target: { sheet: 'Data', cell: 'B2' }, attributes: { value: 10 } }]);
        const s1 = await serialize(nativeAdapter, ref);
        nativeAdapter.edit(ref, [{ op: 'set_cell', target: { sheet: 'Data', cell: 'B3' }, attributes: { value: 20 } }]);
        const s2 = await serialize(nativeAdapter, ref);
        probe.save('two-save', s2.bytes);
        const post = await xlsxExtract(JSZip, s2.bytes);
        const data = post.sheets['Data'] ?? {};
        const phu = post.sheets['PhuLuc'] ?? {};
        const oracleSum = ['B2', 'B3', 'B4'].reduce((n, r) => n + Number(data[r]?.value ?? 0), 0);
        // Both the in-sheet Data!B6 and the cross-sheet PhuLuc!B2 refresh
        // against the edits from the two chained saves.
        const ok = data['B6']?.formula === '=SUM(B2:B4)' && data['B6']?.value === oracleSum && phu['B2']?.value === oracleSum && s1.checksum !== s2.checksum && data['B2']?.value === 10 && data['B3']?.value === 20;
        probe.row('xlsx-two-save', ok, `save2 PhuLuc!B2 <v>=${phu['B2']?.value} (oracle ${oracleSum}); B2=${data['B2']?.value}, B3=${data['B3']?.value}; checksums differ=${s1.checksum !== s2.checksum}`);
        nativeAdapter.release(ref);
      }
    }

    // xlsx-multi-sheet: satellite workbook edits across both sheets with the
    // cross-sheet <v>s recalculated (native).
    if (needNative(probe, 'xlsx-multi-sheet', sidecarPath)) {
      const bytes = readFx(SATELLITE);
      const nativeAdapter = native();
      const res = await openXlsx(nativeAdapter, bytes, 'fx-multi');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-multi-sheet', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        const sheets = nativeAdapter.sheetNames(ref);
        nativeAdapter.edit(ref, [{ op: 'set_cell', target: { sheet: sheets[0], cell: 'A1' }, text: 'UNI687_MULTI' }]);
        const saved = await serialize(nativeAdapter, ref);
        const post = await xlsxExtract(JSZip, saved.bytes);
        const ok = Object.keys(post.sheets).length === sheets.length && (post.sheets[sheets[0]]?.['A1']?.value === 'UNI687_MULTI');
        probe.row('xlsx-multi-sheet', ok, `sheets=[${Object.keys(post.sheets).join(',')}]; sentinel present=${ok}`);
        nativeAdapter.release(ref);
      }
    }

    // xlsx-formatted-cells: vietnamese fixture — text survives the
    // recalc-bearing save byte-faithful (native).
    if (needNative(probe, 'xlsx-formatted-cells', sidecarPath)) {
      const bytes = readFx(VIETNAMESE);
      const pre = await xlsxExtract(JSZip, bytes);
      const nativeAdapter = native();
      const res = await openXlsx(nativeAdapter, bytes, 'fx-vn');
      if (res.outcome !== 'opened') {
        probe.row('xlsx-formatted-cells', false, 'open failed: ' + res.failure_class);
      } else {
        const ref = res.document_model_ref;
        const sheets = nativeAdapter.sheetNames(ref);
        // Edit a numeric cell so the recalc-bearing save runs while every
        // pre-existing string cell is left to be verified verbatim below.
        nativeAdapter.edit(ref, [{ op: 'set_cell', target: { sheet: sheets[0], cell: 'B2' }, attributes: { value: 1 } }]);
        const saved = await serialize(nativeAdapter, ref);
        const post = await xlsxExtract(JSZip, saved.bytes);
        // Every pre-existing string cell must survive verbatim.
        let kept = 0;
        let total = 0;
        for (const [sheet, cells] of Object.entries(pre.sheets)) {
          for (const [ref2, c] of Object.entries(cells)) {
            if (typeof c.value === 'string' && c.value.length > 0) {
              total += 1;
              if (post.sheets[sheet]?.[ref2]?.value === c.value) kept += 1;
            }
          }
        }
        probe.row('xlsx-formatted-cells', total > 0 && kept === total, `${kept}/${total} pre-existing string cells identical after recalc save`);
        nativeAdapter.release(ref);
      }
    }

    // xlsx-cancel: released ref serializes as typed not_found.
    {
      const res = await openXlsx(browserAdapter, primaryBytes, 'fx-cancel');
      let code = null;
      if (res.outcome === 'opened') {
        browserAdapter.release(res.document_model_ref);
        try {
          await serialize(browserAdapter, res.document_model_ref);
        } catch (e) {
          code = e.code ?? null;
        }
      }
      probe.row('xlsx-cancel', code === 'not_found', `released ref serialize threw code=${code}`);
    }
  } finally {
    for (const sc of sidecars) await sc.close().catch(() => {});
    // close() won't remove a caller-provided workDir (the job dir owns it in
    // production) — the driver owns these, so it removes them itself.
    for (const d of workDirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildDir = path.resolve(args.buildDir);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const steps = [];

  const provenance = fs.existsSync(PROVENANCE_PATH) ? JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8')) : null;
  const primaryBytes = args.fixture ? fs.readFileSync(path.resolve(args.fixture)) : readFx('sheets/xlsx-kitchen-sink.xlsx');

  // 1. bundle this lane's adapter seam from the real TS sources
  const requireRoot = createRequire(path.join(REPO_ROOT, 'package.json'));
  const esbuild = requireRoot('esbuild');
  const bundlePath = path.join(outDir, 'xlsx-adapter-bundle.mjs');
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

  // 2. vendored engine artifact + the native binary + the extraction library
  const gateway = await import(pathToFileURL(path.join(buildDir, 'dist', 'xlsx-gateway.mjs')).href);
  const sidecarPath = resolveSidecar(args, buildDir);
  steps.push({ step: 'native-binary', detail: sidecarPath ? `xlsx-sidecar ${artifactSha(sidecarPath).slice(0, 16)}… at ${sidecarPath}` : 'absent — native rows fail closed' });
  // jszip ships in the vendored upstream's lockfile install (<build>/upstream/
  // node_modules) — resolve from there, the independent extraction library the
  // same pinned graph provides.
  const requireBuild = createRequire(path.join(buildDir, 'upstream', 'probe.cjs'));
  const JSZip = requireBuild('jszip');
  steps.push({ step: 'extraction-lib', detail: `jszip ${requireBuild('jszip/package.json').version}` });

  const probe = new Probe('xlsx', outDir);
  await replayXlsx({ seam, JSZip, probe, primaryBytes, gateway, sidecarPath, outDir });

  // 3. artifacts + verdict
  const failed = probe.rows.filter((r) => r.status === 'fail');
  fs.writeFileSync(path.join(outDir, 'xlsx-extraction.json'), JSON.stringify(probe.extraction, null, 2));
  const formatRun = {
    artifacts: {
      'xlsx-gateway.mjs': artifactSha(path.join(buildDir, 'dist', 'xlsx-gateway.mjs')),
      ...(sidecarPath ? { 'xlsx-sidecar': artifactSha(sidecarPath) } : {}),
    },
    primaryFixture: { path: args.fixture ?? null, sha256: sha256(primaryBytes), bytes: primaryBytes.length },
    tools: { node: process.version, esbuild: requireRoot('esbuild/package.json').version, jszip: requireBuild('jszip/package.json').version },
    steps,
  };
  const manifestPath = path.join(outDir, 'version-manifest.json');
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { formats: {} };
  const manifest = {
    kind: 'uniwork-office-replay-version-manifest',
    generatedAt: new Date().toISOString(),
    lane: 'g2-04-xlsx',
    upstreamCommit: provenance?.upstream?.pinnedCommit ?? null,
    expectedCommit: PINNED_COMMIT,
    formats: { ...(prior.formats ?? {}), xlsx: formatRun },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const result = {
    kind: 'uniwork-office-replay-result',
    format: 'xlsx',
    status: failed.length === 0 ? 'pass' : 'fail',
    detail: failed.length === 0 ? `${probe.rows.length} rows passed on the vendored engine` : `${failed.length}/${probe.rows.length} rows failed`,
    rows: probe.rows,
    artifacts: {
      extraction: 'xlsx-extraction.json',
      versionManifest: 'version-manifest.json',
      bundle: 'xlsx-adapter-bundle.mjs',
    },
  };
  fs.writeFileSync(path.join(outDir, 'xlsx-result.json'), JSON.stringify(result, null, 2));
  for (const r of probe.rows) console.log(`  ${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.row} - ${r.proof}`);
  console.log(`xlsx: ${result.detail}; wrote ${path.join(outDir, 'xlsx-result.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('replay setup failed: ' + (e?.stack ?? e));
  process.exit(2);
});

#!/usr/bin/env node
// DOC-002 (UNI-666) - manifest and fixture verifier.
//
// Rejects the failures Task 2.6 names: a source checkout that is not the pinned
// commit, a fixture whose bytes do not match its recorded checksum, a path that
// leaves the fixture set, a fixture with no expected result, a capability
// claimed as supported with no case, and an allowlist that mentions ee/.
//
//   node scripts/office-g0/verify-manifest.mjs
//   node scripts/office-g0/verify-manifest.mjs --source ../genoffice --verbose
//   node scripts/office-g0/verify-manifest.mjs --self-test
//
// --self-test replays the same validator over deliberately broken copies and
// exits non-zero if any mutant is accepted. The self-test reads no upstream
// checkout and no fixture bytes, so it runs wherever the repository is.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, resolveLabRoot, resolveFixtureRoot, resolveUpstreamSource } from './paths.mjs';

const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json');
const DEFAULT_CAPABILITIES = path.join(REPO_ROOT, 'docs/office/g0/capabilities.json');
const DEFAULT_SOURCE_MANIFEST = path.join(REPO_ROOT, 'docs/office/g0/source-manifest.json');
const FIXTURE_ROOT = resolveFixtureRoot();
const LAB_ROOT = resolveLabRoot();

/** Only these four statuses exist; a row may not invent a fifth. */
const STATUS_VOCABULARY = ['chưa thử', 'đạt có bằng chứng', 'đạt có giới hạn', 'không hỗ trợ'];
const PROVEN_STATUSES = ['đạt có bằng chứng', 'đạt có giới hạn'];
const GENERATION_METHODS = ['copied', 'generated', 'pending', 'lab-large'];
const SHA256_RE = /^[0-9A-F]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const FIXTURE_ID_RE = /^F-[A-Z0-9]+(-[A-Z0-9]+)*$/;

const FAMILY_LABELS = { docx: 'DOCX', xlsx: 'XLSX', pptx: 'PPTX', pdf: 'PDF', md: 'Markdown', html: 'HTML', legacy: 'Legacy và định dạng dùng chung', cross: 'Cross-format' };
const FAMILY_ORDER = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'legacy', 'cross'];

/**
 * Renders docs/office/g0/capability-matrix.md from capabilities.json and the
 * fixture manifest. The table is derived, never hand-edited: the verifier owns
 * both the data it checks and the human view of that data, so the two cannot
 * drift. Cells keep the four status strings unchanged, so a reader cannot
 * mistake a port decision for a measured result.
 */
export function renderMatrix(manifest, capabilities, generatedAt) {
  const byId = new Map(manifest.fixtures.map((f) => [f.id, f]));
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const code = (s) => String.fromCharCode(96) + s + String.fromCharCode(96);
  const lines = [];
  lines.push('# UniWork Office — ma trận năng lực G0 (DOC-002)');
  lines.push('');
  lines.push('> **Trạng thái:** in-progress — bàn giao Task 2 (' + (generatedAt || '2026-09-16') + '). Sinh từ ' + code('capabilities.json') + ' và ' + code('fixtures/manifest.json') + '.');
  lines.push('> Bảng này **không** phải bằng chứng đã chạy: mọi ô vẫn ' + code('chưa thử') + '.');
  lines.push('>');
  lines.push('> Sinh lại bằng ' + code('node scripts/office-g0/verify-manifest.mjs --write-matrix') + '; không sửa tay file này.');
  lines.push('');
  lines.push('**Issue:** UNI-666 (DOC-002) · **Parent:** UNI-656 · **Kế tiếp:** UNI-667 (DOC-003) dùng bảng này để biết cần chứng minh gì.');
  lines.push('');
  lines.push('Khoá đọc: ' + code(capabilities.columns.upstreamHas) + ' = có mã ở commit đã pin; ' + code(capabilities.columns.mustPort) + ' = thuộc phạm vi pilot Q1-B; ' + code(capabilities.columns.webProven) + ' và ' + code(capabilities.columns.desktopProven) + ' = cần một lần chạy thật trong browser/desktop.');
  lines.push('');
  lines.push('Nút UI, menu, filter hộp thoại và route table chỉ là bằng chứng **upstream có**, không bao giờ là đạt. Theo Q1-B, một thao tác upstream có hỗ trợ nhưng bản web chưa chạy được là thiếu/blocker, không được xoá khỏi tập yêu cầu bằng cách đổi nhãn.');
  lines.push('');
  lines.push('## 1. Ma trận');
  lines.push('');
  let claimed = 0;
  let mustPort = 0;
  for (const fam of FAMILY_ORDER) {
    const rows = capabilities.rows.filter((r) => r.family === fam);
    if (!rows.length) continue;
    lines.push('### ' + FAMILY_LABELS[fam] + ' — ' + rows.length + ' dòng');
    lines.push('');
    lines.push('| ID | Định dạng | Thao tác | ' + capabilities.columns.upstreamHas + ' | ' + capabilities.columns.mustPort + ' | ' + capabilities.columns.webProven + ' | ' + capabilities.columns.desktopProven + ' | Tag | Fixture |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of rows) {
      if (row.mustPort) mustPort += 1;
      const fx = (row.fixtures || []).filter((fid) => byId.has(fid));
      if (fx.length) claimed += 1;
      lines.push('| ' + code(row.id) + ' | ' + esc(row.format) + ' | ' + esc(row.op) + ' | ' + (row.upstreamHas ? 'có' : 'không') + ' | ' + (row.mustPort ? 'phải port' : '—') + ' | ' + row.webProven + ' | ' + row.desktopProven + ' | ' + ((row.tags || []).map(code).join(', ') || '—') + ' | ' + (fx.map(code).join(', ') || '—') + ' |');
    }
    lines.push('');
    const notes = rows.filter((r) => r.note);
    if (notes.length) {
      lines.push('Ghi chú của nhóm này:');
      lines.push('');
      for (const row of notes) lines.push('- ' + code(row.id) + ' — ' + esc(row.note));
      lines.push('');
    }
  }
  lines.push('## 2. Tổng hợp');
  lines.push('');
  lines.push('| Số liệu | Giá trị |');
  lines.push('| --- | --- |');
  lines.push('| Dòng năng lực | ' + capabilities.rows.length + ' |');
  lines.push('| Dòng có ít nhất một fixture tồn tại trong manifest | ' + claimed + ' |');
  lines.push('| Dòng thuộc phạm vi pilot (' + capabilities.columns.mustPort + ') | ' + mustPort + ' |');
  lines.push('| Dòng upstream không có đường triển khai | ' + capabilities.rows.filter((r) => !r.upstreamHas).length + ' |');
  lines.push('| Fixture đã khai trong manifest | ' + manifest.fixtures.length + ' |');
  const provenWeb = capabilities.rows.filter((r) => PROVEN_STATUSES.includes(r.webProven)).length;
  const provenDesktop = capabilities.rows.filter((r) => PROVEN_STATUSES.includes(r.desktopProven)).length;
  lines.push('| Dòng đã chứng minh trên web | ' + provenWeb + ' |');
  lines.push('| Dòng đã chứng minh trên desktop | ' + provenDesktop + ' |');
  lines.push('');
  lines.push('## 3. Định dạng không được hỗ trợ theo thiết kế');
  lines.push('');
  lines.push('| Định dạng | Lý do | Không được nhận là |');
  lines.push('| --- | --- | --- |');
  for (const u of capabilities.unsupportedByDesign || []) lines.push('| ' + esc(u.format) + ' | ' + esc(u.reason) + ' | ' + esc(u.mustNotClaim) + ' |');
  lines.push('');
  lines.push('## 4. Khoảng trống đã biết');
  lines.push('');
  for (const g of capabilities.knownGaps || []) lines.push('- ' + esc(g));
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { source: null, manifest: DEFAULT_MANIFEST, capabilities: DEFAULT_CAPABILITIES, sourceManifest: DEFAULT_SOURCE_MANIFEST, selfTest: false, verbose: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--manifest') out.manifest = path.resolve(argv[++i]);
    else if (a === '--capabilities') out.capabilities = path.resolve(argv[++i]);
    else if (a === '--source-manifest') out.sourceManifest = path.resolve(argv[++i]);
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--write-matrix') out.writeMatrix = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

/**
 * The tracked paths of the PINNED commit, read from the git object store.
 * Reading the pinned commit rather than HEAD is what keeps every pin-anchored
 * check honest when the checkout has moved on: a drifted working tree can no
 * longer make a glob or an evidence path resolve (review r2, finding N1).
 * Falls back to an empty list when the checkout does not hold the pin.
 */
export function pinnedTrackedPaths(sourceDir, pinnedCommit) {
  try {
    return execFileSync('git', ['-C', sourceDir, 'ls-tree', '-r', '--name-only', pinnedCommit], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The text of one file in the pinned commit, or null when the pin lacks it. */
export function pinnedFileText(sourceDir, pinnedCommit, relPath) {
  try {
    return execFileSync('git', ['-C', sourceDir, 'show', pinnedCommit + ':' + relPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** True when the checkout holds the pinned commit object, skipped otherwise. */
export function holdsPinnedCommit(sourceDir, pinnedCommit) {
  try {
    execFileSync('git', ['-C', sourceDir, 'cat-file', '-e', pinnedCommit + '^{commit}'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * An evidence entry names where a row was read from. The first token is a
 * repository path when it has a slash, so it must resolve at the pin: a plain
 * path must exist, and a glob must match at least one tracked file. A glob that
 * matches nothing is the shape that let a row cite visual-captable-*.docx while
 * only the float variant shipped (review M3).
 */
function evidenceTokenIsPinned(token, pinnedPaths) {
  const cleaned = token.replace(/\/$/, '');
  if (!cleaned.includes('*')) {
    if (pinnedPaths.includes(cleaned)) return null;
    if (pinnedPaths.some((q) => q.startsWith(cleaned + '/'))) return null;
    return 'which does not exist at the pinned checkout';
  }
  // A glob must match at least one tracked path; a plain path must exist.
  const parts = cleaned.split('*');
  const matchesGlob = (candidate) => {
    if (!candidate.startsWith(parts[0])) return false;
    let cursor = parts[0].length;
    for (let i = 1; i < parts.length; i += 1) {
      const segment = parts[i];
      const next = candidate.indexOf(segment, cursor);
      if (next < 0) return false;
      cursor = next + segment.length;
    }
    return candidate.endsWith(parts[parts.length - 1]);
  };
  if (pinnedPaths.some(matchesGlob)) return null;
  return 'whose glob matches no tracked file at the pinned checkout';
}

/** A path that stays inside the fixture root, with no traversal, drive or ee/ segment. */
function pathIsInsideSet(rel) {
  if (typeof rel !== 'string' || rel.trim() === '') return 'is empty';
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return 'is absolute';
  if (rel.includes('\\')) return 'uses a backslash separator';
  const segments = rel.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return 'contains an empty or traversal segment';
  if (segments.includes('ee')) return 'names an ee/ path';
  if (segments.includes('node_modules')) return 'names node_modules';
  return null;
}

export function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
}

/** Source checkout identity, when a checkout is given. Returns null when --source is absent. */
export function inspectSource(sourceDir) {
  const run = (args) => execFileSync('git', args, { cwd: sourceDir, encoding: 'utf8' }).trim();
  return {
    commit: run(['rev-parse', 'HEAD']),
    tree: run(['rev-parse', 'HEAD^{tree}']),
    status: run(['status', '--porcelain']),
  };
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * The lab record is optional: it only exists after someone generated the
 * large-band fixtures on this machine. When present it must agree with both the
 * manifest declarations and the bytes actually on disk.
 */
export function validateLabRecord(labRecord, manifest, labRoot) {
  const failures = [];
  if (!labRecord) return failures;
  if (labRecord.kind !== 'uniwork-office-lab-fixture-record') failures.push('lab-record: unexpected kind ' + labRecord.kind);
  const declared = new Map(manifest.fixtures.map((f) => [f.id, f]));
  for (const entry of labRecord.fixtures || []) {
    const f = declared.get(entry.id);
    if (!f) {
      failures.push('lab-record: names ' + entry.id + ' which the manifest does not declare');
      continue;
    }
    if (f.generation.method !== 'lab-large') failures.push('lab-record: ' + entry.id + ' is not a lab fixture in the manifest');
    if (entry.labPath !== f.production.labPath) failures.push('lab-record: ' + entry.id + ' labPath disagrees with the manifest');
    if (SHA256_RE.test(entry.sha256 || '') === false) failures.push('lab-record: ' + entry.id + ' sha256 must be 64 uppercase hex characters');
    // Q9 is a content-size band, not a filename. defaultBytes is the requested
    // uncompressed content target (what the generator's builders inflate to),
    // and the archive on disk is smaller because the XML compresses. The honest
    // check is therefore the generation request, not the archive size: a record
    // whose requestBytes sits far below the declared default is a stale or
    // aborted run, not a Q9-band generation. The floor is 80% of defaultBytes.
    const defaultBytes = f.production && f.production.defaultBytes;
    const requested = typeof entry.requestBytes === 'number' ? entry.requestBytes : labRecord.requestBytes;
    const floor = typeof defaultBytes === 'number' ? Math.floor(defaultBytes * 0.8) : null;
    if (floor !== null) {
      if (typeof requested !== 'number') {
        failures.push('lab-record: ' + entry.id + ' must record the requestBytes it was generated at to check the Q9 band');
      } else if (requested < floor) {
        failures.push('lab-record: ' + entry.id + ' was generated at ' + requested + ' requested bytes, below 80% of the ' + defaultBytes + '-byte default; this is not a Q9-band generation');
      }
    }
    const abs = path.resolve(labRoot, entry.labPath);
    if (!fs.existsSync(abs)) {
      failures.push('lab-record: ' + entry.id + ' records a checksum but the file is missing at ' + abs);
    } else if (sha256File(abs) !== entry.sha256) {
      failures.push('lab-record: ' + entry.id + ' sha256 on disk does not match the lab record');
    } else if (fs.statSync(abs).size !== entry.bytes) {
      failures.push('lab-record: ' + entry.id + ' size on disk does not match the lab record');
    }
  }
  return failures;
}

/**
 * Validates one manifest object against the capability inventory and the source
 * manifest. Returns a list of failure strings; an empty list means the manifest
 * passes. The fixture root and upstream commit are parameters so the self-test
 * can replay the same validator over mutants.
 */
export function validateManifest(input) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const manifest = input.manifest;
  const capabilities = input.capabilities;
  const sourceManifest = input.sourceManifest;
  const upstreamCommit = input.upstreamCommit;
  const fixtureRoot = input.fixtureRoot;
  const repoRoot = input.repoRoot || REPO_ROOT;
  // Pin-anchored checks read the PINNED COMMIT through git, never the working
  // tree of a checkout that may have drifted. upstreamRoot plus upstreamCommit
  // identify the object store; pinnedSource is set only when that store actually
  // holds the pin, so a missing pin degrades to "not checked" rather than to a
  // false pass against whatever the checkout looks like today (review r2, N1).
  const upstreamRoot = input.upstreamRoot || null;
  const pinnedSource = upstreamRoot && input.upstreamCommit && holdsPinnedCommit(upstreamRoot, input.upstreamCommit) ? upstreamRoot : null;
  const pinnedPaths = pinnedSource ? pinnedTrackedPaths(pinnedSource, input.upstreamCommit) : null;
  const checkBytes = input.checkBytes !== false;

  // --- envelope -------------------------------------------------------------
  if (manifest.schemaVersion !== 1) fail('manifest: schemaVersion must be 1');
  if (manifest.kind !== 'uniwork-office-fixture-manifest') fail('manifest: unexpected kind ' + manifest.kind);
  if (manifest.upstreamCommit !== upstreamCommit) fail('manifest: upstreamCommit ' + manifest.upstreamCommit + ' is not the pinned commit ' + upstreamCommit);
  if (manifest.expectedResultRequired !== true) fail('manifest: expectedResultRequired must be true');
  for (const s of STATUS_VOCABULARY) if (!manifest.statusVocabulary || !(s in manifest.statusVocabulary)) fail('manifest: statusVocabulary is missing ' + s);
  if (manifest.status !== 'chưa thử') fail('manifest: status must remain chưa thử until a run is recorded');
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    fail('manifest: fixtures must be a non-empty array');
    return failures;
  }

  // --- source manifest ------------------------------------------------------
  if (sourceManifest) {
    if (sourceManifest.upstream && sourceManifest.upstream.pinnedCommit !== upstreamCommit) {
      fail('source-manifest: pinnedCommit does not match the fixture manifest commit');
    }
    const include = (sourceManifest.allowlist && sourceManifest.allowlist.include) || [];
    if (include.includes('ee') || include.some((p) => p === 'ee' || p.startsWith('ee/'))) {
      fail('source-manifest: allowlist.include must never contain ee/');
    }
    const neverCopy = (sourceManifest.allowlist && sourceManifest.allowlist.neverCopy) || [];
    const neverPaths = neverCopy.map((n) => n.path);
    for (const required of ['node_modules', '**/target', '**/.env*']) {
      if (!neverPaths.includes(required)) fail('source-manifest: allowlist.neverCopy is missing ' + required);
    }
    // Task 2.7: the integration and brand inventory. Each surface must name its
    // upstream value, its replacement, the port owner and the check, so a row
    // cannot be added as a bare label with no decision behind it.
    const brand = sourceManifest.brandAndIntegration;
    if (!brand || !Array.isArray(brand.surfaces) || brand.surfaces.length < 10) {
      fail('source-manifest: brandAndIntegration must inventory at least ten surfaces (task 2.7)');
    } else {
      if (brand.readAtCommit !== upstreamCommit) fail('source-manifest: brandAndIntegration.readAtCommit is not the pinned commit');
      const seen = new Set();
      const allPaths = [];
      for (const surface of brand.surfaces) {
        for (const field of ['id', 'surface', 'upstreamValue', 'replaceWith', 'portIn', 'check']) {
          if (typeof surface[field] !== 'string' || surface[field].trim() === '') fail('source-manifest: brand surface ' + surface.id + ' is missing ' + field);
        }
        if (seen.has(surface.id)) fail('source-manifest: duplicate brand surface id ' + surface.id);
        seen.add(surface.id);
        if (!Array.isArray(surface.sourcePaths) || surface.sourcePaths.length === 0) {
          fail('source-manifest: brand surface ' + surface.id + ' must list at least one sourcePaths entry');
          continue;
        }
        for (const srcPath of surface.sourcePaths) {
          const bad = pathIsInsideSet(srcPath);
          if (bad) fail('source-manifest: brand surface ' + surface.id + ' sourcePaths entry ' + JSON.stringify(srcPath) + ' ' + bad);
          else allPaths.push(srcPath);
        }
      }
      // The surfaces the plan names explicitly must all be present.
      const required = ['apps/shell/package.json', 'apps/shell/electron-builder.cjs', 'apps/shell/build'];
      for (const r of required) {
        if (!allPaths.some((p2) => p2 === r || p2.startsWith(r + '/'))) fail('source-manifest: brand inventory does not cover ' + r);
      }
      if (!allPaths.some((p2) => /updater/.test(p2))) fail('source-manifest: brand inventory does not cover the update feed');
      if (!allPaths.some((p2) => /i18n/.test(p2))) fail('source-manifest: brand inventory does not cover i18n');
      // The paths are read-only evidence: each must exist in the PINNED commit,
      // not merely anywhere the checkout happens to be today.
      if (pinnedPaths) {
        for (const srcPath of allPaths) {
          if (!pinnedPaths.includes(srcPath) && !pinnedPaths.some((q) => q.startsWith(srcPath + '/'))) {
            fail('source-manifest: brand inventory names ' + srcPath + ' which does not exist at the pinned commit');
          }
        }
      }
    }
  }

  // --- dependency closure (task 2.4) ---------------------------------------
  // App-level closure used to be prose that nothing could check (review M4). It
  // is now the runtime dependency set the pin actually declares, and this gate
  // compares the record with the pinned package.json whenever a checkout is
  // available, so a dropped or invented dependency fails the verifier instead of
  // misleading the DOC-004 worker who splits modules from it.
  if (sourceManifest && sourceManifest.sourceClosure) {
    const closure = sourceManifest.sourceClosure;
    const packageNames = new Set((closure.packages || []).map((x) => x.name));
    if (!Array.isArray(closure.apps) || closure.apps.length === 0) {
      fail('source-manifest: sourceClosure.apps must be a non-empty array');
    } else {
      for (const app of closure.apps) {
        if (!Array.isArray(app.runtimeDependencies)) {
          fail('source-manifest: sourceClosure app ' + app.path + ' must record runtimeDependencies');
          continue;
        }
        const names = app.runtimeDependencies.map((d) => d && d.name);
        for (const d of app.runtimeDependencies) {
          if (!d || typeof d.name !== 'string' || !d.name) fail('source-manifest: sourceClosure app ' + app.path + ' has a runtimeDependencies entry with no name');
          else if (d.kind !== (d.name.startsWith('@genoffice/') ? 'workspace' : 'third-party')) {
            fail('source-manifest: sourceClosure app ' + app.path + ' records ' + d.name + ' as ' + d.kind + ' but its scope says otherwise');
          } else if (d.kind === 'workspace' && !packageNames.has(d.name)) {
            fail('source-manifest: sourceClosure app ' + app.path + ' depends on ' + d.name + ' which sourceClosure.packages does not record');
          }
        }
        if (new Set(names).size !== names.length) fail('source-manifest: sourceClosure app ' + app.path + ' lists a runtime dependency twice');
        if (pinnedSource) {
          const pkgText = pinnedFileText(pinnedSource, upstreamCommit, app.path + '/package.json');
          if (pkgText === null) {
            fail('source-manifest: sourceClosure app ' + app.path + ' has no package.json at the pinned commit');
          } else {
            let pinned = null;
            try {
              pinned = JSON.parse(pkgText);
            } catch (err) {
              fail('source-manifest: sourceClosure app ' + app.path + ' package.json is not readable JSON: ' + err.message);
            }
            if (pinned) {
              const declared = new Set(Object.keys(pinned.dependencies || {}));
              for (const name of names) {
                if (!declared.has(name)) fail('source-manifest: sourceClosure app ' + app.path + ' records runtime dependency ' + name + ' which the pinned package.json does not declare');
              }
              for (const name of declared) {
                if (!names.includes(name)) fail('source-manifest: sourceClosure app ' + app.path + ' omits runtime dependency ' + name + ' that the pinned package.json declares');
              }
            }
          }
        }
      }
    }
  }

  // --- package runtime closure (review r2, N2) -----------------------------
  // externalDeps records third-party names only, so the workspace edges a
  // DOC-004 module split depends on were invisible. Each package now records its
  // @genoffice/* runtime dependencies, and this gate compares that set with the
  // pinned package.json whenever the pin is held.
  if (sourceManifest && sourceManifest.sourceClosure && pinnedSource) {
    for (const pkg of sourceManifest.sourceClosure.packages || []) {
      if (pkg.path.endsWith('xlsx-engine')) continue;
      const recorded = pkg.runtimeWorkspaceDependencies;
      if (recorded !== undefined && !Array.isArray(recorded)) {
        fail('source-manifest: sourceClosure package ' + pkg.path + ' runtimeWorkspaceDependencies must be an array');
        continue;
      }
      const pkgText = pinnedFileText(pinnedSource, upstreamCommit, pkg.path + '/package.json');
      if (pkgText === null) {
        fail('source-manifest: sourceClosure package ' + pkg.path + ' has no package.json at the pinned commit');
        continue;
      }
      let pinned = null;
      try {
        pinned = JSON.parse(pkgText);
      } catch (err) {
        fail('source-manifest: sourceClosure package ' + pkg.path + ' package.json is not readable JSON: ' + err.message);
        continue;
      }
      const atPin = Object.keys(pinned.dependencies || {}).filter((n) => n.startsWith('@genoffice/')).sort();
      const claimed = (recorded || []).slice().sort();
      for (const name of atPin) {
        if (!claimed.includes(name)) fail('source-manifest: sourceClosure package ' + pkg.path + ' omits workspace runtime dependency ' + name + ' that the pinned package.json declares');
      }
      for (const name of claimed) {
        if (!atPin.includes(name)) fail('source-manifest: sourceClosure package ' + pkg.path + ' records workspace runtime dependency ' + name + ' which the pinned package.json does not declare');
      }
      if (atPin.length && !Array.isArray(recorded)) fail('source-manifest: sourceClosure package ' + pkg.path + ' must record runtimeWorkspaceDependencies');
    }
  }

  // --- capability inventory -------------------------------------------------
  const rows = capabilities && capabilities.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    fail('capabilities: rows must be a non-empty array');
    return failures;
  }
  if (capabilities.surveyedCommit !== upstreamCommit) fail('capabilities: surveyedCommit does not match the fixture manifest commit');
  const rowIds = new Set();
  for (const row of rows) {
    if (rowIds.has(row.id)) fail('capabilities: duplicate row id ' + row.id);
    rowIds.add(row.id);
    for (const column of ['upstreamHas', 'mustPort', 'webProven', 'desktopProven']) {
      if (!(column in row)) fail('capabilities: row ' + row.id + ' is missing ' + column);
    }
    for (const column of ['webProven', 'desktopProven']) {
      if (row[column] !== undefined && !STATUS_VOCABULARY.includes(row[column])) {
        fail('capabilities: row ' + row.id + ' has an unknown ' + column + ' value ' + JSON.stringify(row[column]));
      }
    }
    if (!Array.isArray(row.fixtures) || row.fixtures.length === 0) {
      fail('capabilities: row ' + row.id + ' declares no fixture');
    }
  }

  // Evidence entries name the upstream site a row was read from. The first token
  // is a repository path when it contains a slash, so it must exist at the pin
  // (review M3: a row cited apps/docs/tests/pagination-corpus/docx/visual-captable-*.docx,
  // which is not a path in the pin at all). Entries that are prose, or that name a
  // fixture instead of upstream source, are left to the fixture link checks.
  if (pinnedPaths) {
    for (const row of rows) {
      for (const entry of row.evidence || []) {
        if (typeof entry !== 'string') continue;
        const token = entry.trim().split(/\s+/)[0].replace(/[),.;:]+$/, '');
        if (!token.includes('/')) continue;
        const bad = evidenceTokenIsPinned(token, pinnedPaths);
        if (bad) fail('capabilities: row ' + row.id + ' cites evidence path ' + JSON.stringify(token) + ' ' + bad);
      }
    }
  }

  // --- fixtures -------------------------------------------------------------
  const ids = new Set();
  const paths = new Map();
  const declaredCapabilities = new Set();
  for (const f of manifest.fixtures) {
    if (!FIXTURE_ID_RE.test(f.id || '')) fail('fixture ' + f.id + ': id must look like F-FAMILY-NAME');
    if (ids.has(f.id)) fail('fixture ' + f.id + ': duplicate fixture id');
    ids.add(f.id);

    if (!GENERATION_METHODS.includes(f.generation && f.generation.method)) {
      fail('fixture ' + f.id + ': generation.method must be one of ' + GENERATION_METHODS.join(', '));
    }

    // Every non-pending fixture must state what success looks like and how it is judged.
    if (!f.expected || typeof f.expected.result !== 'string' || f.expected.result.trim() === '') {
      fail('fixture ' + f.id + ': expected.result is required');
    }
    if (!f.expected || typeof f.expected.oracle !== 'string' || f.expected.oracle.trim() === '') {
      fail('fixture ' + f.id + ': expected.oracle is required');
    }

    if (!Array.isArray(f.capabilities) || f.capabilities.length === 0) {
      fail('fixture ' + f.id + ': at least one capability must be referenced');
    } else {
      for (const c of f.capabilities) {
        if (!rowIds.has(c)) fail('fixture ' + f.id + ': references unknown capability ' + c);
        declaredCapabilities.add(c);
      }
    }

    const method = f.generation && f.generation.method;
    const isLab = method === 'lab-large';
    const rel = isLab ? (f.production && f.production.labPath) || f.path : f.path;
    const bad = pathIsInsideSet(rel);
    if (bad) fail('fixture ' + f.id + ': path ' + JSON.stringify(rel) + ' ' + bad);
    if (!bad) {
      if (paths.has(rel)) fail('fixture ' + f.id + ': path collides with ' + paths.get(rel));
      paths.set(rel, f.id);
    }

    if (method === 'pending') {
      if (typeof f.source.reason !== 'string' || f.source.reason.trim() === '') fail('fixture ' + f.id + ': a pending fixture must state why it cannot be produced');
      if (!Array.isArray(f.tags) || !f.tags.includes('pending-generation')) fail('fixture ' + f.id + ': a pending fixture must carry the pending-generation tag');
      continue;
    }

    // The lab band is intentionally outside Git, so the committed manifest
    // records no checksum: a checksum here would make the manifest unusable on
    // any machine that has not generated the file. The declaration must still
    // name where the file lives and how large it is, and the generator keeps the
    // checksum of what it produced in the lab record beside the file.
    if (isLab) {
      if (!f.production || typeof f.production.labPath !== 'string') fail('fixture ' + f.id + ': a lab fixture must record production.labPath');
      if (!f.production || !Number.isInteger(f.production.defaultBytes) || f.production.defaultBytes <= 0) {
        fail('fixture ' + f.id + ': a lab fixture must record production.defaultBytes');
      }
      if (!Array.isArray(f.tags) || !f.tags.includes('lab-only')) fail('fixture ' + f.id + ': a lab fixture must carry the lab-only tag');
      if (f.sha256 !== null || f.bytes !== null) {
        fail('fixture ' + f.id + ': a lab fixture must not carry a committed checksum; the lab record holds it instead');
      }
      continue;
    }

    if (SHA256_RE.test(f.sha256 || '') === false) fail('fixture ' + f.id + ': sha256 must be 64 uppercase hex characters');
    if (!Number.isInteger(f.bytes) || f.bytes <= 0) fail('fixture ' + f.id + ': bytes must be a positive integer');

    if (method === 'copied') {
      if (f.source.kind !== 'upstream-copy') fail('fixture ' + f.id + ': a copied fixture must record source.kind upstream-copy');
      if (!f.source.upstreamPath) fail('fixture ' + f.id + ': a copied fixture must record its upstreamPath');
      if (!f.source.provenance) fail('fixture ' + f.id + ': a copied fixture must record its provenance');
      if (!f.source.thirdPartyNotice && !/Apache-2\.0/.test(f.license || '')) {
        fail('fixture ' + f.id + ': a copied fixture must name its licence or its third-party notice');
      }
      if (f.source.upstreamRepository) {
        const repo = f.source.upstreamRepository;
        const commit = f.source.upstreamCommit;
        const sourcePath = f.source.upstreamPath;
        const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
        if (!match || !COMMIT_RE.test(commit || '') || pathIsInsideSet(sourcePath)) {
          fail('fixture ' + f.id + ': external source needs a GitHub repository, full commit, and safe upstream path');
        } else if (f.source.downloadUrl !== `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commit}/${sourcePath}`) {
          fail('fixture ' + f.id + ': downloadUrl must pin the declared repository, commit and path');
        }
        for (const field of ['licenseFile', 'thirdPartyNotice']) {
          const rel = f.source[field];
          const bundle = manifest.licenseBundle;
          if (typeof rel !== 'string' || !bundle || !rel.startsWith(bundle.path) || pathIsInsideSet(rel) ||
              !bundle.files.some((e) => bundle.path + e.file === rel && e.upstreamRepository === repo && e.upstreamCommit === commit)) {
            fail('fixture ' + f.id + ': external source ' + field + ' must name a pinned file in the licence bundle');
          }
        }
      } else if (f.source.upstreamCommit !== upstreamCommit) {
        fail('fixture ' + f.id + ': copied fixture records upstream commit ' + f.source.upstreamCommit);
      }
    }

    // Offline integrity: the bytes on disk are the bytes the manifest claims.
    if (checkBytes && !bad) {
      const root = isLab ? LAB_ROOT : fixtureRoot;
      const abs = path.resolve(root, rel);
      if (!fs.existsSync(abs)) {
        fail('fixture ' + f.id + ': file is missing at ' + abs);
      } else if (sha256File(abs) !== f.sha256) {
        fail('fixture ' + f.id + ': sha256 on disk is ' + sha256File(abs) + ' but the manifest records ' + f.sha256);
      } else if (fs.statSync(abs).size !== f.bytes) {
        fail('fixture ' + f.id + ': size on disk is ' + fs.statSync(abs).size + ' but the manifest records ' + f.bytes);
      }
    }
  }

  // --- both directions ------------------------------------------------------
  const referenced = new Set();
  for (const row of rows) {
    for (const fid of row.fixtures || []) {
      referenced.add(fid);
      if (!ids.has(fid)) fail('capabilities: row ' + row.id + ' references fixture ' + fid + ' which the manifest does not declare');
    }
    // A green cell is a claim that a run happened. Task 2 ships no runs, so the
    // honest gate is stricter than "has a fixture": a proven status must name the
    // evidence-register entry that recorded the run. A fixture id is a case, not
    // an observed result, so it never satisfies this.
    const claimedColumns = ['webProven', 'desktopProven'].filter((c) => PROVEN_STATUSES.includes(row[c]));
    if (claimedColumns.length) {
      if (!Array.isArray(row.fixtures) || row.fixtures.length === 0) {
        fail('capabilities: row ' + row.id + ' is marked proven with no verification case');
      }
      const register = typeof row.evidenceRegister === 'string' ? row.evidenceRegister.trim() : '';
      if (!register) {
        fail('capabilities: row ' + row.id + ' claims ' + claimedColumns.join('/') + ' but names no evidenceRegister entry; a status may change only with a recorded run');
      }
    }
  }
  for (const f of manifest.fixtures) {
    if (!referenced.has(f.id)) fail('fixture ' + f.id + ': no capability row references it, so nothing states what it verifies');
  }

  // --- licence bundle -------------------------------------------------------
  // Redistributing upstream bytes means shipping the licence and notice text
  // with them. The bundle lives in the repository, so it is checkable offline.
  const bundle = manifest.licenseBundle;
  if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    fail('manifest: licenseBundle must list the licence files that ship with the copied fixtures');
  } else {
    if (bundle.upstreamCommit !== upstreamCommit) fail('manifest: licenseBundle.upstreamCommit is not the pinned commit');
    const required = ['LICENSE.txt', 'NOTICE.txt'];
    for (const name of required) {
      if (!bundle.files.some((e) => e.file === name)) fail('manifest: licenseBundle is missing ' + name);
    }
    for (const entry of bundle.files) {
      const bad = pathIsInsideSet(bundle.path + entry.file);
      if (bad) {
        fail('manifest: licenseBundle file ' + entry.file + ' ' + bad);
        continue;
      }
      const abs = path.join(repoRoot, bundle.path, entry.file);
      if (!fs.existsSync(abs)) fail('manifest: licenseBundle file ' + entry.file + ' is missing at ' + abs);
      else if (SHA256_RE.test(entry.sha256 || '') === false) fail('manifest: licenseBundle file ' + entry.file + ' needs a 64-character sha256');
      else if (sha256File(abs) !== entry.sha256) fail('manifest: licenseBundle file ' + entry.file + ' does not match its recorded sha256');
      else if (fs.statSync(abs).size !== entry.bytes) fail('manifest: licenseBundle file ' + entry.file + ' size differs from the record');
      if (entry.upstreamRepository) {
        const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(entry.upstreamRepository);
        if (!match || !COMMIT_RE.test(entry.upstreamCommit || '') || pathIsInsideSet(entry.upstreamPath) ||
            entry.downloadUrl !== `https://raw.githubusercontent.com/${match?.[1]}/${match?.[2]}/${entry.upstreamCommit}/${entry.upstreamPath}`) {
          fail('manifest: licenseBundle file ' + entry.file + ' needs pinned external provenance');
        }
      }
    }
  }
  return failures;
}

/** Deep copy through JSON, then mutate; the self-test only needs small mutants. */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * The negative cases Task 2.6 requires. Each mutant must be rejected; the
 * self-test fails when a mutant is accepted, and also when a control copy that
 * was never mutated is rejected (which would mean the validator is broken).
 */
export function selfTestCases(manifest, capabilities, sourceManifest, upstreamCommit, expectedBytes) {
  const baseInput = () => ({
    manifest: clone(manifest),
    capabilities: clone(capabilities),
    sourceManifest: clone(sourceManifest),
    upstreamCommit,
    fixtureRoot: 'unused',
    checkBytes: false,
  });
  const firstGenerated = manifest.fixtures.find((f) => f.generation.method === 'generated');
  const firstCopied = manifest.fixtures.find((f) => f.generation.method === 'copied');
  const firstExternal = manifest.fixtures.find((f) => f.source.upstreamRepository);
  const firstPending = manifest.fixtures.find((f) => f.generation.method === 'pending');
  const claimedRow = capabilities.rows.find((r) => r.fixtures && r.fixtures.length > 0);

  const cases = [
    { name: 'control: the unmodified manifest passes', mutate: (i) => i, expectRejected: false },
    {
      name: 'wrong upstream commit',
      mutate: (i) => { i.manifest.upstreamCommit = '0'.repeat(40); return i; },
      expectRejected: true,
    },
    {
      name: 'wrong commit on a copied fixture',
      mutate: (i) => {
        i.manifest.fixtures.find((f) => f.generation.method === 'copied').source.upstreamCommit = 'f'.repeat(40);
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'bad checksum format',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).sha256 = 'not-a-hash'; return i; },
      expectRejected: true,
    },
    {
      name: 'bad checksum value',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).sha256 = 'A'.repeat(64); return i; },
      expectRejected: true,
      checkBytes: true,
    },
    {
      name: 'path outside the fixture set (traversal)',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).path = '../outside.docx'; return i; },
      expectRejected: true,
    },
    {
      name: 'path outside the fixture set (absolute)',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).path = 'C:/tmp/outside.docx'; return i; },
      expectRejected: true,
    },
    {
      name: 'path naming ee/',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).path = 'ee/licensed.docx'; return i; },
      expectRejected: true,
    },
    {
      name: 'fixture missing its expected result',
      mutate: (i) => { delete i.manifest.fixtures.find((f) => f.id === firstGenerated.id).expected.result; return i; },
      expectRejected: true,
    },
    {
      name: 'fixture missing its oracle',
      mutate: (i) => { delete i.manifest.fixtures.find((f) => f.id === firstGenerated.id).expected.oracle; return i; },
      expectRejected: true,
    },
    {
      name: 'fixture with no capability',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).capabilities = []; return i; },
      expectRejected: true,
    },
    {
      name: 'fixture referencing an unknown capability',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).capabilities = ['docx-does-not-exist']; return i; },
      expectRejected: true,
    },
    {
      name: 'capability claimed with no case',
      mutate: (i) => { i.capabilities.rows.find((r) => r.id === claimedRow.id).fixtures = []; return i; },
      expectRejected: true,
    },
    {
      name: 'capability marked proven with no case',
      mutate: (i) => {
        const row = i.capabilities.rows.find((r) => r.id === claimedRow.id);
        row.webProven = 'đạt có bằng chứng';
        row.fixtures = [];
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'capability marked proven with a case but no evidence register',
      mutate: (i) => {
        const row = i.capabilities.rows.find((r) => r.id === claimedRow.id);
        row.webProven = 'đạt có bằng chứng';
        const firstFixture = (row.fixtures || [])[0];
        row.fixtures = [firstFixture];
        delete row.evidenceRegister;
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'capability row referencing an undeclared fixture',
      mutate: (i) => { i.capabilities.rows.find((r) => r.id === claimedRow.id).fixtures = ['F-NOT-DECLARED']; return i; },
      expectRejected: true,
    },
    {
      name: 'fixture that no capability row references',
      mutate: (i) => {
        const orphan = 'F-ORPHAN-UNREFERENCED';
        const template = clone(i.manifest.fixtures.find((f) => f.generation.method === 'copied'));
        template.id = orphan;
        template.path = 'docs/orphan.docx';
        i.manifest.fixtures.push(template);
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'unknown status value',
      mutate: (i) => { i.capabilities.rows.find((r) => r.id === claimedRow.id).webProven = 'đã xong'; return i; },
      expectRejected: true,
    },
    {
      name: 'manifest disagreeing with the source manifest commit',
      mutate: (i) => { i.sourceManifest.upstream.pinnedCommit = 'a'.repeat(40); return i; },
      expectRejected: true,
    },
    {
      name: 'allowlist that mentions ee/',
      mutate: (i) => { i.sourceManifest.allowlist.include = i.sourceManifest.allowlist.include.concat(['ee']); return i; },
      expectRejected: true,
    },
    {
      name: 'allowlist that stopped refusing .env files',
      mutate: (i) => { i.sourceManifest.allowlist.neverCopy = i.sourceManifest.allowlist.neverCopy.filter((n) => n.path !== '**/.env*'); return i; },
      expectRejected: true,
    },
    {
      name: 'licence bundle with an edited licence file',
      mutate: (i) => { i.manifest.licenseBundle.files.find((e) => e.file === 'LICENSE.txt').sha256 = 'A'.repeat(64); return i; },
      expectRejected: true,
    },
    {
      name: 'licence bundle missing the NOTICE file',
      mutate: (i) => { i.manifest.licenseBundle.files = i.manifest.licenseBundle.files.filter((e) => e.file !== 'NOTICE.txt'); return i; },
      expectRejected: true,
    },
    {
      name: 'licence bundle that escapes the fixture set',
      mutate: (i) => { i.manifest.licenseBundle.path = '../outside/'; return i; },
      expectRejected: true,
    },
    {
      name: 'copied fixture with neither a licence nor a notice',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.source.kind === 'upstream-copy').license = 'unclear'; return i; },
      expectRejected: true,
    },
    {
      name: 'duplicate fixture id',
      mutate: (i) => {
        const dup = clone(firstCopied);
        dup.id = firstGenerated.id;
        dup.path = 'docs/duplicate-copy.docx';
        i.manifest.fixtures.push(dup);
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'missing fixture file on disk',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstGenerated.id).path = 'docs/does-not-exist.docx'; return i; },
      expectRejected: true,
      checkBytes: true,
    },
    {
      name: 'pending fixture with no blocker reason',
      mutate: (i) => { delete i.manifest.fixtures.find((f) => f.id === firstPending.id).source.reason; return i; },
      expectRejected: true,
    },
    {
      name: 'manifest that claims a run has passed',
      mutate: (i) => { i.manifest.status = 'đạt có bằng chứng'; return i; },
      expectRejected: true,
    },
  ];

  if (firstExternal) cases.push(
    {
      name: 'external fixture URL disagrees with pinned commit',
      mutate: (i) => { i.manifest.fixtures.find((f) => f.id === firstExternal.id).source.downloadUrl = 'https://raw.githubusercontent.com/apache/poi/main/test-data/spreadsheet/Simple.xls'; return i; },
      expectRejected: true,
    },
    {
      name: 'external fixture licence bundle loses pinned metadata',
      mutate: (i) => {
        const entry = i.manifest.licenseBundle.files.find((f) => i.manifest.licenseBundle.path + f.file === firstExternal.source.licenseFile);
        entry.upstreamCommit = 'f'.repeat(40);
        return i;
      },
      expectRejected: true,
    },
    {
      name: 'external fixture omits notice reference',
      mutate: (i) => { delete i.manifest.fixtures.find((f) => f.id === firstExternal.id).source.thirdPartyNotice; return i; },
      expectRejected: true,
    },
  );

  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error('self-test needs the byte length of one generated fixture');
  }
  return cases;
}

/** Reads the real manifest set once, for both modes. */
function loadRealInputs(args) {
  const manifest = readJson(args.manifest);
  const capabilities = readJson(args.capabilities);
  const sourceManifest = readJson(args.sourceManifest);
  return { manifest, capabilities, sourceManifest };
}

function runSelfTest(args) {
  const { manifest, capabilities, sourceManifest } = loadRealInputs(args);
  const upstreamCommit = manifest.upstreamCommit;
  const sample = manifest.fixtures.find((f) => f.generation.method === 'generated');
  const cases = selfTestCases(manifest, capabilities, sourceManifest, upstreamCommit, sample.bytes);
  const problems = [];
  for (const c of cases) {
    const input = c.mutate({
      manifest: clone(manifest),
      capabilities: clone(capabilities),
      sourceManifest: clone(sourceManifest),
      upstreamCommit,
      fixtureRoot: FIXTURE_ROOT,
      checkBytes: c.checkBytes === true,
    });
    const failures = validateManifest(input);
    const rejected = failures.length > 0;
    if (c.expectRejected && !rejected) problems.push(c.name + ': was accepted but must be rejected');
    if (!c.expectRejected && rejected) problems.push(c.name + ': was rejected (' + failures[0] + ') but must pass');
    if (args.verbose) {
      process.stdout.write('  ' + (rejected ? 'rejected' : 'accepted') + '  ' + c.name + (rejected ? ' -> ' + failures[0] : '') + '\n');
    }
  }
  const rejectedCount = cases.filter((c) => c.expectRejected).length;
  process.stdout.write('negative self-test: ' + rejectedCount + ' mutants must be rejected, ' + (cases.length - rejectedCount) + ' control must pass\n');
  if (problems.length) {
    for (const p of problems) process.stderr.write('self-test FAILED: ' + p + '\n');
    return 1;
  }
  process.stdout.write('negative self-test: all ' + cases.length + ' cases behaved as required\n');
  return 0;
}

function runVerify(args) {
  const { manifest, capabilities, sourceManifest } = loadRealInputs(args);

  if (args.source) {
    const src = path.resolve(args.source);
    if (!fs.existsSync(src)) {
      process.stderr.write('verify-manifest: source checkout not found at ' + src + '\n');
      return 2;
    }
    const state = inspectSource(src);
    if (state.commit !== manifest.upstreamCommit) {
      process.stderr.write('verify-manifest: source HEAD is ' + state.commit + ' but the manifest pins ' + manifest.upstreamCommit + '\n');
      return 1;
    }
    if (state.tree !== sourceManifest.upstream.pinnedTree) {
      process.stderr.write('verify-manifest: source tree is ' + state.tree + ' but the source manifest pins ' + sourceManifest.upstream.pinnedTree + '\n');
      return 1;
    }
    if (state.status !== '') {
      process.stderr.write('verify-manifest: source checkout is not clean; refusing to verify fixtures against a moving tree\n');
      return 1;
    }
    process.stdout.write('source: ' + state.commit.slice(0, 12) + ' clean, tree matches the pinned tree\n');
    // The lockfile is the dependency ground truth the trial reinstalls from, so
    // --source rehashes it too instead of trusting only commit/tree/clean
    // (review L7). prepare-source.mjs already refuses to write when it differs.
    const lock = sourceManifest.lockfile;
    if (lock && lock.path) {
      const lockAbs = path.join(src, lock.path);
      if (!fs.existsSync(lockAbs)) {
        process.stderr.write('verify-manifest: pinned lockfile ' + lock.path + ' is missing from the source checkout\n');
        return 1;
      }
      const lockSha = sha256File(lockAbs);
      if (lockSha !== lock.sha256) {
        process.stderr.write('verify-manifest: ' + lock.path + ' is ' + lockSha + ' but the source manifest pins ' + lock.sha256 + '\n');
        return 1;
      }
      if (fs.statSync(lockAbs).size !== lock.bytes) {
        process.stderr.write('verify-manifest: ' + lock.path + ' is ' + fs.statSync(lockAbs).size + ' bytes but the source manifest pins ' + lock.bytes + '\n');
        return 1;
      }
      process.stdout.write('source: lockfile ' + lock.path + ' matches the pinned sha256 and size\n');
    }
  } else {
    process.stdout.write('source: not checked (pass --source <genoffice checkout> to verify HEAD)\n');
    // Say plainly what the pin-anchored gates did, instead of letting a checkout
    // that does not hold the pin look like a full pass (review r2 N1 follow-up).
    const found = resolveUpstreamSource();
    if (fs.existsSync(found)) {
      if (holdsPinnedCommit(found, manifest.upstreamCommit)) {
        process.stdout.write('source: pin ' + manifest.upstreamCommit.slice(0, 12) + ' is present in ' + found + '; evidence paths, app and package closure are checked against that commit\n');
      } else {
        process.stdout.write('source: ' + found + ' does not hold the pinned commit ' + manifest.upstreamCommit.slice(0, 12) + ', so evidence paths and app/package closure are NOT checked here; pass --source to require the pin\n');
      }
    } else {
      process.stdout.write('source: no source checkout found, so evidence paths and app/package closure are not checked\n');
    }
  }

  const failures = validateManifest({
    manifest,
    capabilities,
    sourceManifest,
    upstreamCommit: manifest.upstreamCommit,
    fixtureRoot: FIXTURE_ROOT,
    upstreamRoot: args.source ? path.resolve(args.source) : (fs.existsSync(resolveUpstreamSource()) ? resolveUpstreamSource() : null),
    checkBytes: true,
  });

  const labRecordPath = path.join(LAB_ROOT, 'fixtures', 'large', 'lab-record.json');
  if (fs.existsSync(labRecordPath)) {
    const labFailures = validateLabRecord(readJson(labRecordPath), manifest, LAB_ROOT);
    failures.push(...labFailures);
    process.stdout.write('lab record: ' + labRecordPath + (labFailures.length ? ' (problems found)' : ' agrees') + '\n');
  } else {
    process.stdout.write('lab record: none on this machine; the large-band fixtures have not been generated here\n');
  }

  const byMethod = {};
  for (const f of manifest.fixtures) {
    const m = f.generation.method;
    byMethod[m] = (byMethod[m] || 0) + 1;
  }
  const mustPort = capabilities.rows.filter((r) => r.mustPort).length;
  process.stdout.write('fixtures: ' + manifest.fixtures.length + ' -> ' + JSON.stringify(byMethod) + '\n');
  process.stdout.write('capabilities: ' + capabilities.rows.length + ' rows, ' + mustPort + ' must port\n');
  process.stdout.write('declared upstream commit: ' + manifest.upstreamCommit + '\n');

  if (args.writeMatrix) {
    const matrixPath = path.join(REPO_ROOT, 'docs/office/g0/capability-matrix.md');
    const rendered = renderMatrix(manifest, capabilities, '2026-09-16');
    const previous = fs.existsSync(matrixPath) ? fs.readFileSync(matrixPath, 'utf8') : null;
    if (previous === rendered) process.stdout.write('capability matrix: unchanged\n');
    else {
      fs.writeFileSync(matrixPath, rendered, 'utf8');
      process.stdout.write('capability matrix: wrote ' + matrixPath + '\n');
    }
  }

  if (failures.length) {
    for (const f of failures) process.stderr.write('FAIL ' + f + '\n');
    process.stderr.write('verify-manifest: ' + failures.length + ' problem(s)\n');
    return 1;
  }
  process.stdout.write('verify-manifest: manifest, checksums, coverage and allowlist agree\n');
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: node scripts/office-g0/verify-manifest.mjs [--source <genoffice>] [--self-test] [--verbose]\n');
    process.exit(0);
  }
  try {
    process.exit(args.selfTest ? runSelfTest(args) : runVerify(args));
  } catch (err) {
    process.stderr.write('verify-manifest: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(2);
  }
}

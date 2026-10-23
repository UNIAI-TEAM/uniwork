// UNI-667 (office-g0) XLSX cycle runner, wave2 runner-worker lane r1.
//
// Contract: .uniwork-dev/office-g0/parallel-wave2-contract.md ("Runner worker").
// Precedent (read-only here): .uniwork-dev/office-g0/main-run-docx-r2.mjs.
//
// This module owns ONLY the xlsx slice of the office-g0 lab. It never edits the
// shared Playwright config, shared specs, lab server, host adapter or engine host.
// It binds the lab to the REAL prepared native engine: a missing engine entry,
// tsx CLI, sidecar binary, manifest, fixture, build or spec is a hard named
// failure, never a fabricated fallback.
//
// Modes
//   discovery (default): resolve inputs, hash them, preflight. Starts nothing.
//   execute (--execute): also verifies the lane ports are free, starts the engine
//     host and the lab, runs the xlsx Playwright slice once, and refuses to claim
//     success unless the JSON report proves real, non-skipped tests.
//
// Import-safe: importing this file only defines exports. main() runs solely when
// the file is executed directly, so the pure helpers are unit-testable.
//
// Later Grok prerequisite (NOT executed here): the sheets renderer build must
// exist first, e.g.
//   node scripts/office-g0/build-renderers.mjs --source <preparedSource> --apps sheets --out <buildRoot>
// No install, no build and no package mutation happens in this module.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { LabProtocolError } from '../../e2e/office-g0/lab-storage.mjs';

export const SOURCE_PIN = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
export const XLSX_APP = 'sheets';
export const XLSX_SPEC = 'xlsx-cycle.spec.ts';
export const XLSX_CONFIG = 'playwright.office-g0.xlsx.config.ts';
export const REPORT_NAME = 'office-g0-xlsx-report.json';
export const XLSX_TARGET = Object.freeze({ sheetName: 'Data', cell: 'A1' });
export const FIXTURE = Object.freeze({
  name: 'g0-compatibility-edit.xlsx',
  bytes: 3161,
  sha256: 'a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85',
});
// Logical lane ports from parallel-formats-r1-runtime-map.json. Verified free and
// owned at execute time; never reused across lanes.
export const PORTS = Object.freeze({ app: 5460, preview: 5461, engine: 5462 });
export const SIDECAR_NAME = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar';
export const BUILD_PREREQUISITE =
  'node scripts/office-g0/build-renderers.mjs --source <preparedSource> --apps sheets --out <buildRoot>'
  + ' (xlsx needs no pptx prebundle; run by Grok before --execute)';

export const EXPECTED_PROJECTS = Object.freeze(['chrome', 'edge']);
export const ENGINE_REQUEST_TIMEOUT_MS = 20000;
export const ENGINE_PING_TIMEOUT_MS = 30000;
export const PING_ATTEMPT_TIMEOUT_MS = 3000;
export const DISCOVERY_TIMEOUT_MS = 120000;
export const EXECUTION_TIMEOUT_MS = 900000;
export const CLEANUP_TIMEOUT_MS = 5000;
export const SERVER_CLOSE_TIMEOUT_MS = 5000;
// The finalize sweep carries its OWN bound. stop() is invoked on every owned child up front, so this
// bound races CONFIRMATION only: a stop already memoized in cleanupPromises is never re-joined past
// it, and an entry whose confirmation missed the bound is returned unconfirmed and stays owned.
export const FINALIZE_CLEANUP_BOUND_MS = CLEANUP_TIMEOUT_MS + 2000;

const NL = String.fromCharCode(10);

export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (filePath) => sha256Bytes(fs.readFileSync(filePath));

export function createXlsxEngineHandlers({ baseUrl, fetchImpl = fetch, timeoutMs = ENGINE_REQUEST_TIMEOUT_MS }) {
  const post = async (route, payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('engine request deadline exceeded')), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const response = await fetchImpl(String(baseUrl).replace(/\/+$/, '') + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new LabProtocolError(
          'engine_http_error',
          '[office-g0-xlsx] engine ' + route + ' returned HTTP ' + response.status,
          { route, upstreamStatus: response.status },
        );
      }
      const envelope = await response.json();
      if (!envelope || envelope.ok !== true) {
        throw new LabProtocolError(
          'engine_error',
          '[office-g0-xlsx] engine ' + route + ' refused: ' + String(envelope && (envelope.error || envelope.code)),
          { route },
        );
      }
      return envelope.result;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * The TRUSTED view identity. createEngineProxy invokes a function binding as
   * `handler(input, { viewId })` (lab-engine.mjs:227), where viewId came from the server session and
   * never from the request body. That is the authority for every route; input.viewId is only a
   * fallback for a direct call with no meta. It is applied LAST on each payload, so neither
   * input.viewId nor a legacy request.viewId can re-target the session this bridge serves.
   */
  const trustedViewId = (input, meta) => {
    const trusted = meta && typeof meta.viewId === 'string' ? meta.viewId : null;
    return trusted ?? input.viewId;
  };

  /**
   * The renderer contracts, not the engine route envelopes. The sidecar's read_range answers the
   * whole RangeResult, but /engine/xlsx-read-range wraps it in { result } (engine-xlsx-routes.mts
   * :142) while /engine/xlsx-read-formulas returns the result itself. A read that does not answer
   * the shape the renderer schema parses is a NAMED refusal, never a fabricated empty range.
   */
  const unwrapReadRange = (result) => {
    const value = result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'result')
      ? result.result
      : result;
    if (!value || typeof value !== 'object' || !Array.isArray(value.cells)) {
      throw new LabProtocolError(
        'engine_invalid_response',
        '[office-g0-xlsx] xlsx-read-range did not answer a {cells} range result',
      );
    }
    return value;
  };
  /**
   * The read-formulas route answers { cells, indexingComplete, truncated }. A result without a
   * cells array is an engine_invalid_response, never a silent ok that the renderer would treat as
   * an empty sheet.
   */
  const requireFormulaCells = (result) => {
    if (!result || typeof result !== 'object' || !Array.isArray(result.cells)) {
      throw new LabProtocolError(
        'engine_invalid_response',
        '[office-g0-xlsx] xlsx-read-formulas did not answer a {cells} formula result',
      );
    }
    return result;
  };
  return {
    'xlsx-open': (input, meta) =>
      post('/engine/xlsx-open', { viewId: trustedViewId(input, meta), path: input.sourcePath }),
    // The route reads input.sheetId / input.range FLAT; the lab server wraps them in `request`.
    // The wrapper is spread FIRST and the trusted viewId LAST, so a legacy request.viewId can
    // never re-target the session this bridge serves. The { result } envelope is unwrapped so the
    // renderer receives the RangeResult its schema parses.
    'xlsx-read-range': async (input, meta) =>
      unwrapReadRange(await post('/engine/xlsx-read-range', {
        ...(input.request ?? {}),
        viewId: trustedViewId(input, meta),
      })),
    // The route reads input.sheetId FLAT and answers the { cells, indexingComplete, truncated }
    // result itself; the server-owned viewId is applied LAST for the same reason as recalc.
    'xlsx-read-formulas': async (input, meta) =>
      requireFormulaCells(await post('/engine/xlsx-read-formulas', {
        ...(input.request ?? {}),
        viewId: trustedViewId(input, meta),
      })),
    // The route reads input.edits / input.reads FLAT; the lab server wraps them in `request`.
    // The wrapper is spread FIRST and the trusted viewId LAST, so a legacy request.viewId can
    // never override the server-owned session (previously the request was spread last).
    'xlsx-recalc': (input, meta) =>
      post('/engine/xlsx-recalc', { ...(input.request ?? {}), viewId: trustedViewId(input, meta) }),
    'xlsx-save': (input, meta) => {
      // The accepted central lab server calls xlsx-save with the engine-shaped fields FLAT
      // (edits / name / formulaValues / structuralOps) plus the SERVER-OWNED viewId; the older
      // { request, targetPath } wrapper is still accepted. Both payload shapes are spread first and
      // the authoritative viewId is applied LAST, so a legacy request.viewId (or any other smuggled
      // viewId) can never override the server-owned session this bridge was opened for; real edits,
      // name, formulaValues and structuralOps stay forwarded unchanged.
      const { request, targetPath, ...flat } = input;
      return post('/engine/xlsx-save', {
        ...(request ?? {}),
        ...flat,
        viewId: trustedViewId(input, meta),
        ...(targetPath ? { name: path.basename(targetPath) } : {}),
      });
    },
    // The renderer's own close command (App.tsx:2850 -> desktopApi.closeWorkbook -> host:sheets-close)
    // reaches a REAL route: /engine/xlsx-close retires the held workbook state and answers
    // { closed, sessionId }. The server-owned viewId is the authority; sessionId
    // guards against stale cleanup closing the replacement after Save and can
    // never select a different view's workbook.
    'xlsx-close': (input, meta) =>
      post('/engine/xlsx-close', { viewId: trustedViewId(input, meta), sessionId: input.sessionId }),
  };
}

/** Deterministic hashes for the actual source/build/spec/helper files this run used. */
export function hashFileList(filePaths) {
  const out = [];
  for (const filePath of filePaths) {
    const row = { path: filePath, exists: fs.existsSync(filePath), bytes: null, sha256: null };
    if (row.exists) {
      const bytes = fs.readFileSync(filePath);
      row.bytes = bytes.length;
      row.sha256 = sha256Bytes(bytes);
    }
    out.push(row);
  }
  return out;
}

/** Nearest ancestor holding .uniwork-dev; injectable existsSync keeps it testable. */
export function findWorkspaceRoot(startDir, existsSync = fs.existsSync) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, '.uniwork-dev'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const realOrNull = (value) => {
  try { return fs.realpathSync.native(value); } catch { return null; }
};
const foldCase = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
/** Canonical (case-folded) containment for two already-real paths. */
const isContained = (realRoot, realCandidate) => {
  const root = foldCase(realRoot);
  const candidate = foldCase(realCandidate);
  return candidate === root || candidate.startsWith(root + path.sep);
};

/** Nearest ancestor of `target` that already exists, or null when no component does. */
export function deepestExistingParent(target, existsSync = fs.existsSync) {
  let dir = path.resolve(target);
  for (;;) {
    if (existsSync(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Every runner input must stay inside the configured workspace root. The lexical resolve is only the
 * first gate: a junction or symlink whose PATH string sits under the root but whose real target is
 * elsewhere must be refused, so containment is proven against the realpath of the workspace root and
 * of the deepest EXISTING component of the target. This deliberately ACCEPTS an intentional
 * dependency link (for example the prepared source's node_modules) whose real target still lives
 * inside the authorized workspace, and refuses a link that leaves it - the check is against the
 * workspace root and the prepared-source contract, NOT against the narrower lane. A component that
 * cannot be real-resolved is refused rather than assumed contained. New evidence targets use their
 * deepest existing parent. realpathSync is injectable so a focused test drives the link accept/refuse
 * decision WITHOUT creating any junction or symlink.
 */
export function assertInsideWorkspace(workspaceRoot, target, label, { existsSync = fs.existsSync, realpathSync = null } = {}) {
  const realOf = realpathSync ?? realOrNull;
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('[office-g0-xlsx] ' + label + ' must stay inside ' + root + ': ' + resolved);
  }
  const realRoot = realOf(root);
  if (!realRoot) {
    throw new Error('[office-g0-xlsx] ' + label + ' cannot be contained: the workspace root does not resolve: ' + root);
  }
  const existing = deepestExistingParent(resolved, existsSync) ?? root;
  const realExisting = realOf(existing);
  if (!realExisting) {
    throw new Error('[office-g0-xlsx] ' + label + ' cannot be contained: ' + existing + ' does not real-resolve');
  }
  if (!isContained(realRoot, realExisting)) {
    throw new Error('[office-g0-xlsx] ' + label + ' must stay inside ' + realRoot + ': ' + resolved + ' resolves outside it through ' + realExisting);
  }
  return resolved;
}

export function requireExistingFile(filePath, label, existsSync = fs.existsSync, workspaceRoot = null, realpathSync = null) {
  if (!existsSync(filePath)) {
    throw new Error('[office-g0-xlsx] missing ' + label + ': ' + filePath);
  }
  const resolved = path.resolve(filePath);
  if (workspaceRoot) {
    const realOf = realpathSync ?? realOrNull;
    const realRoot = realOf(path.resolve(workspaceRoot));
    if (!realRoot) {
      throw new Error('[office-g0-xlsx] ' + label + ' cannot be contained: the workspace root does not resolve: ' + workspaceRoot);
    }
    const realTarget = realOf(resolved);
    if (!realTarget) {
      throw new Error('[office-g0-xlsx] ' + label + ' cannot be contained: ' + resolved + ' does not real-resolve');
    }
    if (!isContained(realRoot, realTarget)) {
      throw new Error('[office-g0-xlsx] ' + label + ' must stay inside ' + realRoot + ': ' + resolved + ' resolves outside it through ' + realTarget);
    }
  }
  return resolved;
}

/** Evidence paths for one run prefix; a run never reuses or deletes prior evidence. */
export function evidenceTargets(prefix) {
  return [prefix + '-artifacts', prefix + '-runtime', prefix + '-run.txt', prefix + '-engine.txt', prefix + '-result.json'];
}

export function assertFreshEvidenceTargets(targets, existsSync = fs.existsSync, workspaceRoot = null) {
  for (const target of targets) {
    if (existsSync(target)) {
      throw new Error('[office-g0-xlsx] evidence target already exists; refusing to reuse or delete it: ' + target);
    }
    if (workspaceRoot) {
      // A new evidence target does not exist yet, so containment is proven through its deepest
      // EXISTING parent: a junction/reparse component whose real target leaves the workspace is
      // refused here, before the path is created, rather than followed later (F5).
      const resolved = path.resolve(target);
      const realRoot = realOrNull(path.resolve(workspaceRoot));
      if (!realRoot) {
        throw new Error('[office-g0-xlsx] evidence target cannot be contained: the workspace root does not resolve: ' + workspaceRoot);
      }
      const existing = deepestExistingParent(resolved, existsSync);
      const realExisting = existing ? realOrNull(existing) : null;
      if (!realExisting || !isContained(realRoot, realExisting)) {
        throw new Error('[office-g0-xlsx] evidence target must stay inside ' + realRoot + ': ' + target
          + (realExisting ? ' resolves outside it through ' + realExisting : ' has no existing parent to prove'));
      }
    }
  }
  return targets;
}

/**
 * The approved build manifest must hash to the caller-supplied SHA-256, sit on the
 * immutable source pin, and describe exactly one app: sheets. Anything else fails.
 */
export function assertManifest({ manifestBytes, expectedSha256, expectedPin = SOURCE_PIN, expectedApp = XLSX_APP }) {
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha256 ?? ''))) {
    throw new Error(
      '[office-g0-xlsx] the approved build manifest SHA-256 must be 64 lowercase hex chars;'
      + ' supply --expected-manifest-sha256 or OFFICE_G0_EXPECTED_MANIFEST_SHA256',
    );
  }
  const bytes = Buffer.isBuffer(manifestBytes) ? manifestBytes : Buffer.from(manifestBytes);
  const manifestSha256 = sha256Bytes(bytes);
  if (manifestSha256 !== expectedSha256) {
    throw new Error('[office-g0-xlsx] build manifest SHA256 mismatch: ' + manifestSha256 + ' !== ' + expectedSha256);
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('[office-g0-xlsx] build manifest is not JSON: ' + String(error && error.message));
  }
  const appKeys = Object.keys(manifest.apps || {});
  if (manifest.pinnedSourceCommit !== expectedPin) {
    throw new Error('[office-g0-xlsx] manifest source pin ' + String(manifest.pinnedSourceCommit) + ' is not the immutable pin ' + expectedPin);
  }
  if (appKeys.length !== 1 || appKeys[0] !== expectedApp) {
    throw new Error('[office-g0-xlsx] manifest must describe exactly one app "' + expectedApp + '"; saw [' + appKeys.join(', ') + ']');
  }
  if (manifest.sourceUntouched !== true || manifest.appSourcesUntouched !== true) {
    throw new Error('[office-g0-xlsx] manifest does not prove the prepared source stayed untouched');
  }
  return { sha256: manifestSha256, sourcePin: manifest.pinnedSourceCommit, app: appKeys[0] };
}

/** Ports must be distinct: app, preview and engine can never share a socket. */
export function assertDistinctPorts(ports) {
  const values = [ports.app, ports.preview, ports.engine];
  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      throw new Error('[office-g0-xlsx] invalid port: ' + String(value));
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('[office-g0-xlsx] app/preview/engine ports must be distinct: ' + values.join(', '));
  }
  return ports;
}

const FLAGS = [
  ['candidate', 'OFFICE_G0_XLSX_CANDIDATE'],
  ['builds', 'OFFICE_G0_XLSX_BUILDS'],
  ['manifest', 'OFFICE_G0_XLSX_MANIFEST'],
  ['source', 'OFFICE_G0_PREPARED_SOURCE'],
  ['fixtures', 'OFFICE_G0_FIXTURES_DIR'],
  ['prefix', 'OFFICE_G0_XLSX_EVIDENCE_PREFIX'],
];

/** Explicit inputs only: no implicit worktree discovery for the executable paths. */
export function parseRunnerArgs(argv, env = process.env) {
  const flagOf = (name) => {
    const index = argv.indexOf('--' + name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const args = {
    mode: argv.includes('--execute') ? 'execute' : 'discovery',
    workspace: flagOf('workspace'),
    ports: { ...PORTS },
  };
  const missing = [];
  for (const [name, envName] of FLAGS) {
    const value = String(flagOf(name) || env[envName] || '').trim();
    if (value.length === 0) {
      missing.push('--' + name + ' (or ' + envName + ')');
      continue;
    }
    args[name] = value;
  }
  if (missing.length > 0) {
    throw new Error('[office-g0-xlsx] missing required runner input(s): ' + missing.join(', '));
  }
  args.expectedManifestSha256 = String(flagOf('expected-manifest-sha256') || env.OFFICE_G0_EXPECTED_MANIFEST_SHA256 || '').trim();
  assertDistinctPorts(args.ports);
  return args;
}

/**
 * Pure resolution + preflight of one run. Missing files, an uncontained path or an
 * existing evidence target all throw by name; this starts nothing.
 */
export function resolveRunnerPlan(args, { existsSync = fs.existsSync } = {}) {
  const candidate = path.resolve(args.candidate);
  const workspaceRoot = args.workspace ? path.resolve(args.workspace) : findWorkspaceRoot(candidate, existsSync);
  if (!workspaceRoot) {
    throw new Error('[office-g0-xlsx] no .uniwork-dev workspace root found above ' + candidate);
  }
  const plan = {
    mode: args.mode,
    workspaceRoot,
    candidate: assertInsideWorkspace(workspaceRoot, candidate, 'candidate repo'),
    builds: assertInsideWorkspace(workspaceRoot, args.builds, 'build root'),
    source: assertInsideWorkspace(workspaceRoot, args.source, 'prepared source'),
    fixtures: assertInsideWorkspace(workspaceRoot, args.fixtures, 'fixtures dir'),
    manifest: assertInsideWorkspace(workspaceRoot, args.manifest, 'build manifest'),
    prefix: assertInsideWorkspace(workspaceRoot, args.prefix, 'evidence prefix'),
    ports: { ...args.ports },
  };
  plan.spec = path.join(plan.candidate, 'e2e', 'office-g0', XLSX_SPEC);
  plan.config = path.join(plan.candidate, 'e2e', XLSX_CONFIG);
  plan.labServer = path.join(plan.candidate, 'e2e', 'office-g0', 'lab-server.mjs');
  plan.engineHost = path.join(plan.candidate, 'e2e', 'office-g0', 'engine-host.mts');
  plan.tsxCli = path.join(plan.source, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  plan.sidecar = path.join(plan.source, 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release', SIDECAR_NAME);
  plan.fixture = path.join(plan.fixtures, FIXTURE.name);
  plan.buildEntry = path.join(plan.builds, XLSX_APP, 'index.html');
  requireExistingFile(plan.manifest, 'approved build manifest', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.config, 'xlsx Playwright config', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.spec, 'xlsx browser spec', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.labServer, 'lab server module', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.engineHost, 'engine host entry', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.tsxCli, 'prepared tsx CLI', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.sidecar, 'prepared xlsx sidecar binary', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.fixture, 'xlsx fixture', existsSync, plan.workspaceRoot);
  requireExistingFile(plan.buildEntry, 'sheets renderer build entry', existsSync, plan.workspaceRoot);
  assertFreshEvidenceTargets(evidenceTargets(plan.prefix), existsSync, plan.workspaceRoot);
  return plan;
}

/** Playwright CLI resolved through the candidate's own e2e package.json. */
export function resolvePlaywrightCli(candidateRoot) {
  const require = createRequire(path.join(candidateRoot, 'e2e', 'package.json'));
  const resolved = require.resolve('@playwright/test/package.json');
  const cli = path.join(path.dirname(resolved), 'cli.js');
  if (!fs.existsSync(cli)) {
    throw new Error('[office-g0-xlsx] Playwright CLI not found at ' + cli);
  }
  return cli;
}

/** Flatten the Playwright JSON report into honest counts; never trusts exit code alone. */
export function summarizePlaywrightReport(report) {
  const found = [];
  const walk = (suite, parents) => {
    const names = suite && suite.title ? [...parents, String(suite.title)] : [...parents];
    for (const spec of (suite && suite.specs) || []) found.push({ spec, names });
    for (const child of (suite && suite.suites) || []) walk(child, names);
  };
  for (const suite of (report && report.suites) || []) walk(suite, []);
  const identities = [];
  for (const entry of found) {
    const title = [...entry.names, String(entry.spec.title || '')].filter((p) => p.length > 0).join(' > ');
    for (const test of entry.spec.tests || []) {
      identities.push({
        file: String(entry.spec.file || ''),
        title,
        project: String(test.projectName || ''),
        status: String(test.status || ''),
        results: (test.results || []).map((r) => ({ status: String(r.status || ''), retry: Number(r.retry ?? 0) })),
      });
    }
  }
  const isRealPass = (t) => t.status === 'expected' && t.results.length === 1
    && t.results[0].status === 'passed' && t.results[0].retry === 0;
  return {
    specs: found.length,
    files: [...new Set(found.map((entry) => String(entry.spec.file || '')))],
    tests: identities.length,
    identities,
    passed: identities.filter(isRealPass).length,
    retired: identities.filter((t) => t.results.some((r) => r.retry > 0)).length,
    skipped: identities.filter((t) => t.status === 'skipped' || t.results.some((r) => r.status === 'skipped')).length,
    failed: identities.filter((t) => t.status !== 'expected' && t.status !== 'skipped').length,
  };
}
export const testIdentity = (test) => [test.project, test.file, test.title].join('\u0000');
/** Identity keys that appear more than once in one list, in first-seen order. A Set cannot see these:
    Set-equality alone passes two rows that share project+file+title while summary.tests counted the
    extra row. */
export function duplicateIdentities(tests) {
  const seen = new Set();
  const dupes = new Set();
  for (const test of tests || []) {
    const id = testIdentity(test);
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
/** The discovery list must be complete, unique and total/listed-consistent for the full XLSX spec
    (chrome + edge) BEFORE execute; an empty, duplicate, unknown-spec, wrong-project, extra, missing
    or short list is refused by name. When the caller passes the raw `report` from
    parseDiscoveryListReport, an unparsed listing line, an ambiguous (repeated) Total line, a missing
    Total line, or a declared-total / parsed-row mismatch is refused FIRST, so a line the row parser could
    not classify can never collapse into an accepted set. main calls this before it starts the browser run. */
export function assertDiscoveryComplete(discoveryList, { specFile = XLSX_SPEC, expectedProjects = EXPECTED_PROJECTS, report = null } = {}) {
  if (!Array.isArray(discoveryList) || discoveryList.length === 0) {
    throw new Error('[office-g0-xlsx] test discovery listed no ' + specFile + ' tests; refusing to execute');
  }
  if (report) {
    if (!Array.isArray(report.unparsed) || report.unparsed.length > 0) {
      throw new Error('[office-g0-xlsx] test discovery left ' + ((report.unparsed || []).length)
        + ' listing line(s) unparsed; refusing to execute on a collapsed list: ' + (report.unparsed || []).join(' | '));
    }
    if (report.ambiguousTotal === true) {
      throw new Error('[office-g0-xlsx] test discovery printed more than one Total line; refusing to execute on a list whose cardinality is ambiguous');
    }
    if (!Number.isInteger(report.declaredTotal)) {
      throw new Error('[office-g0-xlsx] test discovery printed no Total line; refusing to execute on a list whose cardinality is unverified');
    }
    if (report.declaredTotal !== discoveryList.length) {
      throw new Error('[office-g0-xlsx] test discovery declared ' + report.declaredTotal + ' test(s) but parsed '
        + discoveryList.length + ' listing row(s); refusing to execute on a collapsed list');
    }
  }
  const dupes = duplicateIdentities(discoveryList);
  if (dupes.length > 0) {
    throw new Error('[office-g0-xlsx] test discovery listed duplicate identit(ies): ' + dupes.join(' | '));
  }
  const outside = discoveryList.filter((test) => path.basename(String(test.file || '')) !== specFile);
  if (outside.length > 0) {
    throw new Error('[office-g0-xlsx] test discovery listed a spec outside the xlsx slice: ' + outside.map((test) => test.file).join(', '));
  }
  const projects = [...new Set(discoveryList.map((test) => String(test.project || '')))].sort();
  if (projects.join(',') !== [...expectedProjects].sort().join(',')) {
    throw new Error('[office-g0-xlsx] test discovery projects [' + projects.join(', ') + '] are not exactly [' + expectedProjects.join(', ') + ']');
  }
  const distinctTitles = new Set(discoveryList.map((test) => testIdentity({ project: '', file: test.file, title: test.title }))).size;
  const expectedTotal = distinctTitles * expectedProjects.length;
  if (discoveryList.length !== expectedTotal) {
    throw new Error('[office-g0-xlsx] test discovery is not total/listed-consistent: ' + discoveryList.length
      + ' row(s) listed for ' + expectedTotal + ' expected spec x project combination(s)');
  }
  return discoveryList;
}
const LIST_HEADER = /^Listing tests:\s*$/;
const LIST_TOTAL = /^Total:\s*(\d+)\s+tests?\s+in\s+(\d+)\s+files?\s*$/;
// The ROW shape is the r7 one, unchanged: [project] \u203a <spec path>[:line:col] \u203a <title>. Only the
// classification around it is new, so an identity the r7 parser accepted still parses identically; no
// broad regex is guessed from prose. The header/Total lines are the real Playwright list reporter shape.
const LIST_ROW = /^\[([^\]]+)\]\s*\u203a\s*(.+?\.(?:spec|test)\.[cm]?[jt]s)(?::\d+:\d+)?\s*\u203a\s*(.*)$/;
/** Parse the real Playwright test --list output into its identities AND the lines it could not
    classify. Every non-blank line is the Listing header, the trailing Total line, or a test row;
    anything else is returned in `unparsed` instead of being silently dropped, and `declaredTotal`
    carries the reporter own count so the caller can prove the listed cardinality rather than trusting
    a collapsed parse (F4). */
export function parseDiscoveryListReport(stdout) {
  const identities = [];
  const unparsed = [];
  let declaredTotal = null;
  let declaredFiles = null;
  let ambiguousTotal = false;
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (LIST_HEADER.test(line)) continue;
    const total = LIST_TOTAL.exec(line);
    if (total) {
      // A SECOND Total line is not valid list output, so its count cannot be trusted. Mark the
      // cardinality explicitly ambiguous and keep the FIRST declared total, so a later smaller total
      // can never collapse an earlier larger one into an accepted parse (F4).
      if (declaredTotal !== null) { ambiguousTotal = true; continue; }
      declaredTotal = Number(total[1]);
      declaredFiles = Number(total[2]);
      continue;
    }
    const row = LIST_ROW.exec(line);
    if (!row) { unparsed.push(line); continue; }
    identities.push({
      project: row[1].trim(),
      file: row[2],
      title: row[3].replace(/\s*\u203a\s*/g, ' > ').trim(),
    });
  }
  return { identities, unparsed, declaredTotal, declaredFiles, ambiguousTotal };
}
/** Parse the real Playwright test --list output into discovery identities. */
export function parseDiscoveryList(stdout) {
  return parseDiscoveryListReport(stdout).identities;
}
/** Exact slice: only this spec file, exactly the discovered tests, both projects, every test one
    non-retried passed result, no skips, no extras, no retries; tests>0 with passed=0 never passes. */
export function assertReportProvesRealRun(summary, { specFile = XLSX_SPEC, expectedProjects = EXPECTED_PROJECTS, discovery = null } = {}) {
  if (!summary || !Number.isInteger(summary.tests) || summary.tests === 0) {
    throw new Error('[office-g0-xlsx] the Playwright report proves zero tests ran; refusing a silent success');
  }
  const outside = summary.files.filter((file) => path.basename(file) !== specFile);
  if (outside.length > 0) {
    throw new Error('[office-g0-xlsx] the report contains a spec outside the xlsx slice: ' + outside.join(', '));
  }
  if (!summary.files.some((file) => path.basename(file) === specFile)) {
    throw new Error('[office-g0-xlsx] the report does not contain ' + specFile);
  }
  const projects = [...new Set(summary.identities.map((test) => test.project))].sort();
  if (projects.join(',') !== [...expectedProjects].sort().join(',')) {
    throw new Error('[office-g0-xlsx] report projects [' + projects.join(', ') + '] are not exactly [' + expectedProjects.join(', ') + ']');
  }
  if (summary.retired > 0) throw new Error('[office-g0-xlsx] ' + summary.retired + ' test(s) were retried; the slice must run retries=0');
  if (summary.skipped > 0) throw new Error('[office-g0-xlsx] ' + summary.skipped + ' required test(s) were skipped; refusing to claim a run');
  if (summary.failed > 0) throw new Error('[office-g0-xlsx] ' + summary.failed + ' test(s) failed; see the preserved run log');
  if (summary.passed !== summary.tests) {
    throw new Error('[office-g0-xlsx] only ' + summary.passed + ' of ' + summary.tests + ' test(s) have a real passed result');
  }
  if (discovery) {
    const discoveryDupes = duplicateIdentities(discovery);
    if (discoveryDupes.length > 0) {
      throw new Error('[office-g0-xlsx] the discovery list contains duplicate identit(ies): ' + discoveryDupes.join(' | '));
    }
    const reportDupes = duplicateIdentities(summary.identities);
    if (reportDupes.length > 0) {
      throw new Error('[office-g0-xlsx] the report contains duplicate identit(ies): ' + reportDupes.join(' | '));
    }
    const expected = new Set(discovery.map(testIdentity));
    const seen = new Set(summary.identities.map(testIdentity));
    const missing = [...expected].filter((id) => !seen.has(id));
    const extra = [...seen].filter((id) => !expected.has(id));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error('[office-g0-xlsx] the report does not match discovery; missing [' + missing.join(' | ') + '] extra [' + extra.join(' | ') + ']');
    }
    // Cardinality is checked EXPLICITLY: a report row and a discovery row that collapsed to one
    // identity pass Set-equality while summary.tests counted the extra row (F4).
    if (discovery.length !== summary.identities.length) {
      throw new Error('[office-g0-xlsx] discovery/report identity cardinality mismatch: ' + discovery.length
        + ' discovered vs ' + summary.identities.length + ' reported');
    }
  }
  return true;
}

/** A lane port is free only when this process can bind it. */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      reject(new Error('[office-g0-xlsx] port ' + port + ' is not free (owned by another process?): ' + String(error && error.message)));
    });
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(port)));
  });
}

/**
 * The engine is accepted only when its own ping reports the exact source and lab
 * this run configured, and the spawned child is still alive. Another process's
 * ping can never satisfy this.
 */
export async function waitForEngineIdentity({
  baseUrl, expected, child,
  timeoutMs = ENGINE_PING_TIMEOUT_MS,
  attemptMs = PING_ATTEMPT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const url = String(baseUrl).replace(/[/]+$/, '') + '/engine/ping';
  const deadline = Date.now() + timeoutMs;
  let last = 'no attempt';
  let stopped = null;
  let wake = null;
  const death = new Promise((resolve) => { wake = resolve; });
  const onExit = (code, signal) => { stopped = { code, signal }; wake(); };
  const onError = (error) => { stopped = { error: String(error && error.message ? error.message : error) }; wake(); };
  if (child) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('[office-g0-xlsx] engine host already stopped (exit ' + child.exitCode + ', signal ' + child.signalCode + ') before pinging as the intended source/lab');
    }
    child.once('exit', onExit);
    child.once('error', onError);
  }
  const dead = () => { throw new Error('[office-g0-xlsx] engine host stopped during the identity ping: ' + JSON.stringify(stopped)); };
  try {
    while (Date.now() < deadline) {
      if (stopped) dead();
      const controller = new AbortController();
      const budget = Math.max(1, Math.min(attemptMs, deadline - Date.now()));
      const timer = setTimeout(() => controller.abort(new Error('ping deadline exceeded')), budget);
      if (typeof timer.unref === 'function') timer.unref();
      // Request AND body read race the child's death: a matching ping cannot be returned after death.
      const attempt = (async () => {
        const response = await fetchImpl(url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal,
        });
        return response.json();
      })();
      // A REAL deadline rejection: an injected fetch OR body read that ignores the abort signal can no
      // longer hang the identity wait; the attempt is raced against this bounded rejection.
      let attemptTimer = null;
      const attemptDeadline = new Promise((resolve, reject) => {
        attemptTimer = setTimeout(() => reject(new Error('ping attempt deadline exceeded after ' + budget + 'ms')), budget + 250);
        if (typeof attemptTimer.unref === 'function') attemptTimer.unref();
      });
      void attempt.catch(() => undefined);
      try {
        const envelope = await Promise.race([attempt, death.then(dead), attemptDeadline]);
        if (stopped) dead();
        if (envelope && envelope.ok === true && envelope.result
          && envelope.result.source === expected.source && envelope.result.lab === expected.lab) {
          return envelope.result;
        }
        last = 'ping did not identify the intended source/lab: ' + JSON.stringify(envelope && envelope.result);
      } catch (error) {
        if (stopped) dead();
        last = String(error && error.message ? error.message : error);
      } finally {
        clearTimeout(timer);
        clearTimeout(attemptTimer);
      }
      await new Promise((ok) => setTimeout(ok, 250));
    }
  } finally {
    if (child) {
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    }
  }
  throw new Error('[office-g0-xlsx] engine ping never identified the intended source/lab: ' + last);
}

/** Stop only the child this run owns; unobserved cleanup is reported, not assumed. */
/** Record a cleanup outcome and latch fail-closed on the thing that can actually leak: the owned
    PROCESS must be confirmed stopped. Descendant tree proof is reported SEPARATELY and honestly:
    a self-exited parent can never be tree-proven, so that unknown is recorded, never laundered. */
export function noteCleanupOutcome(record, label, outcome) {
  record.cleanup.push(Object.assign({ label }, outcome));
  if (outcome && outcome.parentExited !== true) record.ok = false;
  if (outcome && outcome.descendantProof === 'unknown') {
    record.descendantProof = [...new Set([...(record.descendantProof || []), label])];
  }
  return outcome;
}

/** Final ok = run succeeded AND every owned process is confirmed stopped. Proven descendant tree is
    recorded per entry but is NOT required, because a normal self-exit cannot yield tree proof. */
export function reconcileOk(record) {
  record.ok = record.ok === true && record.cleanup.every((entry) => entry.parentExited === true);
  return record.ok;
}

/** Latch a signal termination so a signal during an in-flight finalize cannot be lost or erased.
    The synthetic cleanup entry makes the latch irrevocable through reconcileOk. */
export function latchSignalFailure(record, reason) {
  const detail = reason || record.signalTermination || 'terminated by signal';
  record.signalTermination = detail;
  if (!record.primaryError) record.primaryError = detail;
  record.cleanup.push({
    label: 'signal', parentExited: false, proven: false, descendantProof: 'unknown',
    note: detail,
  });
  record.ok = false;
  return record;
}

/** The production ownership hooks main spreads into every runOwnedChild call. onSpawn registers the
    LIVE child synchronously (before any await), so a signal at any point can reach it through the
    set. onSettled releases it ONLY when cleanup confirmed the owned PARENT stopped (parentExited
    true); an unconfirmed child stays owned so the finalize sweep still stops it and records the
    failure, and a thrown onSpawn (which never reaches onSettled) leaves the child owned too. */
export function ownedChildHooks(ownedChildren) {
  return {
    onSpawn: (child) => { ownedChildren.add(child); },
    onSettled: (child, cleanup) => {
      if (cleanup && cleanup.parentExited === true) ownedChildren.delete(child);
    },
  };
}

/** The ONE structured write of a run, injectable so a test can prove a throwing writer never yields
    success, that a preexisting/colliding result path is refused rather than claimed, and that at most
    one successful write ever happens. Applies the signal latch, reconciles ok, and reports
    wrote/ok/exitCode/reason; on a refusal or a writer error it latches ok=false and appends the
    primary plus the persistence error (the error MESSAGE, never a stack prefix) instead of throwing.
    Never calls itself, so a broken writer cannot loop. */
export function persistResultOnce({ record, target, signalLatch = null, writer = fs.writeFileSync, exists = fs.existsSync } = {}) {
  if (signalLatch) {
    record.ok = false;
    if (!record.primaryError) record.primaryError = signalLatch;
  }
  reconcileOk(record);
  if (!record.primaryError && !record.ok) record.primaryError = 'run stopped before completion';
  if (exists(target)) {
    // Existence is NOT proof that THIS invocation wrote those bytes: the path may be a stale or
    // colliding artifact from another run. Refuse it with a non-zero outcome and leave the existing
    // bytes untouched instead of reporting a success this run never earned.
    record.ok = false;
    const detail = 'result persistence refused: ' + target
      + ' already exists; refusing to claim a result this run did not write';
    record.primaryError = record.primaryError ? record.primaryError + NL + detail : detail;
    return { wrote: false, error: null, ok: false, exitCode: 1, reason: 'exists' };
  }
  try {
    writer(target, JSON.stringify(record, null, 2) + NL, { flag: 'wx' });
  } catch (error) {
    record.ok = false;
    const detail = 'result persistence failed: ' + String((error && error.message) || error);
    record.primaryError = record.primaryError ? record.primaryError + NL + detail : detail;
    return { wrote: false, error, ok: false, exitCode: 1, reason: 'write-failed' };
  }
  return { wrote: true, error: null, ok: record.ok, exitCode: record.ok ? 0 : 1, reason: null };
}

const KILL_BOUND_MS = 1000;
const pendingKill = (timeoutMs) => new Promise((resolve) => {
  const t = setTimeout(() => resolve({
    attempted: true, ok: false, code: null, signal: null, timedOut: true, error: 'tree kill exceeded its bound',
  }), timeoutMs + KILL_BOUND_MS);
  if (typeof t.unref === 'function') t.unref();
});

/** Exact owned-tree stop for one Windows PID; never an image-name kill, never a guess.
    Bounds an injected taskkill too; signal, timeout or failure is never proof. */
export async function runTaskkillTree(pid, timeoutMs = CLEANUP_TIMEOUT_MS) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { attempted: false, ok: false, code: null, signal: null, timedOut: false, error: null };
  }
  let killer;
  try {
    killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    return { attempted: false, ok: false, code: null, signal: null, timedOut: false, error: String((error && error.message) || error) };
  }
  let spawnError = null;
  let timedOut = false;
  const settled = new Promise((resolve) => {
    killer.once('error', (error) => { spawnError = error; resolve(null); });
    killer.once('exit', (code, signal) => resolve({ code, signal }));
  });
  void settled.catch(() => undefined);
  const guard = setTimeout(() => { timedOut = true; try { killer.kill(); } catch { /* already gone */ } }, timeoutMs);
  const outcome = await Promise.race([settled, pendingKill(timeoutMs)]);
  clearTimeout(guard);
  if (outcome === null || outcome.ok === false) {
    return {
      attempted: true, ok: false, code: null, signal: null, timedOut: true,
      error: spawnError ? String(spawnError.message) : ((outcome && outcome.error) || 'taskkill did not report a bounded exit'),
    };
  }
  const code = outcome.code === null || outcome.code === undefined ? null : Number(outcome.code);
  const signal = outcome.signal === null || outcome.signal === undefined ? null : String(outcome.signal);
  return { attempted: true, ok: code === 0 && !timedOut && signal === null, code, signal, timedOut, error: null };
}

const cleanupPromises = new WeakMap();

/** Stop only the child this run spawned. Windows proves an owned tree by a successful bounded
    taskkill PLUS an observed owned-child exit; an unproven tree is reported, never assumed. */
export function stopOwnedChild(child, { timeoutMs = CLEANUP_TIMEOUT_MS, killTree = runTaskkillTree, observedExit = false } = {}) {
  if (!child) {
    return Promise.resolve({ stopped: true, existed: false, exited: true, parentExited: true, proven: true, descendantProof: 'not-applicable', forced: false, exitCode: null, signal: null, treeKill: null, note: 'no child was started' });
  }
  const prior = cleanupPromises.get(child);
  if (prior) return prior;
  const work = stopOwnedChildOnce(child, timeoutMs, killTree, observedExit);
  cleanupPromises.set(child, work);
  return work;
}

async function stopOwnedChildOnce(child, timeoutMs, killTree, observedExit) {
  if (child.exitCode !== null || child.signalCode !== null) {
    // The owned PARENT is gone, whether this run watched it exit or not. A parent exit is NOT
    // descendant tree proof: descendants may be orphaned. A recycled PID is never taskkilled and
    // the tree is never assumed clean. parentExited proves the process we own; proven stays false.
    return {
      stopped: true, existed: true, exited: true, parentExited: true, proven: false,
      descendantProof: 'unknown', forced: false,
      exitCode: child.exitCode, signal: child.signalCode, treeKill: null,
      note: 'owned parent already exited (parent exit observed by this run: ' + String(observedExit === true)
        + '); no live PID to bounded-taskkill, descendant exit was not observed and is never assumed clean',
    };
  }
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let forced = false;
  let treeKill = null;
  let observed = false;
  if (process.platform === 'win32') {
    forced = true;
    try {
      treeKill = await Promise.race([
        Promise.resolve().then(() => killTree(child.pid, timeoutMs)).catch((error) => ({
          attempted: true, ok: false, code: null, signal: null, timedOut: true, error: String((error && error.message) || error),
        })),
        pendingKill(timeoutMs),
      ]);
    } catch (error) {
      treeKill = { attempted: true, ok: false, code: null, signal: null, timedOut: true, error: String((error && error.message) || error) };
    }
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  const grace = Math.min(timeoutMs, CLEANUP_TIMEOUT_MS);
  // Each grace wait exists only to bound the exit it watches; store and CLEAR it the moment the race
  // settles so a finished stop never leaves a stray timer behind (F7).
  let graceTimer = null;
  let outcome = await Promise.race([exited, new Promise((resolve) => {
    graceTimer = setTimeout(() => resolve(null), grace);
  })]);
  if (graceTimer) clearTimeout(graceTimer);
  if (outcome !== null) observed = true;
  if (outcome === null) {
    forced = true;
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    let graceTimer2 = null;
    outcome = await Promise.race([exited, new Promise((resolve) => {
      graceTimer2 = setTimeout(() => resolve(null), grace);
    })]);
    if (graceTimer2) clearTimeout(graceTimer2);
    if (outcome !== null) observed = true;
  }
  const treeProven = treeKill ? treeKill.ok === true && treeKill.attempted === true && treeKill.timedOut !== true : false;
  const proven = process.platform === 'win32' ? (treeProven && observed) : observed;
  return {
    stopped: proven, existed: true, exited: observed, parentExited: observed, proven,
    descendantProof: proven ? 'proven' : 'unknown',
    forced,
    exitCode: outcome ? outcome.code : child.exitCode,
    signal: outcome ? outcome.signal : child.signalCode,
    treeKill,
    note: proven
      ? 'owned child tree reported a successful bounded taskkill plus an observed owned-child exit'
      : (observed
        ? 'owned child parent exited but its descendant tree kill was not proven'
        : 'child tree exit not proven: no bounded successful taskkill and no observed owned-child exit'),
  };
}

/** Run one owned child under a REAL deadline racer and a bounded cleanup; a never-exiting child or
    a hung kill cannot hang the runner, a timeout is never success, and no exit event is required.
    onSpawn hands the LIVE child to the caller's cancellation owner the instant it exists (synchronously,
    before any await), and onSettled releases that ownership only after cleanup has settled, so a signal
    during discovery/playwright can always reach and clean a child that has not settled yet. */
export async function runOwnedChild({
  command, args, options = {}, timeoutMs = 0,
  cleanupBoundMs = CLEANUP_TIMEOUT_MS + 2000, spawnImpl = spawn, killImpl,
  onSpawn = null, onSettled = null,
} = {}) {
  let child;
  try {
    child = spawnImpl(command, args, options);
  } catch (error) {
    throw Object.assign(new Error('[office-g0-xlsx] child failed to start: ' + String((error && error.message) || error)), {
      cleanup: { stopped: false, existed: false, exited: false, parentExited: false, proven: false, descendantProof: 'not-applicable', forced: false, exitCode: null, signal: null, treeKill: null, note: 'spawn threw before a child existed' },
    });
  }
  // Registered synchronously, before any await, so cancellation always sees this child.
  if (onSpawn) onSpawn(child);
  // Hoisted so the finally can decide release from the REAL cleanup outcome, not from whether the
  // promise settled. parentExited true means the process we own was confirmed stopped; anything
  // else is not a safe release and must stay owned for the finalize sweep.
  let cleanup = null;
  try {
    const CAPTURE_LIMIT = 1024 * 1024;
    let stdout = '';
    let stderr = '';
    const capture = (current, chunk) => (current.length >= CAPTURE_LIMIT ? current : (current + chunk.toString('utf8')).slice(0, CAPTURE_LIMIT));
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout = capture(stdout, chunk); });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr = capture(stderr, chunk); });
    let spawnError = null;
    let wakeDeadline;
    const deadlineReached = new Promise((resolve) => { wakeDeadline = resolve; });
    const exited = new Promise((resolve) => child.once('exit', (status, signal) => resolve({ status, signal })));
    const failed = new Promise((resolve) => child.once('error', (error) => { spawnError = error; resolve(null); }));
    const deadline = timeoutMs > 0 ? setTimeout(() => wakeDeadline(), timeoutMs) : null;
    if (deadline && typeof deadline.unref === 'function') deadline.unref();
    const raced = await Promise.race([
      exited.then((value) => ({ kind: 'exit', value })),
      failed.then(() => ({ kind: 'error' })),
      deadlineReached.then(() => ({ kind: 'deadline' })),
    ]);
    if (deadline) clearTimeout(deadline);
    const timedOut = raced.kind === 'deadline';
    // The cleanup-bound timer only has to outlive the cleanup it bounds; clear it the moment either
    // side settles so a finished run never leaves a stray timer behind.
    let cleanupBoundTimer = null;
    cleanup = await Promise.race([
      stopOwnedChild(child, { killTree: killImpl, observedExit: raced.kind === 'exit' }),
      new Promise((resolve) => {
        cleanupBoundTimer = setTimeout(() => resolve({
          stopped: false, existed: true, exited: false, parentExited: false, proven: false, descendantProof: 'unknown', forced: true,
          exitCode: child.exitCode, signal: child.signalCode, treeKill: null,
          note: 'cleanup exceeded its bound (' + cleanupBoundMs + 'ms)',
        }), cleanupBoundMs);
        if (typeof cleanupBoundTimer.unref === 'function') cleanupBoundTimer.unref();
      }),
    ]);
    if (cleanupBoundTimer) clearTimeout(cleanupBoundTimer);
    if (raced.kind === 'error' || spawnError) {
      throw Object.assign(new Error('[office-g0-xlsx] child failed to start: ' + String(spawnError && spawnError.message)), { cleanup });
    }
    return {
      child, pid: child.pid,
      status: raced.kind === 'exit' ? raced.value.status : child.exitCode,
      signal: raced.kind === 'exit' ? (raced.value.signal ?? null) : child.signalCode,
      timedOut, stdout, stderr, cleanup,
    };
  } finally {
    // Ownership ends only after cleanup settled, and the hook is told WHAT settled: parentExited true
    // means the owned process is confirmed stopped. A bound-expired or otherwise unconfirmed cleanup,
    // and the spawn-error throw above, pass an outcome the caller must not read as stopped, so a
    // still-live child is NEVER released silently. A THROWN onSpawn never reaches this finally at
    // all, so its child stays owned too (the throwing observer cannot erase a live process).
    if (onSettled) onSettled(child, cleanup);
  }
}

/**
 * The ONE bounded cleanup sweep used by production finalization. stop() is INVOKED on every owned
 * child SYNCHRONOUSLY, before this function first awaits, so an earlier sibling stop that never
 * settles can no longer leave a later child un-stopped when the overall budget expires (F8). The
 * bound races CONFIRMATION only: an entry whose stop has not confirmed by the budget comes back as
 * `unconfirmed` and stays owned, is never awaited again past the bound and is never silently
 * released. A stop that REJECTS (sync or async) becomes a structured unconfirmed outcome, never
 * thrown past the sweep, so a rejected cleanup cannot skip the rest. Results are returned in ENTRY
 * ORDER, so every child keeps its OWN label and outcome whatever order the stops settle in.
 * Injectable `stop` lets a focused test drive the real sweep with fake children and no real
 * process kill.
 */
export async function finalizeOwnedChildren(entries, { boundMs = FINALIZE_CLEANUP_BOUND_MS, stop = stopOwnedChild } = {}) {
  const list = [...entries];
  const results = new Array(list.length);
  const unconfirmedOutcome = () => ({
    stopped: false, existed: true, exited: false, parentExited: false, proven: false,
    descendantProof: 'unknown', forced: false, exitCode: null, signal: null, treeKill: null,
    note: 'finalize cleanup exceeded its overall bound (' + boundMs + 'ms); the owned process is NOT confirmed stopped and stays owned',
  });
  // Invoke stop() for EVERY owned child here, synchronously and in list order, before any await. The
  // old sequential loop is what let an earlier never-settling stop starve every later sibling.
  const confirmations = list.map((entry, index) => {
    let work;
    try {
      work = Promise.resolve(stop(entry.child, entry.observedExit === undefined ? {} : { observedExit: entry.observedExit }));
    } catch (error) {
      work = Promise.reject(error);
    }
    return work.then(
      (outcome) => { results[index] = { label: entry.label, child: entry.child, outcome }; },
      (error) => {
        results[index] = {
          label: entry.label, child: entry.child,
          outcome: {
            stopped: false, existed: true, exited: false, parentExited: false, proven: false,
            descendantProof: 'unknown', forced: false, exitCode: null, signal: null, treeKill: null,
            note: 'finalize cleanup stop threw: ' + String((error && error.message) || error),
          },
        };
      },
    );
  });
  const all = Promise.all(confirmations);
  let boundTimer = null;
  const bound = new Promise((resolve) => {
    boundTimer = setTimeout(() => resolve(null), boundMs);
    if (typeof boundTimer.unref === 'function') boundTimer.unref();
  });
  const raced = await Promise.race([all.then(() => true), bound]);
  if (boundTimer) clearTimeout(boundTimer);
  const complete = raced === true;
  const settled = results.filter((entry) => entry !== undefined);
  const unconfirmed = complete ? [] : list
    .map((entry, index) => (results[index] === undefined ? { label: entry.label, child: entry.child, outcome: unconfirmedOutcome() } : null))
    .filter((entry) => entry !== null);
  return { settled, unconfirmed, complete, invoked: list.length };
}

/**
 * Spawn the engine host as an OWNED child: registered synchronously in the owner set before any await
 * (exactly like runOwnedChild's onSpawn), so a signal at any point can reach it and finalize's bounded
 * sweep includes it. Injecting spawnImpl lets a focused test drive the real ownership wiring with no
 * real process. main calls this.
 */
export function startOwnedEngineChild({ command, args, options, spawnImpl = spawn, ownedChildren, onExit = null }) {
  const child = spawnImpl(command, args, options);
  ownedChildren.add(child);
  if (typeof onExit === 'function') child.once('exit', onExit);
  return child;
}

/** Close the lab within a bound; a close that never settles is a cleanup failure. */
export async function closeWithin(server, timeoutMs = SERVER_CLOSE_TIMEOUT_MS) {
  if (!server) return { proven: true, error: null };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, timeoutMs);
  // The race timer only matters while the close is in flight; store and clear it on settlement so a
  // finished close never keeps the process referenced for the rest of the window (F7).
  let closeTimer = null;
  try {
    await Promise.race([
      Promise.resolve().then(() => server.close()),
      new Promise((resolve) => { closeTimer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch (error) {
    return { proven: false, error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
    if (closeTimer) clearTimeout(closeTimer);
  }
  return timedOut ? { proven: false, error: 'lab server close exceeded ' + timeoutMs + 'ms' } : { proven: true, error: null };
}

/**
 * The ONE production persist / finalize / signal / ownership wiring, extracted so main calls the SAME
 * code a focused test can drive with injected I/O only. It owns: the single structured persistence
 * with its explicit commit boundary, the ONE memoized bounded finalization, the bounded cleanup sweep
 * and the signal path that can never persist ok=true after a signal. No server bind, no spawn, no
 * browser and no process kill happens here; exit, stderr, writer, stop and close are all injectable.
 */
export function createRunFinalizer({
  record, resultPath,
  ownedChildren = new Set(),
  engineLog = null, runLog = null,
  getServer = () => null,
  getEngineChild = () => null,
  isEngineExitObserved = () => false,
  cleanupBoundMs = FINALIZE_CLEANUP_BOUND_MS,
  persist = persistResultOnce,
  stop = stopOwnedChild,
  close = closeWithin,
  closeLog = (fd) => { try { fs.closeSync(fd); } catch { /* already closed */ } },
  writeStderr = (text) => process.stderr.write(text + NL),
  processRef = process,
  exit = (code) => processRef.exit(code),
} = {}) {
  let persisted = false;
  let finalizing = null;
  let signalLatch = null;

  const noteCleanup = (label, outcome) => {
    noteCleanupOutcome(record, label, outcome);
    if (outcome && outcome.parentExited !== true) {
      writeStderr('[office-g0-xlsx] ' + label + ' owned process not confirmed stopped: ' + JSON.stringify(outcome));
    }
    return outcome;
  };
  // Ownership is released ONLY when cleanup confirmed the owned PARENT stopped. An unconfirmed child
  // stays in the set so a later sweep still reaches it and the failure is recorded; the old
  // unconditional delete is what let a live process drop off the owner set (F1).
  const noteOwnedChild = (label, child, outcome) => {
    if (child && outcome && outcome.parentExited === true) ownedChildren.delete(child);
    return noteCleanup(label, outcome);
  };
  // Persist ONCE, latch only after a successful commit, and record the commit boundary explicitly: a
  // signal after this point cannot change the artifact, so it is reported as a separate diagnostic.
  const persistFinal = () => {
    if (persisted) return record;
    const stored = persist({ record, target: resultPath, signalLatch });
    persisted = stored.wrote;
    if (persisted) record.resultCommitted = true;
    processRef.exitCode = stored.exitCode;
    return record;
  };
  // ONE memoized bounded finalization shared by the finally and the signal path; a finalization
  // failure is caught and persisted ONCE as a structured primary+cleanup failure (never an unhandled
  // rejection, never exit 0 on a signal).
  const finalize = (reason) => {
    if (finalizing) return finalizing;
    finalizing = (async () => {
      if (reason && !record.primaryError) record.primaryError = reason;
      if (signalLatch) { record.ok = false; if (!record.primaryError) record.primaryError = signalLatch; }
      try {
        const engineChild = getEngineChild();
        const entries = [...ownedChildren].map((child) => ({
          label: child === engineChild ? 'engine-host' : 'owned-child',
          child,
          observedExit: child === engineChild ? isEngineExitObserved() : undefined,
        }));
        const swept = await finalizeOwnedChildren(entries, { boundMs: cleanupBoundMs, stop });
        for (const entry of swept.settled) noteOwnedChild(entry.label, entry.child, entry.outcome);
        for (const entry of swept.unconfirmed) noteOwnedChild(entry.label, entry.child, entry.outcome);
        const server = getServer();
        if (server) {
          const closed = await close(server);
          if (closed.proven !== true) noteCleanup('lab-server', closed);
        }
        record.records = server ? server.records() : [];
      } catch (error) {
        record.ok = false;
        const detail = 'finalization failed: ' + String((error && error.stack) || error);
        record.primaryError = record.primaryError ? record.primaryError + NL + detail : detail;
      } finally {
        if (engineLog !== null) closeLog(engineLog);
        if (runLog !== null) closeLog(runLog);
      }
      return persistFinal();
    })();
    finalizing = finalizing.catch((error) => {
      record.ok = false;
      const detail = 'finalization failed: ' + String((error && error.stack) || error);
      record.primaryError = record.primaryError ? record.primaryError + NL + detail : detail;
      return persistFinal();
    });
    return finalizing;
  };
  // onSignal only ever receives a named signal string; a signal during an in-flight finalize still
  // latches failure so the single persistence cannot write ok=true. A signal AFTER the commit boundary
  // cannot change the committed artifact, so it is recorded separately and never pretended persisted.
  const onSignal = (signal) => {
    signalLatch = 'terminated by ' + signal;
    latchSignalFailure(record, signalLatch);
    writeStderr('[office-g0-xlsx] received ' + signal + '; finalizing owned children and persisting the structured failure');
    if (record.resultCommitted === true) {
      record.postCommitSignal = signalLatch;
      writeStderr('[office-g0-xlsx] note: ' + signalLatch + ' arrived AFTER the result was committed; the committed artifact is unchanged (see postCommitSignal)');
    }
    void finalize(signalLatch).then(
      () => { exit(1); },
      (error) => {
        writeStderr('[office-g0-xlsx] finalization after ' + signal + ' failed: ' + String((error && error.stack) || error));
        persistFinal();
        exit(1);
      },
    );
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  return {
    ownedChildren,
    noteCleanup,
    noteOwnedChild,
    persistFinal,
    finalize,
    onSignal,
    attachSignals: () => { processRef.on('SIGINT', onSigint); processRef.on('SIGTERM', onSigterm); },
    detachSignals: () => { processRef.removeListener('SIGINT', onSigint); processRef.removeListener('SIGTERM', onSigterm); },
    get persisted() { return persisted; },
    get signalLatch() { return signalLatch; },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseRunnerArgs(argv, env);
  const plan = resolveRunnerPlan(args);
  const discovery = {
    mode: plan.mode,
    workspaceRoot: plan.workspaceRoot,
    candidate: plan.candidate,
    builds: plan.builds,
    source: plan.source,
    fixtures: plan.fixtures,
    manifest: plan.manifest,
    prefix: plan.prefix,
    ports: plan.ports,
    target: XLSX_TARGET,
    fixture: Object.assign({}, FIXTURE, { path: plan.fixture }),
    sourcePin: SOURCE_PIN,
    buildPrerequisite: BUILD_PREREQUISITE,
    hashes: hashFileList([
      plan.manifest, plan.spec, plan.config, plan.labServer, plan.engineHost,
      plan.tsxCli, plan.sidecar, plan.fixture, plan.buildEntry,
    ]),
  };
  if (plan.mode !== 'execute') {
    process.stdout.write(JSON.stringify(discovery, null, 2) + NL);
    return discovery;
  }

  const manifest = assertManifest({
    manifestBytes: fs.readFileSync(plan.manifest),
    expectedSha256: args.expectedManifestSha256,
  });
  const fixtureBytes = fs.readFileSync(plan.fixture);
  if (fixtureBytes.length !== FIXTURE.bytes || sha256Bytes(fixtureBytes) !== FIXTURE.sha256) {
    throw new Error('[office-g0-xlsx] fixture bytes do not match the pinned immutable fixture ' + FIXTURE.name);
  }
  for (const port of new Set([plan.ports.app, plan.ports.preview, plan.ports.engine])) {
    await assertPortFree(port);
  }

  const runtimeDir = plan.prefix + '-runtime';
  const artifacts = plan.prefix + '-artifacts';
  const tmpDir = path.join(runtimeDir, 'tmp');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // Every child this run starts keeps TEMP/TMP/TMPDIR inside the fresh runtime.
  const childTmp = { TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir };
  const engineLog = fs.openSync(plan.prefix + '-engine.txt', 'wx');
  const runLog = fs.openSync(plan.prefix + '-run.txt', 'wx');
  const engineBaseUrl = 'http://127.0.0.1:' + plan.ports.engine;
  const record = Object.assign({}, discovery, {
    ok: false, status: null, signal: null, timedOut: false, manifest,
    engine: { pid: null, baseUrl: engineBaseUrl, identity: 'pending /engine/ping verification', ping: null },
    origins: null, records: [], discoveryList: [], report: null,
    runLog: plan.prefix + '-run.txt', engineLog: plan.prefix + '-engine.txt', tmpDir,
    primaryError: null, cleanup: [],
  });
  let engineChild = null;
  let server = null;
  let engineExitObserved = false;
  // The persist / finalize / signal / ownership wiring lives in ONE exported seam (createRunFinalizer)
  // so a focused test drives the REAL production path with injected I/O only. main hands in the child
  // owner set and reads live server/engine state through getters.
  const ownedChildren = new Set();
  const finalizer = createRunFinalizer({
    record,
    resultPath: plan.prefix + '-result.json',
    ownedChildren,
    engineLog,
    runLog,
    getServer: () => server,
    getEngineChild: () => engineChild,
    isEngineExitObserved: () => engineExitObserved,
  });
  const noteCleanup = finalizer.noteCleanup;
  finalizer.attachSignals();
  const playwrightEnv = (origins) => Object.assign({}, process.env, childTmp, {
    OFFICE_G0_LAB_URL: origins.app,
    OFFICE_G0_PREVIEW_URL: origins.preview,
    OFFICE_G0_FIXTURES_DIR: plan.fixtures,
    PLAYWRIGHT_OUTPUT_DIR: artifacts,
    OFFICE_G0_SOURCE_PIN: SOURCE_PIN,
    OFFICE_G0_BUILD_MANIFEST_SHA256: manifest.sha256,
    OFFICE_G0_XLSX_SHEET: XLSX_TARGET.sheetName,
    OFFICE_G0_XLSX_CELL: XLSX_TARGET.cell,
  });
  try {
    const cli = resolvePlaywrightCli(plan.candidate);
    const labModule = await import(pathToFileURL(plan.labServer).href);
    server = labModule.createLabServer({
      buildsDir: plan.builds, labDir: runtimeDir, fixturesDir: plan.fixtures, sourceDir: plan.source,
      port: plan.ports.app, previewPort: plan.ports.preview, engineBaseUrl,
      engineHandlers: createXlsxEngineHandlers({ baseUrl: engineBaseUrl, fetchImpl: fetch }),
    });
    await server.listen();
    record.origins = server.origins;

    engineChild = startOwnedEngineChild({
      command: process.execPath,
      args: [plan.tsxCli, plan.engineHost, '--source', plan.source, '--lab', runtimeDir, '--port', String(plan.ports.engine)],
      options: { cwd: plan.candidate, windowsHide: true, stdio: ['ignore', engineLog, engineLog], env: Object.assign({}, process.env, childTmp) },
      ownedChildren,
      onExit: () => { engineExitObserved = true; },
    });
    record.engine.pid = engineChild.pid;
    // The error promise is created AND consumed in the SAME synchronous block as the spawn: a spawn
    // failure (including setup failing before the ping race is reached) can never become an
    // unhandled rejection, and it fails fast instead of burning the whole ping timeout.
    let engineSpawnFailure = null;
    const engineSpawnError = new Promise((resolve, reject) => {
      engineChild.once('error', (error) => { engineSpawnFailure = error; reject(error); });
    });
    void engineSpawnError.catch(() => undefined);
    record.engine.ping = await Promise.race([
      waitForEngineIdentity({ baseUrl: engineBaseUrl, expected: { source: plan.source, lab: runtimeDir }, child: engineChild }),
      engineSpawnError.then(
        () => { throw new Error('[office-g0-xlsx] engine host failed to start: ' + String((engineSpawnFailure && engineSpawnFailure.message) || engineSpawnFailure)); },
        (error) => { throw new Error('[office-g0-xlsx] engine host failed to start: ' + String((error && error.message) || error)); },
      ),
    ]);
    record.engine.identity = 'verified source+lab via /engine/ping';

    // Real discovery must list the slice tests before any browser execution.
    const discovered = await runOwnedChild({
      command: process.execPath,
      args: [cli, 'test', XLSX_SPEC, '--config', plan.config, '--list'],
      options: { cwd: path.join(plan.candidate, 'e2e'), windowsHide: true, stdio: ['ignore', 'pipe', runLog], env: playwrightEnv(server.origins) },
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      ...ownedChildHooks(ownedChildren),
    });
    noteCleanup('playwright-discovery', discovered.cleanup);
    if (discovered.cleanup.parentExited !== true) {
      throw new Error('[office-g0-xlsx] the discovery child was not confirmed stopped; failing closed before any browser execution: ' + JSON.stringify(discovered.cleanup));
    }
    if (discovered.timedOut) throw new Error('[office-g0-xlsx] test discovery exceeded its ' + DISCOVERY_TIMEOUT_MS + 'ms deadline');
    if (discovered.status !== 0) throw new Error('[office-g0-xlsx] test discovery exited with status ' + discovered.status + '; nothing was listed');
    const discoveryReport = parseDiscoveryListReport(discovered.stdout);
    const discoveryList = discoveryReport.identities;
    assertDiscoveryComplete(discoveryList, { report: discoveryReport });
    record.discoveryList = discoveryList;

    const run = await runOwnedChild({
      command: process.execPath,
      args: [cli, 'test', XLSX_SPEC, '--config', plan.config],
      options: { cwd: path.join(plan.candidate, 'e2e'), windowsHide: true, stdio: ['ignore', runLog, runLog], env: playwrightEnv(server.origins) },
      timeoutMs: EXECUTION_TIMEOUT_MS,
      ...ownedChildHooks(ownedChildren),
    });
    noteCleanup('playwright-run', run.cleanup);
    record.status = run.status;
    record.signal = run.signal;
    record.timedOut = run.timedOut;
    if (run.timedOut) throw new Error('[office-g0-xlsx] the Playwright run exceeded its ' + EXECUTION_TIMEOUT_MS + 'ms deadline; a timeout is never success');
    if (run.cleanup.parentExited !== true) throw new Error('[office-g0-xlsx] the Playwright child was not confirmed stopped; refusing to claim a run');
    if (run.cleanup.descendantProof === 'unknown') {
      process.stderr.write('[office-g0-xlsx] note: the Playwright child exited on its own, so its descendant tree is UNKNOWN (parent stopped, tree not proven)' + NL);
    }
    if (run.status !== 0) throw new Error('[office-g0-xlsx] Playwright exited with status ' + run.status + '; see the preserved run log');
    const reportPath = path.join(artifacts, REPORT_NAME);
    if (!fs.existsSync(reportPath)) throw new Error('[office-g0-xlsx] Playwright produced no ' + REPORT_NAME + '; refusing to claim a run');
    const summary = summarizePlaywrightReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
    assertReportProvesRealRun(summary, { specFile: XLSX_SPEC, discovery: discoveryList });
    record.report = { path: reportPath, name: REPORT_NAME, summary };
    record.ok = true;
    return record;
  } catch (error) {
    record.primaryError = String((error && error.stack) || error);
    process.stderr.write('[office-g0-xlsx] runner failed: ' + record.primaryError + NL);
  } finally {
    try {
      await finalizer.finalize(null);
    } finally {
      finalizer.detachSignals();
    }
  }
  return record;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
})();

if (isDirectRun) {
  main().then(
    () => undefined,
    (error) => {
      process.stderr.write('[office-g0-xlsx] runner failed: ' + String((error && error.stack) || error));
      process.exitCode = 1;
    },
  );
}

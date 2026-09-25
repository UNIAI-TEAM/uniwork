// DOC-004 (UNI-668) - REAL-ENGINE OUTPUT CHECKSUM harness (task 4.4).
//
// engine-contract.mjs MODELS the boundary with injected fakes (its
// EVIDENCE_REGISTRY says so). engine-contract-adapter.mjs drives the REAL DOC-003
// host but never feeds that output through the boundary's checksum rule. This file
// is the missing task-4.4 piece:
//
//   * it drives the REAL pinned DOCX engine host over its loopback transport and
//     takes the ACTUAL persisted artifact bytes and the checksum the engine
//     reported for them;
//   * it feeds that real result through the revised reference boundary
//     (createBoundary -> run -> serialize commit path), which recomputes the
//     digest over the actual bytes and refuses a mismatch with
//     engine_checksum_mismatch (status 502 / error_class engine / kind
//     output_checksum / retryable true / fidelity_preserved true);
//   * it injects the fault ONLY in the declared output checksum field at an
//     explicitly named seam AFTER the real engine produced its output. The bytes
//     the engine returned are never altered by this harness.
//
// REAL: the DOC-003 engine host, the loopback HTTP call, the DOCX route, the
// artifact bytes on disk. CONTROLLED FAULT: the one declared checksum field.
// MODELED: reference-boundary auth/grant, object storage and version commit (the
// boundary's own in-memory fakes). This is not the Go service, not product
// storage, not ACL and not deployed fault coverage; no offline/self-contained
// claim is made.
//
// Node 22 builtins only. The boundary and frozen launcher are imported. This
// revision validates checksum/length before storage in the boundary; the launcher
// stays unchanged. The harness boots/stops the host and proves port release.
//
//   node scripts/office-g0/engine-contract-adapter-checksum.mjs \
//     --work <fresh dir under .uniwork-dev> \
//     --source <prepared source> --node <pinned node> --engine-port 5391 \
//     --fixtures-source <dir holding g0-kitchen-sink.docx> [--print]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CONTRACT_VERSION,
  PROTOCOL_VERSION,
  createBoundary,
  createFakeObjectStore,
  createFakeDocuments,
  createLedger,
  sha256Bytes,
} from "./engine-contract.mjs";

import {
  buildHostCommand,
  describeError,
  ensureDirs,
  findWorkspaceRoot,
  probePortFree,
  renderCommand,
  resolveDefaults,
  spawnHost,
  stopOwnedChild,
  waitForIdentity,
  waitForPortRelease,
  assertWorkInsideWorkspace,
} from "./run-engine-contract-lab.mjs";

/** Named so evidence and a reviewer point at exactly where the fault enters. */
export const CHECKSUM_SEAM =
  "producer.run() result.declared_checksum, AFTER the real /engine/docx-edit produced bytes; the real bytes pass through unchanged";

export const CHECKSUM_CONTRACT_VERSION = "uniwork-office-engine-contract/1";
export const CHECKSUM_TRANSPORT = "loopback-http-post";
export const DOCX_FIXTURE = "g0-kitchen-sink.docx";
export const DOCX_ROUTE = "/engine/docx-edit";
export const VIEW_ID = "uni668-checksum-r1";
export const REAL_ENGINE_EDIT_TEXT = "UNI-668 CHECKSUM SEAM";
export const TAMPERED_BEHAVIOUR = "checksum_tamper";
export const UNTAMPERED_BEHAVIOUR = "checksum_ok";

const digest = (bytes) => sha256Bytes(bytes);

/** An independently computed sha256. Every digest this harness REPORTS for a file on
 * disk is computed with this, so it is never verified with the same helper the
 * boundary uses to validate the bytes. */
const independentDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/** Flip the first hex nibble so the declared digest is a value the engine never
 * reported, while staying a 64-hex string. */
export function tamperDigest(hex) {
  const flipped = (parseInt(hex.slice(0, 1), 16) ^ 0xf).toString(16);
  return flipped + hex.slice(1);
}

export const CHECKSUM_EVIDENCE = {
  kind: "real_engine_evidence_with_modeled_boundary",
  engine: "DOC-003 spike engine host (UNI-667) e2e/office-g0/engine-host.mts",
  boundary: "revised pre-storage reference boundary scripts/office-g0/engine-contract.mjs (createBoundary)",
  upstream_pin: "09485f884dc845cf3bf27fb7edfe489f9d457aad",
  fault_seam: CHECKSUM_SEAM,
  what_it_proves:
    "the ACTUAL bytes the real DOCX engine produced are accepted by the reference boundary when the engine's own reported checksum is used, and refused with engine_checksum_mismatch (502/engine/output_checksum/retryable) when only the DECLARED output checksum is altered after production",
  what_it_does_not_prove:
    "the Go service, product auth/ACL/tenant isolation, real object storage or commit durability, deployed fault coverage, or any product behavior beyond this boundary's checksum rule",
  zero_storage_puts_criterion: "MET",
  zero_storage_puts_note:
    "This revision hashes a private copy of the produced bytes and compares declared_checksum before any ledger row, store.put, or commitVersion. A mismatch records zero puts and zero commits. Earlier one-put evidence belongs to the previous revision and is not this run.",
  boundary_decision:
    "Advisor directed store.put to follow a matching declared_checksum. Declared length uses that same pre-storage check. A commit failure after a successful put still orphans the object.",
};

/** One loopback POST. Never throws: a transport failure is an observed result. */
export function createHttpClient({ baseUrl, timeoutMs = 30000, httpImpl = http } = {}) {
  return {
    baseUrl,
    post(route, body) {
      return new Promise((resolve) => {
        let url;
        try { url = new URL(route, baseUrl); } catch {
          resolve({ reachable: false, transport_error: "bad_base_url", transport_status: null, adapter_code: null, ok: false, result: null });
          return;
        }
        const payload = Buffer.from(JSON.stringify(body), "utf8");
        const request = httpImpl.request({
          protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
          headers: { "content-type": "application/json", "content-length": String(payload.length) },
        }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed = null;
            try { parsed = text.length === 0 ? null : JSON.parse(text); } catch { parsed = null; }
            const envelopeOk = parsed !== null && typeof parsed === "object" && parsed.ok === true;
            const ok = response.statusCode < 400 && envelopeOk;
            resolve({
              reachable: true, transport_status: response.statusCode, ok,
              adapter_code: ok ? null : (parsed && typeof parsed.code === "string" ? parsed.code : "unparsed_error"),
              result: ok ? (parsed.result ?? null) : null,
            });
          });
        });
        request.on("error", (error) => resolve({ reachable: false, transport_error: error.code ?? error.message, transport_status: null, adapter_code: null, ok: false, result: null }));
        request.setTimeout(timeoutMs, () => request.destroy(new Error("client_timeout")));
        request.write(payload);
        request.end();
      });
    },
  };
}

/**
 * Drive the REAL host for one path and capture its actual output.
 *
 * The frozen boundary calls `engine.run()` SYNCHRONOUSLY (engine-contract.mjs
 * `produced = eng.run({...})`), while a loopback HTTP call is asynchronous. So the
 * real engine is driven HERE, once, and its result is captured; the boundary then
 * validates that captured real result. The bytes are the engine's real artifact
 * read back from disk; the reported hash is the checksum the ENGINE reported.
 */
export async function fetchRealEngineOutput({ client, fixturePath, editText = REAL_ENGINE_EDIT_TEXT } = {}) {
  const observed = await client.post(DOCX_ROUTE, {
    viewId: VIEW_ID, path: fixturePath, text: editText, name: "uni668-checksum.docx",
  });
  if (!observed.ok) {
    const detail = observed.reachable
      ? "adapter returned " + observed.adapter_code
      : "host unreachable (" + (observed.transport_error ?? "no answer") + ")";
    const error = new Error("real engine produced no usable output: " + detail);
    error.adapter_code = observed.adapter_code ?? null;
    error.reachable = observed.reachable === true;
    throw error;
  }
  const artifactPath = observed.result.path;
  // Independently hash the ACTUAL artifact bytes the engine persisted.
  const onDisk = Buffer.from(fs.readFileSync(artifactPath));
  const engineReportedHash = observed.result.persistedHash;
  const diskHash = independentDigest(onDisk);
  return {
    transport: CHECKSUM_TRANSPORT,
    route: DOCX_ROUTE,
    view_id: VIEW_ID,
    artifact_path: artifactPath,
    bytes: onDisk,
    bytes_sha256: diskHash,
    bytes_length: onDisk.length,
    engine_reported_hash: engineReportedHash,
    engine_reported_length: observed.result.persistedBytes ?? onDisk.length,
    hash_matches_disk: engineReportedHash === diskHash,
  };
}

/**
 * A SYNCHRONOUS engine the frozen boundary can call, serving the CAPTURED real
 * engine result. The ONLY thing that differs between the accepted and refused
 * paths is the DECLARED output checksum:
 *
 *   behaviour !== TAMPERED -> declared_checksum = captured.engine_reported_hash
 *   behaviour === TAMPERED -> declared_checksum = tamperDigest(captured.engine_reported_hash)
 *
 * The bytes are always the captured real artifact, unchanged. This is the named
 * fault seam.
 */
export function createCapturedEngine({ captured }) {
  const calls = [];
  return {
    calls,
    run(request) {
      const tampered = request.behaviour === TAMPERED_BEHAVIOUR;
      const declared = tampered ? tamperDigest(captured.engine_reported_hash) : captured.engine_reported_hash;
      calls.push({
        behaviour: request.behaviour ?? null,
        declared_checksum: declared,
        declared_is_engine_value: declared === captured.engine_reported_hash,
        // The bytes this call actually served, so a caller can MEASURE that both
        // paths ran on the same capture instead of asserting it.
        served_bytes_sha256: independentDigest(captured.bytes),
        served_bytes_length: captured.bytes.length,
      });
      return {
        bytes: Buffer.from(captured.bytes),
        warnings: [],
        declared_checksum: declared,
        declared_length: captured.bytes_length,
      };
    },
  };
}
/** Wrap the boundary's storage/commit collaborators so a reviewer can read how
 * many writes/commits a job actually attempted. */
export function createAttemptSpies() {
  const real = createFakeObjectStore();
  const store = {
    objects: real.objects,
    deleted: real.deleted,
    objectUrl: (key) => real.objectUrl(key),
    puts: [],
    put(key, bytes) { this.puts.push(key); return real.put(key, bytes); },
    get: (key) => real.get(key),
    has: (key) => real.has(key),
    deleteObject: (key) => real.deleteObject(key),
  };
  const ledger = createLedger({ objectStore: store });
  const recordReal = ledger.record.bind(ledger);
  ledger.records = [];
  ledger.record = (entry) => { ledger.records.push(entry.job_id); return recordReal(entry); };

  const documents = createFakeDocuments();
  const commitReal = documents.commitVersion.bind(documents);
  documents.commitCalls = 0;
  documents.commitArgs = [];
  documents.commitVersion = (spec) => {
    documents.commitCalls += 1;
    documents.commitArgs.push({ job_id: spec.job_id, checksum: spec.checksum, length: spec.length });
    return commitReal(spec);
  };
  return { store, ledger, documents };
}

/** Build a serialize envelope carrying the ACTUAL real-engine bytes, submit it to
 * the reference boundary and run it with the given behaviour. */
export function driveSerializeThroughBoundary({ boundary, outputBytes, behaviour, idemSuffix = behaviour }) {
  const envelope = {
    request_id: "REQ-CHECKSUM-" + idemSuffix,
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    operation: "serialize",
    format: "docx",
    deadline_ms: 30000,
    idempotency_key: "IDEMP-CHECKSUM-" + idemSuffix,
    client_engine_version: "genoffice@09485f88+uniwork-office.0",
    payload: {
      document_model_ref: "engine-session:uni668-checksum",
      input_bytes: Buffer.from(outputBytes).toString("base64"),
      input_checksum: digest(outputBytes),
      input_length: outputBytes.length,
      base_revision: 7,
      base_version_id: "01J8Z0V0000000000000000A",
    },
  };
  const { job } = boundary.submit(envelope, { behaviour });
  boundary.run(job, { grant: boundary.grantFor(job) });
  return { job, envelope };
}

/**
 * The literal refusal oracle. Each key is an independent assertion. It is applied
 * to the REFUSED job (must be all true) AND to the ACCEPTED job as a
 * non-vacuity control (must be all false), so the oracle proves it can tell the
 * two apart instead of passing unconditionally.
 */
export function refusalOracle({ job, spies, expectedRevision, expectedVersionId = "01J8Z0V0000000000000000A" }) {
  const error = job.error ?? {};
  const ledgerRow = spies.ledger.get(job.job_id);
  return {
    state_failed: job.state === "failed",
    error_code_engine_checksum_mismatch: error.code === "engine_checksum_mismatch",
    error_status_502: error.status === 502,
    error_class_engine: error.error_class === "engine",
    error_kind_output_checksum: error.kind === "output_checksum",
    error_retryable_true: error.retryable === true,
    error_fidelity_preserved_true: error.fidelity_preserved === true,
    zero_version_commits: spies.documents.commitCalls === 0,
    zero_store_puts: spies.store.puts.length === 0,
    zero_ledger_records: spies.ledger.records.length === 0,
    no_ledger_row: ledgerRow == null,
    no_stored_objects: spies.store.objects.size === 0,
    no_output_key: job.output_key == null,
    revision_unchanged: spies.documents.currentRevision() === expectedRevision,
    version_pointer_unchanged: spies.documents.currentVersionId() === expectedVersionId,
    no_output_checksum_recorded: job.output_checksum === null || job.output_checksum === undefined,
  };
}

/**
 * Factual, non-oracle observations about what the rejected job did touch. Reported
 * so a reviewer sees the boundary's actual storage behaviour instead of a
 * claim the boundary does not make.
 */
export function refusalObservations({ job, spies, expectedRevision }) {
  const ledgerRow = spies.ledger.get(job.job_id);
  return {
    version_commits: spies.documents.commitCalls,
    staged_object_puts: spies.store.puts.length,
    ledger_rows: spies.ledger.records.length,
    stored_objects: spies.store.objects.size,
    output_key: job.output_key ?? null,
    ledger_attempts: ledgerRow ? (ledgerRow.attempts ?? 0) : 0,
    object_state: ledgerRow ? ledgerRow.object_state : null,
    current_revision: spies.documents.currentRevision(),
    current_version_id: spies.documents.currentVersionId(),
    revision_expected: expectedRevision,
    note:
      "declared checksum is compared before storage, so a checksum-refused job has zero puts, no ledger row, and zero version commits",
  };
}
function assertLexicallyInside(root, target, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error("refusing " + label + " outside " + resolvedRoot + ": " + resolved);
  }
  return resolved;
}

/** Refuse a writable path that crosses an existing link inside the lab. Nothing
 * is written before the check. */
export function assertNoReparseEscape(root, target, label) {
  assertLexicallyInside(root, target, label);
  let current = path.resolve(root);
  const rel = path.relative(current, path.resolve(target));
  if (rel === "") return path.resolve(target);
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("refusing " + label + " through a link inside the lab: " + current);
    }
  }
  return path.resolve(target);
}

const PROBE_OWNER_NAME = ".uni668-probe-owner";

function assertCleanupInside(scratchRoot, target) {
  const root = path.resolve(scratchRoot);
  const resolved = path.resolve(target);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error("refusing cleanup outside owned scratch " + root + ": " + resolved);
  }
  return resolved;
}

function exclusiveOwnedDir(parent, name, ownerId) {
  const dir = path.join(parent, name);
  assertNoReparseEscape(parent, dir, "probe acquire");
  if (fs.existsSync(dir)) {
    const error = new Error("probe target already exists: " + dir);
    error.code = "EEXIST";
    throw error;
  }
  fs.mkdirSync(dir);
  const marker = path.join(dir, PROBE_OWNER_NAME);
  const fd = fs.openSync(marker, "wx");
  try { fs.writeFileSync(fd, ownerId, "utf8"); }
  finally { fs.closeSync(fd); }
  return { dir, marker, ownerId };
}

function stillOwned(record) {
  try {
    const dirStat = fs.lstatSync(record.dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return false;
    const markerStat = fs.lstatSync(record.marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;
    return fs.readFileSync(record.marker, "utf8") === record.ownerId;
  } catch {
    return false;
  }
}

function removeOwnedDir(record, scratchRoot) {
  assertCleanupInside(scratchRoot, record.dir);
  assertCleanupInside(scratchRoot, record.marker);
  if (!stillOwned(record)) {
    throw new Error("refusing cleanup of a directory this invocation does not own: " + record.dir);
  }
  fs.rmSync(record.dir, { recursive: true, force: false });
}

function removeOwnedJunction(linkPath, scratchRoot) {
  const resolved = assertCleanupInside(scratchRoot, linkPath);
  const st = fs.lstatSync(resolved);
  if (!st.isSymbolicLink()) {
    throw new Error("refusing cleanup of a path that is not the junction this invocation created: " + resolved);
  }
  fs.rmdirSync(resolved);
}

/**
 * Exercise traversal and escaping-link refusal. The outside directory and the
 * in-lab link directory are unique names created exclusively by this call, with
 * an owner marker. Cleanup deletes only those owned paths. A pre-existing
 * sibling, including uni668-escape-target, is never adopted or removed.
 */
export function probeWritablePathContainment({
  labDir,
  id = crypto.randomBytes(8).toString("hex"),
  spawnImpl = spawnSync,
  beforeJunction = null,
} = {}) {
  const out = {
    probe_id: id,
    traversal_refused: false,
    junction_created: false,
    junction_refused: false,
    escaped_file_created: false,
    escape_target_removed: false,
    owned_resources_absent: false,
    acquisition_failed: false,
    cleanup_errors: [],
  };
  try {
    assertNoReparseEscape(labDir, path.join(labDir, "..", "escape-out"), "lexical traversal");
  } catch (error) {
    out.traversal_refused = true;
    out.traversal_reason = String(error.message);
  }

  const scratchRoot = path.dirname(path.resolve(labDir));
  const owned = { linkDir: null, outside: null, junctionPath: null, junctionCreated: false };
  try {
    owned.outside = exclusiveOwnedDir(scratchRoot, "uni668-owned-target-" + id, id);
    owned.linkDir = exclusiveOwnedDir(labDir, "uni668-owned-linkdir-" + id, id);
    const linkPath = path.join(owned.linkDir.dir, "uni668-owned-link-" + id);
    if (typeof beforeJunction === "function") {
      beforeJunction({ outsideDir: owned.outside.dir, linkPath, id });
    }
    const made = spawnImpl("cmd.exe", ["/c", "mklink", "/J", linkPath, owned.outside.dir], { encoding: "utf8", windowsHide: true });
    owned.junctionCreated = Boolean(made) && made.status === 0;
    out.junction_created = owned.junctionCreated;
    if (!owned.junctionCreated) {
      out.acquisition_failed = true;
    } else {
      owned.junctionPath = linkPath;
      try {
        assertNoReparseEscape(labDir, path.join(linkPath, "written.mts"), "escaping link");
        out.junction_refused = false;
      } catch (error) {
        out.junction_refused = true;
        out.junction_reason = String(error.message);
      }
      out.escaped_file_created = fs.existsSync(path.join(owned.outside.dir, "written.mts"));
    }
  } catch (error) {
    out.acquisition_failed = true;
    out.acquire_error = String(error && error.message ? error.message : error);
  } finally {
    const errors = [];
    if (owned.junctionCreated && owned.junctionPath) {
      try {
        removeOwnedJunction(owned.junctionPath, labDir);
        owned.junctionPath = null;
      } catch (error) { errors.push(String(error.message)); }
    }
    if (owned.linkDir && !owned.junctionPath) {
      try { removeOwnedDir(owned.linkDir, labDir); }
      catch (error) { errors.push(String(error.message)); }
    }
    if (owned.outside) {
      try { removeOwnedDir(owned.outside, scratchRoot); }
      catch (error) { errors.push(String(error.message)); }
    }
    out.cleanup_errors = errors;
    const outsideGone = !owned.outside || !fs.existsSync(owned.outside.dir);
    const linkGone = !owned.linkDir || !fs.existsSync(owned.linkDir.dir);
    const junctionGone = !owned.junctionPath || !fs.existsSync(owned.junctionPath);
    out.escape_target_removed = Boolean(owned.outside) && outsideGone;
    out.owned_resources_absent = outsideGone && linkGone && junctionGone && errors.length === 0;
  }
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const argOf = (name, fallback = null) => {
    const index = argv.indexOf("--" + name);
    return index === -1 ? fallback : argv[index + 1] ?? fallback;
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const cwd = path.resolve(argOf("cwd", process.cwd()));
  const workspaceRoot = findWorkspaceRoot(cwd);
  if (!workspaceRoot) { fs.writeSync(1, "REFUSED: no shared workspace root found from " + cwd + "\n"); return 2; }
  const workDir = path.resolve(argOf("work", path.join(workspaceRoot, ".uniwork-dev", "uni668-checksum-work")));
  const outPath = path.resolve(argOf("out", path.join(workDir, "evidence", "engine-contract-adapter-checksum.json")));

  const devRoot = path.join(workspaceRoot, ".uniwork-dev");
  assertNoReparseEscape(devRoot, workDir, "--work");

  const plan = resolveDefaults({
    source: argOf("source", path.join(workspaceRoot, ".uniwork-dev", "office-g0", "bootstrap-source")),
    work: workDir,
    node: argOf("node", process.execPath),
    enginePort: Number(argOf("engine-port", "5391")),
    fixtures: null,
    prebundle: null,
    evidenceDir: null,
    hostEntry: null,
    tsx: null,
    manifest: null,
    expectedPin: null,
    upstreamCheckout: null,
    readinessTimeoutMs: undefined,
  }, { cwd, repoRoot });
  // Same FRESH-work containment the frozen launcher enforces: --work must be inside
  // the shared .uniwork-dev and overlap neither the pinned source, this checkout, the
  // shared office-g0 tree, the pinned tools tree, nor the sibling worktrees. Called
  // BEFORE ensureDirs so the freshness check sees the pre-run layout.
  assertWorkInsideWorkspace(plan, workspaceRoot);
  ensureDirs(plan);
  const baseUrl = 'http://127.0.0.1:' + plan.enginePort;
  plan.baseUrl = baseUrl;

  // The DOCX fixture must live INSIDE the lab (host contract: document paths are
  // lab-contained), so copy it read-only from the declared source into our lab.
  const fixturesSource = argOf("fixtures-source", null);
  const labFixturePath = path.join(plan.labDir, "fixtures", DOCX_FIXTURE);
  assertLexicallyInside(plan.labDir, labFixturePath, "fixture copy");
  let fixtureOrigin = null;
  if (fixturesSource) {
    const from = path.join(path.resolve(cwd, fixturesSource), DOCX_FIXTURE);
    if (fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(labFixturePath), { recursive: true });
      fs.copyFileSync(from, labFixturePath);
      fixtureOrigin = from;
    }
  }
  if (!fs.existsSync(labFixturePath)) {
    fs.writeSync(1, "REFUSED: no " + DOCX_FIXTURE + " available; pass --fixtures-source <dir>\n");
    return 2;
  }
  const fixtureHashBefore = independentDigest(fs.readFileSync(labFixturePath));

  const portFree = await probePortFree(plan.enginePort);
  if (!portFree.free) {
    fs.writeSync(1, "REFUSED: engine port " + plan.enginePort + " is in use; refusing to signal a foreign process: " + portFree.reason + "\n");
    return 2;
  }

  const host = spawnHost(plan);
  const startedAt = Date.now();
  const record = {
    issue: "UNI-668", parent_issue: "UNI-656",
    task: "DOC-004 task 4.4 - real-engine output checksum evidence",
    contract_version: CHECKSUM_CONTRACT_VERSION,
    transport: CHECKSUM_TRANSPORT,
    fault_seam: CHECKSUM_SEAM,
    work_dir: workDir, lab: plan.labDir, engine_port: plan.enginePort,
    node: process.version, platform: process.platform,
    host_command: renderCommand(buildHostCommand(plan)),
    fixture: { name: DOCX_FIXTURE, source: fixtureOrigin, sha256_before: fixtureHashBefore, sha256_after: null, unchanged: null },
    evidence: CHECKSUM_EVIDENCE,
    paths: {}, containment: null, oracle: null, negative_controls: {}, cleanup: null,
  };

  let exitCode = 0;
  try {
    const identity = await waitForIdentity({
      baseUrl,
      expected: { source: plan.sourceRoot, lab: plan.labDir, prebundle: plan.prebundlePath },
      child: host.child,
      requiredRoutes: [DOCX_ROUTE],
    });
    record.host_identity = identity;

    const client = createHttpClient({ baseUrl });

    // --- Capture the REAL engine output ONCE, then validate it twice ---
    // The boundary validates the captured real result synchronously; the bytes the
    // engine produced are never altered by the harness.
    const captured = await fetchRealEngineOutput({ client, fixturePath: labFixturePath });

    // --- Path 1: untampered real-engine output is ACCEPTED ---
    const acceptSpies = createAttemptSpies();
    const acceptEngine = createCapturedEngine({ captured });
    const acceptBoundary = createBoundary({ engine: acceptEngine, objectStore: acceptSpies.store, documents: acceptSpies.documents, ledger: acceptSpies.ledger, now: () => 0 });
    const accept = driveSerializeThroughBoundary({ boundary: acceptBoundary, outputBytes: captured.bytes, behaviour: UNTAMPERED_BEHAVIOUR });
    const acceptedOnDisk = accept.job.output_key ? acceptSpies.store.get(accept.job.output_key) : null;

    // --- Path 2: the SAME real bytes, only the DECLARED checksum altered ---
    const refuseSpies = createAttemptSpies();
    const refuseEngine = createCapturedEngine({ captured });
    const refuseBoundary = createBoundary({ engine: refuseEngine, objectStore: refuseSpies.store, documents: refuseSpies.documents, ledger: refuseSpies.ledger, now: () => 0 });
    const refuse = driveSerializeThroughBoundary({ boundary: refuseBoundary, outputBytes: captured.bytes, behaviour: TAMPERED_BEHAVIOUR });

    // --- Negative controls ---
    // (a) unreachable host must FAIL, never pass.
    const deadClient = createHttpClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 3000 });
    let unreachableFailed = false;
    try { await fetchRealEngineOutput({ client: deadClient, fixturePath: labFixturePath }); }
    catch { unreachableFailed = true; }
    // (b) missing fixture must FAIL, never pass.
    let missingFixtureFailed = false;
    try { await fetchRealEngineOutput({ client, fixturePath: path.join(plan.labDir, "fixtures", "does-not-exist.docx") }); }
    catch { missingFixtureFailed = true; }
    // (c) an accepted job must NOT satisfy the refusal oracle (the oracle can tell
    //     the two apart, so a bypass that skipped checksum validation is detected).
    const acceptAsRefusal = refusalOracle({ job: accept.job, spies: acceptSpies, expectedRevision: 7 });
    const acceptedJobFailsRefusalOracle = Object.values(acceptAsRefusal).every((v) => v === false);
    // (d) a NON-checksum refusal must not count as the target result.
    const wrongErrorJob = { ...refuse.job, error: { ...refuse.job.error, code: "engine_crashed", kind: "engine_unavailable" } };
    const wrongRefusalOracle = refusalOracle({ job: wrongErrorJob, spies: refuseSpies, expectedRevision: 7 });
    const nonChecksumRefusalRejected = wrongRefusalOracle.error_code_engine_checksum_mismatch === false
      && wrongRefusalOracle.error_kind_output_checksum === false;
    const refuseOracle = refusalOracle({ job: refuse.job, spies: refuseSpies, expectedRevision: 7 });
    const containment = probeWritablePathContainment({ labDir: plan.labDir });

    record.paths = {
      accept: {
        real_bytes_sha256: captured.bytes_sha256,
        real_bytes_length: captured.bytes_length,
        engine_reported_hash: captured.engine_reported_hash,
        engine_reported_length: captured.engine_reported_length,
        independent_disk_hash: captured.bytes_sha256,
        hash_matches_disk: captured.hash_matches_disk,
        declared_checksum: acceptEngine.calls[0].declared_checksum,
        declared_is_engine_value: acceptEngine.calls[0].declared_is_engine_value,
        job_state: accept.job.state, job_error: accept.job.error,
        output_checksum: accept.job.output_checksum, output_length: accept.job.output_length,
        versions_committed: acceptSpies.documents.commitCalls,
        store_puts: acceptSpies.store.puts.length,
        committed_bytes_match_real: acceptedOnDisk ? independentDigest(acceptedOnDisk) === captured.bytes_sha256 : false,
        accepted_artifact_path: captured.artifact_path,
        accepted_artifact_sha256: captured.bytes_sha256,
      },
      refuse: {
        real_bytes_sha256: captured.bytes_sha256,
        real_bytes_length: captured.bytes_length,
        engine_reported_hash: captured.engine_reported_hash,
        declared_checksum: refuseEngine.calls[0].declared_checksum,
        declared_is_engine_value: refuseEngine.calls[0].declared_is_engine_value,
        declared_differs_from_engine: refuseEngine.calls[0].declared_checksum !== captured.engine_reported_hash,
        job_state: refuse.job.state, job_error: refuse.job.error,
        observations: refusalObservations({ job: refuse.job, spies: refuseSpies, expectedRevision: 7 }),
      },
      negative_controls: {
        unreachable_engine_failed: unreachableFailed,
        missing_fixture_failed: missingFixtureFailed,
        accepted_job_fails_refusal_oracle: acceptedJobFailsRefusalOracle,
        non_checksum_refusal_rejected: nonChecksumRefusalRejected,
        // MEASURED, not asserted: both paths must have served bytes hashing to the
        // single captured artifact, and that must equal the bytes on disk.
        single_capture_used_for_both_paths:
          acceptEngine.calls[0].served_bytes_sha256 === refuseEngine.calls[0].served_bytes_sha256
          && acceptEngine.calls[0].served_bytes_sha256 === captured.bytes_sha256,
        single_capture_served_sha256: acceptEngine.calls[0].served_bytes_sha256,
        declarations_differ:
          acceptEngine.calls[0].declared_checksum !== refuseEngine.calls[0].declared_checksum,
        captured_bytes_match_disk: captured.bytes_sha256 === independentDigest(fs.readFileSync(captured.artifact_path)),
      },
    };
    record.containment = containment;
    // The real controls live under paths.negative_controls; mirror them at the top
    // level so that field is not a misleading always-empty object.
    record.negative_controls = record.paths.negative_controls;
    record.oracle = {
      accept: {
        state_completed: accept.job.state === "completed",
        no_error: accept.job.error == null,
        hash_matches_disk: captured.hash_matches_disk === true,
        declared_is_engine_value: acceptEngine.calls[0].declared_is_engine_value === true,
        output_checksum_equals_real_bytes: accept.job.output_checksum === captured.bytes_sha256,
        one_version_committed: acceptSpies.documents.commitCalls === 1,
        committed_bytes_match_real: record.paths.accept.committed_bytes_match_real === true,
      },
      refuse: refuseOracle,
      accept_not_satisfying_refusal_oracle: { value: acceptedJobFailsRefusalOracle },
    };

    // The fixture and the previously accepted good output must be untouched by the
    // rejected job.
    const fixtureHashAfter = independentDigest(fs.readFileSync(labFixturePath));
    record.fixture.sha256_after = fixtureHashAfter;
    record.fixture.unchanged = fixtureHashAfter === fixtureHashBefore;
    const acceptedArtifactUnchanged = fs.existsSync(captured.artifact_path)
      && independentDigest(fs.readFileSync(captured.artifact_path)) === captured.bytes_sha256;
    record.paths.refuse.accepted_output_unchanged = acceptedArtifactUnchanged;

    const checks = {
      ...Object.fromEntries(Object.entries(record.oracle.accept).map(([k, v]) => ["accept." + k, v])),
      ...Object.fromEntries(Object.entries(refuseOracle).map(([k, v]) => ["refuse." + k, v])),
      "refuse.declared_differs_from_engine": record.paths.refuse.declared_differs_from_engine === true,
      "refuse.accepted_output_unchanged": acceptedArtifactUnchanged === true,
      "fixture.unchanged": record.fixture.unchanged === true,
      "control.unreachable_engine_failed": unreachableFailed === true,
      "control.missing_fixture_failed": missingFixtureFailed === true,
      "control.accepted_job_fails_refusal_oracle": acceptedJobFailsRefusalOracle === true,
      "control.non_checksum_refusal_rejected": nonChecksumRefusalRejected === true,
      "control.declarations_differ": record.paths.negative_controls.declarations_differ === true,
      "control.captured_bytes_match_disk": record.paths.negative_controls.captured_bytes_match_disk === true,
      "control.single_capture_measured": record.paths.negative_controls.single_capture_used_for_both_paths === true,
      "containment.traversal_refused": containment.traversal_refused === true,
      "containment.junction_created": containment.junction_created === true,
      "containment.junction_refused": containment.junction_refused === true,
      "containment.escaped_file_created_false": containment.escaped_file_created === false,
      "containment.escape_target_removed": containment.escape_target_removed === true,
      "containment.owned_resources_absent": containment.owned_resources_absent === true,
    };
    record.checks = checks;
    const failed = Object.keys(checks).filter((k) => checks[k] !== true);
    record.passed = failed.length === 0;
    record.failed = failed;
    if (failed.length > 0) exitCode = 1;
  } catch (error) {
    record.harness_error = describeError(error);
    exitCode = 1;
  } finally {
    const stopped = await stopOwnedChild(host.child, {});
    const portReleased = await waitForPortRelease(plan.enginePort);
    record.cleanup = { host: stopped, portReleased };
    record.cleanup_ok = stopped.stopped === true && stopped.treeProven === true && portReleased.released === true;
    record.duration_ms = Date.now() - startedAt;
    assertLexicallyInside(workDir, outPath, "--out");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
    process.stdout.write("engine-contract-adapter-checksum: passed=" + record.passed
      + " failed=" + JSON.stringify(record.failed)
      + " cleanup_ok=" + record.cleanup_ok
      + " evidence=" + outPath + "\n");
    if (argv.includes("--print")) process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  }
  if (!record.cleanup_ok) exitCode = 1;
  return exitCode;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
})();

if (isDirectRun) {
  const code = await main();
  process.exitCode = code;
}









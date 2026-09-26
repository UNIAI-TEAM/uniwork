// UNI-668 (DOC-004 task 4.4) - tests for the real-engine output checksum harness.
//
// These tests exercise the harness LOGIC with an injected fake HTTP client and the
// revised reference boundary. They do NOT boot the real engine host: the host path
// is proven by a separate live harness run. What is
// proven here is that the seam tamper is exact, the refusal oracle is literal and
// non-vacuous, a checksum refusal records zero storage puts and version commits,
// and writable-path containment refuses
// traversal and an escaping link without deleting pre-existing paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { createBoundary } from "./engine-contract.mjs";
import {
  TAMPERED_BEHAVIOUR,
  UNTAMPERED_BEHAVIOUR,
  assertNoReparseEscape,
  createAttemptSpies,
  createCapturedEngine,
  driveSerializeThroughBoundary,
  fetchRealEngineOutput,
  probeWritablePathContainment,
  refusalOracle,
  tamperDigest,
} from "./engine-contract-adapter-checksum.mjs";
import { assertWorkInsideWorkspace } from "./run-engine-contract-lab.mjs";

// Scratch lives under the OS temp dir, never inside the source tree.
const scratchBase = fs.mkdtempSync(path.join(os.tmpdir(), "uni668-checksum-test-"));
const roots = [];
function scratch(label) {
  const dir = fs.mkdtempSync(path.join(scratchBase, label + "-"));
  roots.push(dir);
  return dir;
}
test.after(() => { for (const dir of roots) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** An independent sha256, so the module's checksum function is not verified against itself. */
const independentSha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * A fake HTTP client that writes a REAL artifact file to disk and returns the
 * engine-reported hash for it, exactly the shape /engine/docx-edit returns. This
 * lets the producer's declared_checksum logic be tested without a host.
 */
function fakeEditClient({ labDir, bytes, reportedHashOverride = null }) {
  const outDir = path.join(labDir, "out", "uni668-checksum-r1");
  fs.mkdirSync(outDir, { recursive: true });
  const artifactPath = path.join(outDir, "uni668-checksum.docx");
  fs.writeFileSync(artifactPath, bytes);
  const reported = reportedHashOverride ?? independentSha256(bytes);
  return {
    artifactPath,
    reportedHash: reported,
    async post() {
      return {
        reachable: true, transport_status: 200, ok: true, adapter_code: null,
        result: {
          path: artifactPath,
          persistedHash: reported,
          persistedBytes: bytes.length,
          outHash: reported,
          outBytes: bytes.length,
        },
      };
    },
  };
}

test("tamperDigest changes the digest while staying 64 lowercase hex, and never equals the input", () => {
  for (const digest of ["a".repeat(64), "0123456789abcdef".repeat(4), independentSha256(Buffer.from("x"))]) {
    const tampered = tamperDigest(digest);
    assert.match(tampered, /^[0-9a-f]{64}$/, "tampered digest must stay 64 hex chars");
    assert.notEqual(tampered, digest, "a tamper must change the value");
    // Reverting the nibble recovers the original, proving exactly one nibble moved.
    assert.equal(tamperDigest(tampered), digest, "the tamper is exactly one nibble");
  }
});

test("the captured real output declares the engine hash unchanged, and the tampered path declares a different hash over the SAME bytes", async () => {
  const labDir = scratch("producer-lab");
  const realBytes = Buffer.from("real docx artifact bytes for the seam test", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });

  // Captured from the real artifact on disk, hashed independently.
  assert.equal(captured.bytes_sha256, independentSha256(realBytes));
  assert.equal(captured.engine_reported_hash, independentSha256(fs.readFileSync(captured.artifact_path)));
  assert.equal(captured.hash_matches_disk, true);

  const engine = createCapturedEngine({ captured });
  const untampered = engine.run({ behaviour: UNTAMPERED_BEHAVIOUR });
  const tampered = engine.run({ behaviour: TAMPERED_BEHAVIOUR });

  // The BYTES are byte-identical; only the declaration moved.
  assert.deepEqual(untampered.bytes, tampered.bytes, "the two paths return identical real bytes");
  assert.equal(independentSha256(untampered.bytes), independentSha256(realBytes));
  assert.equal(untampered.declared_checksum, captured.engine_reported_hash, "untampered declares the engine value");
  assert.notEqual(tampered.declared_checksum, captured.engine_reported_hash, "tampered declares a value the engine did not report");
});

test("a capture against an unreachable host fails loudly and never returns output", async () => {
  const client = { async post() { return { reachable: false, transport_error: "ECONNREFUSED", transport_status: null, adapter_code: null, ok: false, result: null }; } };
  await assert.rejects(() => fetchRealEngineOutput({ client, fixturePath: "x.docx" }), /produced no usable output/);
});

test("a capture with a refused route code fails loudly and never returns output", async () => {
  const client = { async post() { return { reachable: true, transport_status: 200, adapter_code: "no_session", ok: false, result: null }; } };
  await assert.rejects(() => fetchRealEngineOutput({ client, fixturePath: "x.docx" }), /no_session/);
});

test("untampered real bytes are ACCEPTED and committed once with the real checksum", async () => {
  const labDir = scratch("accept-lab");
  const realBytes = Buffer.from("actual engine output for the accept path", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });
  const spies = createAttemptSpies();
  const engine = createCapturedEngine({ captured });
  const boundary = createBoundary({ engine, objectStore: spies.store, documents: spies.documents, ledger: spies.ledger, now: () => 0 });

  const { job } = driveSerializeThroughBoundary({ boundary, outputBytes: captured.bytes, behaviour: UNTAMPERED_BEHAVIOUR });

  assert.equal(job.state, "completed");
  assert.equal(job.error == null, true);
  assert.equal(job.output_checksum, independentSha256(realBytes), "the committed checksum is the hash of the real bytes");
  assert.equal(job.output_length, realBytes.length);
  assert.equal(spies.documents.commitCalls, 1, "an accepted job commits exactly one version");
  assert.equal(spies.store.puts.length, 1, "an accepted job stores exactly one object");
  const stored = spies.store.get(job.output_key);
  assert.equal(independentSha256(stored), job.output_checksum, "the stored bytes hash to the committed checksum");
});

test("a tampered DECLARED checksum is REFUSED with the full contract error and no version commit", async () => {
  const labDir = scratch("refuse-lab");
  const realBytes = Buffer.from("actual engine output for the refuse path", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });
  const spies = createAttemptSpies();
  const engine = createCapturedEngine({ captured });
  const boundary = createBoundary({ engine, objectStore: spies.store, documents: spies.documents, ledger: spies.ledger, now: () => 0 });

  // The bytes that reach the boundary are the REAL ones; only the declaration is wrong.
  const { job } = driveSerializeThroughBoundary({ boundary, outputBytes: captured.bytes, behaviour: TAMPERED_BEHAVIOUR });

  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "engine_checksum_mismatch");
  assert.equal(job.error.status, 502);
  assert.equal(job.error.error_class, "engine");
  assert.equal(job.error.kind, "output_checksum");
  assert.equal(job.error.retryable, true);
  assert.equal(job.error.fidelity_preserved, true);
  assert.equal(spies.documents.commitCalls, 0, "a refused job commits no version");
  assert.equal(spies.store.puts.length, 0, "a checksum mismatch stores nothing");
  assert.equal(spies.documents.currentRevision(), 7, "the revision is untouched");
  assert.equal(spies.documents.currentVersionId(), "01J8Z0V0000000000000000A", "the version pointer is untouched");
  assert.equal(job.output_checksum, null);
  assert.equal(job.output_length, null);
  assert.equal(spies.ledger.get(job.job_id), null);
});

test("the refusal oracle is non-vacuous: an accepted job does NOT satisfy it, and a non-checksum refusal does not either", async () => {
  const labDir = scratch("oracle-lab");
  const realBytes = Buffer.from("bytes used to prove the oracle discriminates", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });

  const acceptSpies = createAttemptSpies();
  const acceptBoundary = createBoundary({ engine: createCapturedEngine({ captured }), objectStore: acceptSpies.store, documents: acceptSpies.documents, ledger: acceptSpies.ledger, now: () => 0 });
  const accept = driveSerializeThroughBoundary({ boundary: acceptBoundary, outputBytes: captured.bytes, behaviour: UNTAMPERED_BEHAVIOUR });

  const refuseSpies = createAttemptSpies();
  const refuseBoundary = createBoundary({ engine: createCapturedEngine({ captured }), objectStore: refuseSpies.store, documents: refuseSpies.documents, ledger: refuseSpies.ledger, now: () => 0 });
  const refuse = driveSerializeThroughBoundary({ boundary: refuseBoundary, outputBytes: captured.bytes, behaviour: TAMPERED_BEHAVIOUR });

  const refuseResult = refusalOracle({ job: refuse.job, spies: refuseSpies, expectedRevision: 7 });
  const acceptResult = refusalOracle({ job: accept.job, spies: acceptSpies, expectedRevision: 7 });

  assert.equal(Object.values(refuseResult).every((v) => v === true), true, "every refusal assertion must hold for the refused job");
  assert.equal(Object.values(acceptResult).every((v) => v === false), true, "no refusal assertion may hold for the accepted job");
  // A non-checksum refusal must NOT satisfy the oracle (a different error code).
  const wrongError = { ...refuse.job, error: { ...refuse.job.error, code: "engine_crashed", kind: "engine_unavailable" } };
  const wrongResult = refusalOracle({ job: wrongError, spies: refuseSpies, expectedRevision: 7 });
  assert.equal(wrongResult.error_code_engine_checksum_mismatch, false, "a non-checksum refusal must not count as the target result");
  assert.equal(wrongResult.error_kind_output_checksum, false);
});
test("writable-path containment refuses lexical traversal and an escaping link", () => {
  const labDir = scratch("contain-lab");
  const containment = probeWritablePathContainment({ labDir });
  assert.equal(containment.traversal_refused, true, "a ../ path must be refused");
  // The junction proof is Windows-only; if the host refuses to create one the
  // observation is reported, never silently passed.
  if (process.platform === "win32") {
    assert.equal(containment.junction_created, true, "the escaping junction must be created to prove refusal: " + JSON.stringify(containment));
    assert.equal(containment.junction_refused, true, "a path through an escaping junction must be refused");
    assert.equal(containment.escaped_file_created, false, "nothing may be written outside the lab");
  }
});

test("assertNoReparseEscape refuses an absolute or outside target", () => {
  const labDir = scratch("assert-lab");
  assert.throws(() => assertNoReparseEscape(labDir, path.resolve(labDir, "..", "outside.txt"), "outside"), /outside/);
  assert.throws(() => assertNoReparseEscape(labDir, "C:/windows/evil.txt", "absolute"), /outside/);
  // A legitimate inside path is accepted.
  assert.equal(assertNoReparseEscape(labDir, path.join(labDir, "ok.txt"), "inside"), path.join(labDir, "ok.txt"));
});

test("the tampered-digest refusal is driven only by the declared checksum, not by bytes", async () => {
  // Same captured real bytes, two declarations: one declares the real digest and
  // one declares a tampered digest. This isolates the fault to the declaration.
  const labDir = scratch("seam-lab");
  const realBytes = Buffer.from("seam isolation bytes", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });

  const aSpies = createAttemptSpies();
  const aBoundary = createBoundary({ engine: createCapturedEngine({ captured }), objectStore: aSpies.store, documents: aSpies.documents, ledger: aSpies.ledger, now: () => 0 });
  const bSpies = createAttemptSpies();
  const bBoundary = createBoundary({ engine: createCapturedEngine({ captured }), objectStore: bSpies.store, documents: bSpies.documents, ledger: bSpies.ledger, now: () => 0 });

  const ok = driveSerializeThroughBoundary({ boundary: aBoundary, outputBytes: captured.bytes, behaviour: UNTAMPERED_BEHAVIOUR });
  const bad = driveSerializeThroughBoundary({ boundary: bBoundary, outputBytes: captured.bytes, behaviour: TAMPERED_BEHAVIOUR });
  assert.equal(ok.job.state, "completed");
  assert.equal(bad.job.state, "failed");
  assert.equal(bad.job.error.code, "engine_checksum_mismatch");
  // Both were fed identical bytes; the difference is only the declaration.
  assert.equal(captured.bytes_sha256, independentSha256(realBytes));
});

test("the single-capture claim is measured from the bytes each path actually served", async () => {
  const labDir = scratch("capture-measure-lab");
  const realBytes = Buffer.from("measured capture bytes", "utf8");
  const client = fakeEditClient({ labDir, bytes: realBytes });
  const captured = await fetchRealEngineOutput({ client, fixturePath: "unused.docx" });

  const okEngine = createCapturedEngine({ captured });
  const badEngine = createCapturedEngine({ captured });
  const okSpies = createAttemptSpies();
  const badSpies = createAttemptSpies();
  const okBoundary = createBoundary({ engine: okEngine, objectStore: okSpies.store, documents: okSpies.documents, ledger: okSpies.ledger, now: () => 0 });
  const badBoundary = createBoundary({ engine: badEngine, objectStore: badSpies.store, documents: badSpies.documents, ledger: badSpies.ledger, now: () => 0 });
  driveSerializeThroughBoundary({ boundary: okBoundary, outputBytes: captured.bytes, behaviour: UNTAMPERED_BEHAVIOUR });
  driveSerializeThroughBoundary({ boundary: badBoundary, outputBytes: captured.bytes, behaviour: TAMPERED_BEHAVIOUR });

  const a = okEngine.calls[0];
  const b = badEngine.calls[0];
  // The claim is a real comparison of served bytes, not a hardcoded true.
  assert.equal(a.served_bytes_sha256, b.served_bytes_sha256, "both paths served the same bytes");
  assert.equal(a.served_bytes_sha256, captured.bytes_sha256, "the served bytes are the captured artifact");
  assert.equal(a.served_bytes_sha256, independentSha256(realBytes));
  assert.notEqual(a.declared_checksum, b.declared_checksum, "only the declaration differs");
});

test("the harness enforces the frozen fresh-work containment guard", () => {
  const root = scratch("work-guard-lab");
  const devRoot = path.join(root, ".uniwork-dev");
  const sourceDir = path.join(devRoot, "office-g0", "bootstrap-source");
  fs.mkdirSync(sourceDir, { recursive: true });
  const deps = { realpathSync: (p) => p, existsSync: fs.existsSync };
  const planFor = (workDir) => ({
    cwd: root, sourceRoot: sourceDir, workDir,
    labDir: path.join(workDir, "lab"),
    evidenceDir: path.join(workDir, "evidence"),
    prebundlePath: path.join(workDir, "lab", "engine", "pptx-ops.mjs"),
    fixturesDir: path.join(workDir, "fixtures"),
    prebundleProvided: false, fixturesProvided: false,
  });

  // A work dir OUTSIDE the shared .uniwork-dev is refused.
  const outside = path.join(root, "not-under-dev");
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(() => assertWorkInsideWorkspace(planFor(outside), root, deps),
    /--work must be a fresh directory under/,
    "a work dir outside .uniwork-dev must be refused");

  // A work dir UNDER .uniwork-dev that already holds a lab tree is refused as not fresh.
  const used = path.join(devRoot, "uni668-guard-used");
  fs.mkdirSync(path.join(used, "lab"), { recursive: true });
  assert.throws(() => assertWorkInsideWorkspace(planFor(used), root, deps),
    /not fresh/,
    "an already-used work dir must be refused before it is adopted");

  // A fresh work dir under .uniwork-dev with no lab tree is accepted.
  const fresh = path.join(devRoot, "uni668-guard-fresh");
  fs.mkdirSync(fresh, { recursive: true });
  assert.equal(assertWorkInsideWorkspace(planFor(fresh), root, deps), root,
    "a fresh work dir under .uniwork-dev must be accepted");
});

function isolatedLab(label) {
  const parent = scratch(label + "-parent");
  const labDir = path.join(parent, "lab");
  fs.mkdirSync(labDir);
  return { parent, labDir };
}

function plantSentinel(parent) {
  const sentinelDir = path.join(parent, "uni668-escape-target");
  const sentinel = path.join(sentinelDir, "unrelated-existing-data.txt");
  fs.mkdirSync(sentinelDir);
  fs.writeFileSync(sentinel, "pre-existing sentinel\n");
  return sentinel;
}

test("a pre-existing escape-target directory survives the containment probe", () => {
  const { parent, labDir } = isolatedLab("sentinel-lab");
  const sentinel = plantSentinel(parent);
  const before = fs.readFileSync(sentinel);
  const containment = probeWritablePathContainment({ labDir });
  assert.equal(fs.existsSync(sentinel), true, "pre-existing sentinel must survive: " + JSON.stringify(containment));
  assert.deepEqual(fs.readFileSync(sentinel), before);
  if (process.platform === "win32") {
    assert.equal(containment.junction_created, true, JSON.stringify(containment));
    assert.equal(containment.junction_refused, true);
    assert.equal(containment.escape_target_removed, true, "the invocation-owned target must be removed");
    assert.equal(containment.owned_resources_absent, true, JSON.stringify(containment));
  }
});

test("a pre-existing junction and its target file are preserved", () => {
  if (process.platform !== "win32") return;
  const { parent, labDir } = isolatedLab("old-link-lab");
  const oldTarget = path.join(parent, "pre-existing-link-target");
  fs.mkdirSync(oldTarget);
  fs.writeFileSync(path.join(oldTarget, "keep.txt"), "keep");
  const oldLinkDir = path.join(labDir, "out");
  fs.mkdirSync(oldLinkDir);
  const oldLink = path.join(oldLinkDir, "uni668-escape-link");
  const made = spawnSync("cmd.exe", ["/c", "mklink", "/J", oldLink, oldTarget], { encoding: "utf8", windowsHide: true });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const containment = probeWritablePathContainment({ labDir });
  assert.equal(fs.readFileSync(path.join(oldTarget, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.lstatSync(oldLink).isSymbolicLink(), true);
  assert.equal(containment.owned_resources_absent, true, JSON.stringify(containment));
});

test("a failed junction creation removes only directories this invocation created", () => {
  const { parent, labDir } = isolatedLab("fail-link-lab");
  const sentinel = plantSentinel(parent);
  const containment = probeWritablePathContainment({
    labDir,
    spawnImpl() { return { status: 1, stdout: "", stderr: "mklink refused" }; },
  });
  assert.equal(containment.junction_created, false);
  assert.equal(containment.acquisition_failed, true);
  assert.equal(containment.owned_resources_absent, true, JSON.stringify(containment));
  assert.equal(fs.readFileSync(sentinel, "utf8"), "pre-existing sentinel\n");
  const names = fs.readdirSync(parent);
  assert.equal(names.some((name) => name.startsWith("uni668-owned-")), false, names.join(","));
});

test("exclusive acquire fails closed and does not delete a directory that already exists", () => {
  const { parent, labDir } = isolatedLab("exists-lab");
  const id = "fixedowner";
  const preExisting = path.join(parent, "uni668-owned-target-" + id);
  fs.mkdirSync(preExisting);
  fs.writeFileSync(path.join(preExisting, "keep.txt"), "keep");
  let spawned = false;
  const containment = probeWritablePathContainment({
    labDir,
    id,
    spawnImpl() { spawned = true; return { status: 0 }; },
  });
  assert.equal(spawned, false);
  assert.equal(containment.junction_created, false);
  assert.equal(containment.acquisition_failed, true);
  assert.equal(fs.readFileSync(path.join(preExisting, "keep.txt"), "utf8"), "keep");
});

test("a nested probe cannot delete another probe's still-owned target", () => {
  if (process.platform !== "win32") return;
  const parent = scratch("nested-probes");
  const labA = path.join(parent, "lab-a");
  const labB = path.join(parent, "lab-b");
  fs.mkdirSync(labA);
  fs.mkdirSync(labB);
  const sentinel = path.join(parent, "uni668-escape-target", "keep.txt");
  fs.mkdirSync(path.dirname(sentinel));
  fs.writeFileSync(sentinel, "keep");
  let outsideA = null;
  const resultA = probeWritablePathContainment({
    labDir: labA,
    beforeJunction(info) {
      outsideA = info.outsideDir;
      fs.writeFileSync(path.join(outsideA, "a.txt"), "a");
      const resultB = probeWritablePathContainment({ labDir: labB });
      assert.equal(fs.readFileSync(path.join(outsideA, "a.txt"), "utf8"), "a");
      assert.equal(resultB.escape_target_removed, true);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
    },
  });
  assert.equal(fs.existsSync(outsideA), false);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
  assert.equal(resultA.owned_resources_absent, true, JSON.stringify(resultA));
  assert.equal(resultA.junction_refused, true);
});

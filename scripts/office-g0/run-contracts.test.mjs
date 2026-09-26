import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  FAULT_CASES,
  PLAN_CASE_IDS,
  REQUIRED_CASE_IDS,
  buildEvidence,
  createModel,
  runAllCases,
} from "./run-contracts.mjs";
import { isVerifierShaped, pkceChallenge } from "./pkce.mjs";
import { REDIRECT_URI, isRegisteredCallback, parseCallback } from "./redirect.mjs";
import { createDraftStore } from "./draft-store.mjs";

// The harness is only evidence if it cannot quietly stop proving what it claims.
// These assertions are about the harness, not about the protocol: the protocol
// itself is pinned by each case's literal oracle in run-contracts.mjs.

const TMP_ROOT = process.env.UNIWORK_G0_TMP || os.tmpdir();
const mkdir = () => fs.mkdtempSync(path.join(TMP_ROOT, "uw-g0-"));

test("every mandatory fault case from the plan exists exactly once", () => {
  const ids = FAULT_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate fault case id");
  assert.deepEqual([...REQUIRED_CASE_IDS].sort(), [...ids].sort());
  for (const c of FAULT_CASES) {
    assert.ok(c.requirement.length > 0, c.id + " has no requirement text");
    assert.ok(c.expect && typeof c.expect === "object", c.id + " has no literal oracle");
    assert.equal(typeof c.run, "function", c.id + " has no runner");
  }
});

test("the plan's verbatim mandatory list is still covered", () => {
  // The plan lists 16 cases verbatim (Task 5, "Ca bat buoc"). The artifact adds
  // more; it may never drop one of these.
  assert.equal(PLAN_CASE_IDS.length, 16);
  for (const id of PLAN_CASE_IDS) {
    assert.ok(REQUIRED_CASE_IDS.includes(id), id + " is missing from the mandatory list");
  }
});

test("the review findings of the previous artifact are pinned by their own cases", () => {
  // Each id here is one of the documented defects. If a case is deleted, the
  // finding loses its evidence, so the list is asserted rather than implied.
  for (const id of [
    "draft-list-never-returns-payload",
    "draft-distinct-bases-kept-apart",
    "draft-scope-is-account-org-ws",
    "pkce-s256-is-base64url",
    "cursor-is-bound-to-account-and-scope",
    "snapshot-survives-retention-and-writers",
    "grant-targeted-revoke-id-only",
    "owner-acl-transition-fans-out",
    "conversion-carries-full-acl",
    "copy-records-provenance",
    "copy-requires-explicit-consent",
    "orphans-measured-before-retry",
    "unknown-resource-is-typed",
    "cursor-from-previous-log-expires-not-empty",
    "recovery-refuses-unmatched-base-half",
  ]) {
    assert.ok(REQUIRED_CASE_IDS.includes(id), id + " (a closed review finding) is missing");
  }
});

test("every fault case passes against its literal oracle", () => {
  const { results } = runAllCases({ workDir: TMP_ROOT });
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(
    failed.map((r) => ({ id: r.id, expected: r.expected, observed: r.observed })),
    [],
    "fault cases disagree with their literal oracles",
  );
});

test("the legacy BeginIdempotent gap is a MODELED comparison, not a run claim", () => {
  // Contract mode refuses a reused key with a different payload. Legacy mode is
  // the same model with the fingerprint switched off, standing in for
  // server/internal/service/idempotency.go: it keys on (org, ws, scope, key)
  // only and never compares payloads, so it replays the first response.
  const find = (fingerprint) =>
    runAllCases({ workDir: TMP_ROOT, idempotencyFingerprint: fingerprint }).results.find(
      (r) => r.id === "same-key-different-payload",
    );
  const contract = find(true).observed;
  const legacy = find(false).observed;
  assert.equal(contract.outcome, "error");
  assert.equal(contract.code, "idempotency_payload_mismatch");
  assert.equal(legacy.outcome, "replayed");
  assert.equal(legacy.versions, 2, "the replayed payload never becomes a version");
  // The evidence must not present this as execution of the Go code.
  const legacyEvidence = buildEvidence({
    results: runAllCases({ workDir: TMP_ROOT, idempotencyFingerprint: false }).results,
    dir: TMP_ROOT,
    legacy: true,
  });
  assert.match(legacyEvidence.mode, /modeled gap comparison/);
  assert.ok(legacyEvidence.limitations.some((line) => /not execution of the Go code/.test(line)));
});

test("draft persistence is real and the store never sees a caller's ACL", () => {
  const dir = mkdir();
  const keys = new Map([["account-a", crypto.createHash("sha256").update("k-a").digest()]]);
  const options = {
    dir,
    keyProvider: (accountId) => keys.get(accountId) ?? crypto.createHash("sha256").update(accountId).digest(),
    namespaceKey: crypto.createHash("sha256").update("ns").digest(),
  };
  const first = createModel(options);
  first.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  first.grant("doc-1", "account-a", "edit");
  const session = first.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  first.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "unsent", baseRevision: 1 });

  // A file per account, sealed, with no raw account id in its name.
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".draft"));
  assert.equal(files.length, 1, "the draft must be a filesystem write");
  assert.equal(files[0].includes("account-a"), false, "the file name leaks the account id");

  // A new model with no in-memory state still sees it, and reads the bytes back
  // only through recovery.
  const restarted = createModel(options);
  restarted.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  restarted.grant("doc-1", "account-a", "edit");
  const relogin = restarted.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const listed = restarted.listDrafts({ sessionId: relogin.sessionId });
  assert.equal(listed.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], "payload"), false);
  const recovered = restarted.recoverDraft({ sessionId: relogin.sessionId, docId: "doc-1", baseRevision: 1, baseVersion: 1 });
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.payload, "unsent");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the accepted store fails loudly and the model names a locked recovery", () => {
  // The revision request on the first store proposal: deriving the file name from
  // the encryption key made a wrong key look up a missing file and return [],
  // which reads as "no draft" rather than "unreadable". The accepted store names
  // its file from a separate namespace key, so the wrong key finds the file and
  // throws, and the model reports a named recovery-locked outcome, never [].
  const dir = mkdir();
  const namespaceKey = crypto.createHash("sha256").update("ns").digest();
  const good = crypto.createHash("sha256").update("k-good").digest();
  const bad = crypto.createHash("sha256").update("k-bad").digest();
  const writer = createDraftStore({ dir, keyProvider: () => good, namespaceKey });
  writer.write("account-a", [{ accountId: "account-a", orgId: "org-1", wsId: "ws-1", docId: "doc-1", payload:
  "secret", baseRevision: 1, baseVersion: 1, state: "dirty", updatedAt: 1 }]);
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".draft"));
  assert.equal(files.length, 1);
  const bytesBefore = fs.readFileSync(path.join(dir, files[0]));
  assert.throws(
    () => createDraftStore({ dir, keyProvider: () => bad, namespaceKey }).read("account-a"),
    (error) => error.code === "draft_unreadable",
  );

  // The wrong ENCRYPTION key still finds the file; the model turns that throw
  // into a named lock and refuses to write over bytes it cannot authenticate.
  const reader = createModel({ dir, keyProvider: () => bad, namespaceKey });
  reader.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  reader.grant("doc-1", "account-a", "edit");
  const session = reader.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const listed = reader.listDrafts({ sessionId: session.sessionId });
  const recovered = reader.recoverDraft({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, baseVersion:
  1 });
  let saveOutcome;
  try {
    reader.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "replacement", baseRevision: 1 });
    saveOutcome = "wrote";
  } catch (error) {
    saveOutcome = error.code;
  }
  assert.equal(fs.readFileSync(path.join(dir, files[0])).equals(bytesBefore), true, "a wrong key must not change the sealed bytes");
  assert.equal(listed.outcome, "recovery_locked");
  assert.equal(listed.reason, "draft_unreadable");
  assert.equal(recovered.outcome, "recovery_locked");
  assert.equal(saveOutcome, "draft_recovery_locked");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a draft is only removed by explicit discard or a confirmed commit", () => {
  const model = createModel();
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const draft = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "keep-me", baseRevision: 1 });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1);

  // A failed save leaves it alone.
  model.setQuotaLimit(0);
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "big", engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" } });
  assert.throws(() => model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId, baseRevision: 1, payload: "big", engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" } }), /quota_exceeded/);
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1, "a failed save must not drop the draft");

  // A confirmed commit consumes exactly the draft it came from.
  model.setQuotaLimit(8 * 1024);
  const upload2 = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "keep-me", engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" } });
  model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload2.uploadId, baseRevision: 1, payload: "keep-me", engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" }, fromDraftId: draft.draftId });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0, "a confirmed commit cleans its draft");

  // Explicit discard is the other legal path.
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "again", baseRevision: 2 });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1);
  model.discardDraft({ sessionId: session.sessionId, docId: "doc-1" });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0);
});

test("no draft API returns a payload without recovery", () => {
  const model = createModel();
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const secret = "UNSENT-MUST-NOT-LEAK";
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: secret, baseRevision: 1 });
  const listed = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(JSON.stringify(listed).includes(secret), false, "listDrafts leaked the payload");
  // No exported storage-only bypass exists at all.
  assert.equal(typeof model.storageOnlyDrafts, "undefined", "a public payload bypass must not exist");
});

test("every modeled error carries a status and a class the client can switch on", () => {
  for (const [code, spec] of Object.entries(ERROR_CODES)) {
    assert.ok([400, 401, 403, 404, 409, 410, 413, 422].includes(spec.status), code + " has an unexpected status");
    assert.ok(spec.errorClass.length > 0, code + " has no errorClass");
    assert.ok(spec.kind.length > 0, code + " has no kind");
  }
  assert.equal(
    ERROR_CODES.revision_conflict.errorClass,
    ERROR_CODES.document_version_conflict.errorClass,
    "both conflict codes must share one client class",
  );
  assert.ok(ERROR_CODES.copy_consent_required, "copy consent must be a typed refusal");
});

test("the evidence records the modeled-authorization limits", () => {
  const { results, dir } = runAllCases({ workDir: TMP_ROOT });
  const evidence = buildEvidence({ results, dir, legacy: false });
  assert.equal(evidence.issue, "UNI-669");
  assert.equal(evidence.modelVersion, "uniwork-office-g0-protocol/2");
  assert.equal(evidence.summary.failed, 0);
  assert.match(evidence.authorization, /modeled/);
  assert.match(evidence.evidenceLevel, /accepted office byte store/);
  assert.ok(evidence.limitations.some((line) => /no HTTP server/.test(line)));
  assert.ok(evidence.limitations.some((line) => /NOT product tenancy isolation/.test(line)));
  const limitations = evidence.limitations.join("\n");
  assert.match(limitations, /bounded byte-store execution only/);
  assert.match(limitations, /NOT product key management, service or browser evidence/);
  assert.ok(evidence.limitations.some((line) => /no crash\/power-loss durability/.test(line)));
});

test("the model refuses an unknown session instead of inventing one", () => {
  const model = createModel();
  assert.throws(() => model.openDocument({ sessionId: "nope", docId: "nope" }), /token_expired/);
});

test("the PKCE helper matches RFC 7636 Appendix B and uses base64url", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(pkceChallenge(verifier), challenge);
  assert.notEqual(pkceChallenge(verifier), crypto.createHash("sha256").update(verifier).digest("hex"));
  // A non-string is not a challenge at all; a malformed string still hashes but is
  // refused where it matters, by isVerifierShaped in the redeem path.
  assert.equal(pkceChallenge(undefined), null);
  assert.match(pkceChallenge("x"), /^[A-Za-z0-9\-_]{43}$/);
  assert.equal(isVerifierShaped("x"), false);
  assert.equal(isVerifierShaped(verifier), true);
});

test("only the exact uniwork-office callback is registered", () => {
  assert.equal(REDIRECT_URI, "uniwork-office://auth/callback");
  assert.equal(isRegisteredCallback("uniwork-office://auth/callback?code=c&state=s"), true);
  assert.equal(isRegisteredCallback("uniwork-office://auth/callback/"), false);
  assert.equal(isRegisteredCallback("genoffice://auth/callback?code=c"), false);
  assert.equal(isRegisteredCallback("https://evil.example/auth/callback"), false);
  assert.equal(parseCallback("uniwork-office://auth/callback?code=c&state=s").state, "s");
});

test("each case runs in its own directory so drafts cannot cross", () => {
  const { dir, results } = runAllCases({ workDir: TMP_ROOT });
  const caseDirs = fs.readdirSync(dir).filter((name) => name.startsWith("case-"));
  assert.equal(caseDirs.length, results.length, "every case needs its own isolated directory");
});

test("a failure before replacement is refused and loses no bytes", () => {
  // The accepted store replaces bytes only after an authenticated read of the old
  // file. Its beforeReplace hook stops the write between the durable staging file
  // and that check, so the previous ciphertext must survive byte-for-byte and the
  // write must never be reported as durable.
  const dir = mkdir();
  const keyProvider = () => crypto.createHash("sha256").update("k-one").digest();
  const namespaceKey = crypto.createHash("sha256").update("ns-one").digest();
  const model = createModel({ dir, keyProvider, namespaceKey });
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "first", baseRevision: 1 });
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".draft"));
  assert.equal(files.length, 1, "a durable model must write a real file");
  const bytesBefore = fs.readFileSync(path.join(dir, files[0]));

  const failing = createDraftStore({ dir, keyProvider, namespaceKey, beforeReplace: () => {
    const error = new Error("interrupted before replacement");
    error.code = "EIO";
    throw error;
  } });
  const restart = createModel({ dir, keyProvider, namespaceKey, draftStore: failing });
  restart.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  restart.grant("doc-1", "account-a", "edit");
  const relogin = restart.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  let failedWrite;
  try {
    failing.write("account-a", [{ accountId: "account-a", orgId: "org-1", wsId: "ws-1", docId: "doc-1", payload:
    "second", baseRevision: 1, baseVersion: 1, state: "dirty", updatedAt: 1 }]);
    failedWrite = { outcome: "persisted" };
  } catch (error) {
    failedWrite = { outcome: "error", code: error.code };
  }
  const listed = restart.listDrafts({ sessionId: relogin.sessionId });
  const recovered = restart.recoverDraft({ sessionId: relogin.sessionId, docId: "doc-1", baseRevision: 1, baseVersion:
  1 });
  assert.equal(failedWrite.code, "EIO");
  assert.equal(fs.readFileSync(path.join(dir, files[0])).equals(bytesBefore), true, "the old ciphertext must be untouched");
  assert.equal(listed.length, 1, "the readable draft must still be listed");
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.payload, "first", "no false empty recovery after a refused write");

  // The write report is captured honestly, never assumed: a replacement is
  // reported, and no path claims a power-loss guarantee.
  const report = createDraftStore({ dir, keyProvider, namespaceKey }).write("account-a", [
    { accountId: "account-a", orgId: "org-1", wsId: "ws-1", docId: "doc-1", payload: "second", baseRevision: 1,
    baseVersion: 1, state: "dirty", updatedAt: 1 },
  ]);
  assert.equal(report.persisted, true);
  assert.equal(report.replacedExisting, true);
  assert.equal(report.atomicReplace, true);
  assert.equal(report.powerLossGuarantee, false);
  assert.equal(typeof report.directorySync.synced, "boolean");
  fs.rmSync(dir, { recursive: true, force: true });
});

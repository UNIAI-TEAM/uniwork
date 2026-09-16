import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ERROR_CODES,
  FAULT_CASES,
  REQUIRED_CASE_IDS,
  buildEvidence,
  createModel,
  runAllCases,
} from "./run-contracts.mjs";

// The harness is only evidence if it cannot quietly stop proving what it claims.
// These assertions are about the harness, not about the protocol: the protocol
// itself is pinned by each case's literal oracle in run-contracts.mjs.

test("every mandatory fault case from the plan exists exactly once", () => {
  const ids = FAULT_CASES.map((c) => c.id);
  assert.deepEqual([...ids].sort(), [...REQUIRED_CASE_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, "duplicate fault case id");
  for (const c of FAULT_CASES) {
    assert.ok(c.requirement.length > 0, c.id + " has no requirement text");
    assert.ok(c.expect && typeof c.expect === "object", c.id + " has no literal oracle");
    assert.equal(typeof c.run, "function", c.id + " has no runner");
  }
});

test("the plan's mandatory list is covered", () => {
  // The plan lists, verbatim: two saves on one base; retry the same payload;
  // same key with other payload; lost response after commit; failed commit
  // leaves the current version; logout/restart with a draft; B cannot read or
  // send A's draft; A loses permission; A keeps permission but the base moved;
  // quota exhausted; permission revoked between upload and commit; copy from a
  // Work Product; tombstone and expired cursor; incompatible client/engine;
  // expired or reused token/code. The in-flight case pins the other half of the
  // idempotency contract — the same key while the first request is still
  // running — which the plan requires of the reference harness.
  assert.equal(REQUIRED_CASE_IDS.length, 21);
  for (const id of [
    "two-saves-same-base",
    "retry-same-payload",
    "same-key-different-payload",
    "lost-response-after-commit",
    "failed-commit-keeps-current",
    "logout-restart-with-draft",
    "account-b-cannot-reach-a-draft",
    "a-loses-permission",
    "a-has-permission-base-changed",
    "quota-exhausted",
    "revoke-between-upload-and-commit",
    "copy-from-work-product",
    "tombstone-and-expired-cursor",
    "client-engine-incompatible",
    "auth-code-expired-or-reused",
    "idempotency-in-flight",
    // Closed gaps found in review of this artifact: a feed cursor that stalled
    // on unreadable events, a tombstone that leaked to a non-reader, a copy that
    // lost its creator's access, a recovery that ignored base version, and draft
    // reads that bypassed the session.
    "feed-cursor-advances-past-unreadable",
    "tombstone-not-leaked-to-non-reader",
    "copy-keeps-creator-access",
    "recovery-checks-base-version",
    "draft-apis-require-matching-session",
  ]) {
    assert.ok(REQUIRED_CASE_IDS.includes(id), id + " is missing from the mandatory list");
  }
});

test("a feed cursor steps over events the actor cannot read", () => {
  // The defect this pins: when the first page consisted only of events the actor
  // could not read, the cursor stayed put and the client re-asked for the same
  // page forever. A cursor that does not advance is a hung sync, not a filter.
  const model = createModel({ changeRetention: 100 });
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", verifier: "verifier-0" });
  model.addDocument({ id: "doc-unreadable", orgId: "org-1", wsId: "ws-1", checksum: "hidden" });
  const upload = model.beginUpload({
    sessionId: session.sessionId,
    docId: "doc-1",
    baseRevision: 1,
    payload: "visible",
    engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" },
  });
  model.commitSave({
    sessionId: session.sessionId,
    docId: "doc-1",
    uploadId: upload.uploadId,
    baseRevision: 1,
    payload: "visible",
    engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" },
  });

  const first = model.readChanges({ sessionId: session.sessionId, cursor: "0", limit: 1 });
  const second = model.readChanges({ sessionId: session.sessionId, cursor: first.nextCursor, limit: 1 });
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].kind, "version_created");
  assert.notEqual(second.nextCursor, first.nextCursor, "the cursor must move past the unreadable event");
});

test("draft reads go through the session, not through a caller-supplied account", () => {
  const model = createModel();
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const a = model.loginAs({ accountId: "account-a", verifier: "verifier-a" });
  const b = model.loginAs({ accountId: "account-b", verifier: "verifier-b" });
  model.saveDraft({ sessionId: a.sessionId, docId: "doc-1", payload: "A-secret", baseRevision: 1 });

  assert.throws(
    () => model.listDrafts({ sessionId: b.sessionId, accountId: "account-a" }),
    /forbidden/,
    "B must not be able to name A's account on the draft path",
  );
  assert.equal(model.listDrafts({ sessionId: b.sessionId }).length, 0);

  // Logout revokes the session and stops reads, but it never destroys the bytes.
  model.revokeDevice(a.sessionId);
  assert.throws(() => model.listDrafts({ sessionId: a.sessionId }), /token_expired/);
  assert.equal(model.storageOnlyDrafts({ accountId: "account-a" }).length, 1);
});

test("every fault case passes against its literal oracle", () => {
  const { results } = runAllCases();
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(
    failed.map((r) => ({ id: r.id, expected: r.expected, observed: r.observed })),
    [],
    "fault cases disagree with their literal oracles",
  );
});

test("the current BeginIdempotent gap is a fact, not a claim", () => {
  // Contract mode refuses a reused key with a different payload. Legacy mode is
  // what server/internal/service/idempotency.go does today: it keys on
  // (organization, workspace, scope, key) only and never compares payloads, so
  // it replays the first response — the client is told payload-B was saved and
  // payload-B is nowhere. If this ever fails, either the gap was closed (good:
  // drop the legacy mode and this test) or the model stopped demonstrating it
  // (bad: the contract's required change lost its evidence).
  const find = (fingerprint) =>
    runAllCases({ idempotencyFingerprint: fingerprint }).results.find(
      (r) => r.id === "same-key-different-payload",
    );
  const contract = find(true).observed;
  const legacy = find(false).observed;
  assert.equal(contract.outcome, "error");
  assert.equal(contract.code, "idempotency_payload_mismatch");
  assert.equal(legacy.outcome, "replayed");
  assert.equal(legacy.versions, 2, "the replayed payload never becomes a version");
});

test("draft persistence is real: a fresh model reads it back from disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-g0-draft-"));
  const first = createModel({ dir });
  first.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  first.grant("doc-1", "account-a", "edit");
  const session = first.loginAs({ accountId: "account-a", verifier: "verifier-a" });
  first.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "unsent", baseRevision: 1 });

  // One file per account, with the payload in it — not a memory map.
  const file = path.join(dir, "drafts", "account-a.json");
  assert.ok(fs.existsSync(file), "the draft must be a filesystem write");
  assert.match(fs.readFileSync(file, "utf8"), /unsent/);
  assert.equal(first.storageOnlyDrafts({ accountId: "account-b" }).length, 0, "account B must not see A's draft file");

  // A new model with no in-memory state still sees it.
  const restarted = createModel({ dir });
  assert.equal(restarted.storageOnlyDrafts({ accountId: "account-a" })[0].payload, "unsent");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a draft is only removed by an explicit discard", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-g0-discard-"));
  const model = createModel({ dir });
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", verifier: "verifier-a" });
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "keep-me", baseRevision: 1 });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1);
  model.discardDraft({ sessionId: session.sessionId, docId: "doc-1" });
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every modeled error carries a status and a class the client can switch on", () => {
  // The client must never infer behaviour from a status code or a message
  // string: that is how 422-from-C-01 and 409-from-C-16 grew two conflict paths.
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
});

test("the evidence records the modeled-authorization limits", () => {
  const { dir, results } = runAllCases();
  const evidence = buildEvidence({ results, dir, legacy: false });
  assert.equal(evidence.issue, "UNI-669");
  assert.equal(evidence.modelVersion, "uniwork-office-g0-protocol/1");
  assert.equal(evidence.summary.failed, 0);
  assert.match(evidence.authorization, /modeled/);
  assert.equal(evidence.evidenceLevel, "reference model + real filesystem draft persistence");
  assert.ok(evidence.limitations.some((line) => /no HTTP server/.test(line)));
  assert.ok(evidence.limitations.some((line) => /NOT product tenancy isolation/.test(line)));
});

test("the model refuses an unknown session instead of inventing one", () => {
  const model = createModel();
  assert.throws(() => model.openDocument({ sessionId: "nope", docId: "nope" }), /token_expired/);
});

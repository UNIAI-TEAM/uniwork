import assert from "node:assert/strict";
import test from "node:test";
import { createModel } from "./run-contracts.mjs";

// UNI-669 cleanup/discard regression oracles. These are node:test units, not
// fault cases, so the 39-case default/legacy oracles and their counts stay put.

function cleanupHarness() {
  const model = createModel();
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.addDocument({ id: "doc-2", orgId: "org-1", wsId: "ws-1", checksum: "genesis-2" });
  model.grant("doc-1", "account-a", "edit");
  model.grant("doc-2", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  return { model, session, engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" } };
}

test("a confirmed commit removes exactly the draft it consumed", () => {
  const { model, session, engine } = cleanupHarness();
  const draft = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "bytes", baseRevision: 1,
  baseVersion: 1 });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: draft.draftId });
  assert.equal(committed.cleanup.outcome, "removed");
  assert.equal(committed.version, 2);
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0);
});

test("cleanup keeps a newer same-base local payload that no longer matches the commit", () => {
  const { model, session, engine } = cleanupHarness();
  const draft = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "old-bytes", baseRevision: 1,
  baseVersion: 1 });
  // The user keeps typing: the same base key is overwritten with newer bytes.
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "newer-bytes", baseRevision: 1,
  baseVersion: 1 });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "old-bytes", engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "old-bytes", engine, fromDraftId: draft.draftId });
  assert.equal(committed.cleanup.outcome, "retained");
  assert.equal(committed.cleanup.reason, "identity_mismatch");
  const listed = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(listed.length, 1, "the newer local edit must survive");
  assert.equal(listed[0].hasPayload, true);
  assert.equal(listed[0].bytes, "newer-bytes".length);
});

test("cleanup refuses a draft whose baseVersion is not the version the commit consumed", () => {
  const { model, session, engine } = cleanupHarness();
  const draft = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "bytes", baseRevision: 1,
  baseVersion: 2 });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: draft.draftId });
  assert.equal(committed.cleanup.outcome, "retained");
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1, "a wrong baseVersion keeps the draft");
});

test("cleanup never touches another document's draft", () => {
  const { model, session, engine } = cleanupHarness();
  const otherDoc = model.saveDraft({ sessionId: session.sessionId, docId: "doc-2", payload: "bytes", baseRevision: 1,
  baseVersion: 1 });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: otherDoc.draftId });
  assert.equal(committed.cleanup.outcome, "retained");
  assert.equal(committed.cleanup.reason, "identity_mismatch");
  const remaining = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].docId, "doc-2");
});

test("cleanup never reaches a draft in another workspace", () => {
  const { model, session, engine } = cleanupHarness();
  const ws2 = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-2" });
  const foreign = model.saveDraft({ sessionId: ws2.sessionId, docId: "doc-1", payload: "bytes", baseRevision: 1,
  baseVersion: 1, orgId: "org-1", wsId: "ws-2" });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: foreign.draftId });
  assert.equal(committed.cleanup.outcome, "retained");
  assert.equal(model.listDrafts({ sessionId: ws2.sessionId }).length, 1, "the ws-2 row survives");
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0);
});

test("cleanup reports a retained no-match instead of rewriting the store", () => {
  const { model, session, engine } = cleanupHarness();
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "bytes", baseRevision: 1, baseVersion:
  1 });
  const before = model.listDrafts({ sessionId: session.sessionId });
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: "no-such-draft" });
  assert.equal(committed.cleanup.outcome, "no_match");
  assert.equal(committed.cleanup.retained, true);
  assert.equal(committed.version, 2, "the independent commit still stands");
  assert.deepEqual(model.listDrafts({ sessionId: session.sessionId }), before);
});

test("a cleanup write failure keeps commit and draft, and a same-key retry replays it", () => {
  let rows = [];
  let failWrites = false;
  const store = {
    durable: false,
    read: (accountId) => rows.filter((row) => row.accountId === accountId).map((row) => ({ ...row })),
    write: (accountId, next) => {
      if (failWrites) return { succeeded: false, persisted: false, failure: "EIO" };
      rows = next.map((row) => ({ ...row }));
      return { succeeded: true, persisted: false, replacedExisting: false };
    },
  };
  const model = createModel({ draftStore: store });
  model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
  model.grant("doc-1", "account-a", "edit");
  const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const engine = { name: "uniwork-office", version: "1.0.0", status: "compatible" };
  const draft = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "bytes", baseRevision: 1,
  baseVersion: 1 });
  failWrites = true;
  const key = "k-cleanup-fail";
  const upload = model.beginUpload({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, payload: "bytes",
  engine });
  const committed = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: draft.draftId, idempotencyKey: key });
  assert.equal(committed.cleanup.outcome, "failed");
  assert.equal(committed.cleanup.retained, true);
  assert.equal(committed.version, 2, "the confirmed commit is not rolled back");
  const retry = model.commitSave({ sessionId: session.sessionId, docId: "doc-1", uploadId: upload.uploadId,
  baseRevision: 1, payload: "bytes", engine, fromDraftId: draft.draftId, idempotencyKey: key });
  assert.equal(retry.replayed, true);
  assert.equal(retry.version, 2);
  assert.equal(retry.cleanup.outcome, "failed", "the retry replays the committed result, never a third version");
  assert.equal(model.versionsOf("doc-1"), 2);
  assert.equal(rows.filter((row) => row.accountId === "account-a").length, 1, "draft bytes survive the failed cleanup");
});

test("discard is scoped and refuses to guess between bases", () => {
  const { model, session } = cleanupHarness();
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "base-1-1", baseRevision: 1, baseVersion:
  1 });
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "base-1-2", baseRevision: 1, baseVersion:
  2 });
  const ws2 = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-2" });
  model.saveDraft({ sessionId: ws2.sessionId, docId: "doc-1", payload: "ws-2-bytes", baseRevision: 1, baseVersion:
  1, orgId: "org-1", wsId: "ws-2" });

  const ambiguous = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1" });
  assert.equal(ambiguous.outcome, "ambiguous");
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 2, "ambiguous discard writes nothing");
  assert.equal(model.listDrafts({ sessionId: ws2.sessionId }).length, 1, "another workspace's row is not a candidate");

  const mismatch = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 9, baseVersion:
  9 });
  assert.equal(mismatch.outcome, "mismatch");
  assert.equal(mismatch.retained, true);
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 2, "a mismatching base must not discard a candidate");

  const partialMismatch = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 2 });
  assert.equal(partialMismatch.outcome, "mismatch");
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 2);

  const exact = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1", baseRevision: 1, baseVersion: 2 });
  assert.equal(exact.outcome, "discarded");
  assert.equal(exact.discarded, 1);
  const remaining = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].baseRevision, 1);
  assert.equal(remaining[0].baseVersion, 1);

  const single = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1" });
  assert.equal(single.outcome, "discarded", "a single remaining candidate stays convenient");
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 0);
  assert.equal(model.listDrafts({ sessionId: ws2.sessionId }).length, 1, "the ws-2 draft is untouched by every ws-1 discard");
});

test("discard never removes another document's draft", () => {
  const { model, session } = cleanupHarness();
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "d1", baseRevision: 1, baseVersion: 1 });
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-2", payload: "d2", baseRevision: 1, baseVersion: 1 });
  const result = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1" });
  assert.equal(result.outcome, "discarded");
  const listed = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].docId, "doc-2");
});

test("discard accepts an exact draftId only inside the session's own scope", () => {
  const { model, session } = cleanupHarness();
  const first = model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "b11", baseRevision: 1,
  baseVersion: 1 });
  model.saveDraft({ sessionId: session.sessionId, docId: "doc-1", payload: "b12", baseRevision: 1, baseVersion: 2 });
  const exact = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1", draftId: first.draftId });
  assert.equal(exact.outcome, "discarded");
  const remaining = model.listDrafts({ sessionId: session.sessionId });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].baseVersion, 2);

  const ws2 = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-2" });
  const foreign = model.saveDraft({ sessionId: ws2.sessionId, docId: "doc-1", payload: "ws2", baseRevision: 1,
  baseVersion: 1, orgId: "org-1", wsId: "ws-2" });
  const crossScope = model.discardDraft({ sessionId: session.sessionId, docId: "doc-1", draftId: foreign.draftId });
  assert.equal(crossScope.outcome, "mismatch", "a foreign draftId is not a ws-1 discard target");
  assert.equal(model.listDrafts({ sessionId: ws2.sessionId }).length, 1);
  assert.equal(model.listDrafts({ sessionId: session.sessionId }).length, 1);
});

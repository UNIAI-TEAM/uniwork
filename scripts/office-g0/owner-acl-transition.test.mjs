// owner-acl-transition.test.mjs - DOC-005 (UNI-669) focused owner ACL fan-out.
// Node 22 built-ins only. No HTTP, no product imports.
//
// One contract sentence, one literal oracle. docs/office/g0/login-sync-contract.md
// section 5 (C-01 section 13) says an owner-level CHANGE fans out to every
// document delegating to that owner, and only to the account whose level moved.
// This file imports the REAL createModel from run-contracts.mjs - it does not
// copy the production condition - and drives first grant -> repeat -> edit ->
// view -> edit -> clear, stating what each step must emit. A model that drifts
// fails instead of redefining success.
//
// run-contracts.mjs already has a case named owner-acl-transition-fans-out, but
// it covers only the first grant and the clear. edit -> view and view -> edit
// are exactly the transitions a first-grant-only fan-out drops silently, so they
// are the point of this file.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createModel } from "./run-contracts.mjs";

/** Read a snapshot plus its follow-up pages into one event list. */
function drain(model, sessionId, cursor = "0", limit = 100) {
  let page = model.readChanges({ sessionId, cursor, limit });
  const events = [...page.events];
  let guard = 0;
  while (page.mode === "snapshot" && !page.done) {
    if (guard++ > 50) throw new Error("snapshot pagination did not terminate");
    page = model.readChanges({ sessionId, cursor: page.nextCursor, limit });
    events.push(...page.events);
  }
  return { events, cursor: page.nextCursor, mode: page.mode };
}

/** A cursor sitting just after everything appended so far for this account. */
const settle = (model, sessionId) => drain(model, sessionId).cursor;

/** The exact fields a fan-out event must carry, sorted by document id. */
const eventsSince = (model, sessionId, cursor) =>
  model
    .readChanges({ sessionId, cursor, limit: 100 })
    .events.map(({ documentId, kind, revision, orgId, wsId, accountId, snapshot }) => ({
      documentId,
      kind,
      revision,
      orgId,
      wsId,
      accountId,
      snapshot,
    }))
    .sort((a, b) => a.documentId.localeCompare(b.documentId));

const granted = (documentId) => ({
  documentId,
  kind: "granted",
  revision: 1,
  orgId: "org-1",
  wsId: "ws-1",
  accountId: "account-a",
  snapshot: false,
});

const removed = (documentId) => ({
  documentId,
  kind: "removed",
  revision: null,
  orgId: "org-1",
  wsId: "ws-1",
  accountId: "account-a",
  snapshot: false,
});

/**
 * Two documents delegated to owner wp-1, one delegated to a DIFFERENT owner
 * wp-2, and one plain document with a direct ACL grant to account-a. The direct
 * document is deliberate: account-a can read it without any owner delegation, so
 * a fan-out that walked the ACL instead of the owner would show up here.
 */
function fixture() {
  const model = createModel();
  model.addDocument({ id: "wp-a", orgId: "org-1", wsId: "ws-1", checksum: "wpa", ownerKind: "work_product", ownerId: "wp-1" });
  model.addDocument({ id: "wp-b", orgId: "org-1", wsId: "ws-1", checksum: "wpb", ownerKind: "work_product", ownerId: "wp-1" });
  model.addDocument({ id: "wp-other", orgId: "org-1", wsId: "ws-1", checksum: "wpo", ownerKind: "work_product", ownerId: "wp-2" });
  model.addDocument({ id: "doc-direct", orgId: "org-1", wsId: "ws-1", checksum: "direct" });
  model.grant("doc-direct", "account-a", "edit");
  const a = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
  const b = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
  return { model, a, b };
}

test("first grant fans out to every delegated document and only to the changed account", () => {
  const { model, a, b } = fixture();
  const aCursor = settle(model, a.sessionId);
  const bCursor = settle(model, b.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "edit");
  assert.deepEqual(eventsSince(model, a.sessionId, aCursor), [granted("wp-a"), granted("wp-b")]);
  assert.deepEqual(eventsSince(model, b.sessionId, bCursor), []);
});

test("edit -> view still fans out to both delegated documents, and to no one else", () => {
  const { model, a, b } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "edit");
  const aCursor = settle(model, a.sessionId);
  const bCursor = settle(model, b.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "view");
  assert.deepEqual(eventsSince(model, a.sessionId, aCursor), [granted("wp-a"), granted("wp-b")]);
  assert.deepEqual(eventsSince(model, b.sessionId, bCursor), []);
});

test("view -> edit still fans out to both delegated documents", () => {
  const { model, a } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "view");
  const aCursor = settle(model, a.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "edit");
  assert.deepEqual(eventsSince(model, a.sessionId, aCursor), [granted("wp-a"), granted("wp-b")]);
});

test("a repeated same-level set emits nothing: no duplicate for an unchanged level", () => {
  const { model, a } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "edit");
  const aCursor = settle(model, a.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "edit");
  assert.deepEqual(eventsSince(model, a.sessionId, aCursor), []);
  model.setOwnerLevel("wp-1", "account-a", "edit");
  assert.deepEqual(eventsSince(model, a.sessionId, aCursor), []);
});

test("clear still emits an id-only removal and a later grant fans out again", () => {
  const { model, a } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "edit");
  const beforeClear = settle(model, a.sessionId);
  model.clearOwnerLevel("wp-1", "account-a");
  assert.deepEqual(eventsSince(model, a.sessionId, beforeClear), [removed("wp-a"), removed("wp-b")]);
  const beforeRegrant = settle(model, a.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "view");
  assert.deepEqual(eventsSince(model, a.sessionId, beforeRegrant), [granted("wp-a"), granted("wp-b")]);
});

test("the fan-out names no other owner's document, no direct-ACL document, and keeps org/ws scope", () => {
  const { model, a } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "edit");
  const aCursor = settle(model, a.sessionId);
  model.setOwnerLevel("wp-1", "account-a", "view");
  const events = eventsSince(model, a.sessionId, aCursor);
  assert.deepEqual(events.map((event) => event.documentId), ["wp-a", "wp-b"]);
  assert.equal(events.some((event) => event.documentId === "wp-other"), false);
  assert.equal(events.some((event) => event.documentId === "doc-direct"), false);
  assert.deepEqual([...new Set(events.map((event) => event.orgId))], ["org-1"]);
  assert.deepEqual([...new Set(events.map((event) => event.wsId))], ["ws-1"]);
  assert.deepEqual([...new Set(events.map((event) => event.accountId))], ["account-a"]);
});

test("each owner-level change moves what the changed account can actually open", () => {
  const { model, a } = fixture();
  model.setOwnerLevel("wp-1", "account-a", "view");
  assert.equal(model.openDocument({ sessionId: a.sessionId, docId: "wp-a" }).revision, 1);
  model.clearOwnerLevel("wp-1", "account-a");
  let afterClear;
  try {
    model.openDocument({ sessionId: a.sessionId, docId: "wp-a" });
    afterClear = "allowed";
  } catch (error) {
    afterClear = error.code;
  }
  assert.equal(afterClear, "forbidden");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { ProtocolError } from "./run-contracts.mjs";
import { createChangeFeed } from "./change-feed.mjs";

const fail = (code, fields) => {
  throw new ProtocolError(code, fields);
};
const CURSOR_KEY = crypto.createHash("sha256").update("feed-test").digest();

/**
 * A tiny fixture: documents with an ACL and tombstones, plus a read filter the
 * test controls directly. The feed itself never stores the ACL.
 */
function makeWorld({ retention = 2, snapshotTtlMs = 600_000 } = {}) {
  const docs = new Map();
  const acl = new Map();
  const tombstones = new Set();
  const clock = { t: 1_000_000 };
  const feed = createChangeFeed({
    retention,
    snapshotTtlMs,
    now: () => clock.t,
    fail,
    cursorKey: CURSOR_KEY,
    listCurrent: ({ orgId, wsId }) =>
      [...docs.values()]
        .filter((doc) => doc.orgId === orgId && doc.wsId === wsId)
        .map((doc) => ({
          documentId: doc.id,
          orgId: doc.orgId,
          wsId: doc.wsId,
          revision: doc.revision,
          kind: tombstones.has(doc.id) ? "deleted" : "upsert",
        })),
    canRead: (accountId, row) =>
      tombstones.has(row.documentId)
        ? row.kind === "deleted" && Boolean(acl.get(row.documentId)?.has(accountId))
        : Boolean(acl.get(row.documentId)?.has(accountId)),
    resolveRow: (row) => ({ ...row, kind: tombstones.has(row.documentId) ? "deleted" : row.kind }),
  });
  const add = (id, { orgId = "org-1", wsId = "ws-1" } = {}) => {
    docs.set(id, { id, orgId, wsId, revision: 1 });
    acl.set(id, new Set());
    feed.append({ kind: "created", documentId: id, orgId, wsId, revision: 1 });
  };
  const grant = (id, accountId) => {
    acl.get(id).add(accountId);
    feed.grant({ accountId, documentId: id, orgId: docs.get(id).orgId, wsId: docs.get(id).wsId, revision: docs.get(id).revision });
  };
  const revoke = (id, accountId) => {
    const had = acl.get(id).delete(accountId);
    if (had) feed.revoke({ accountId, documentId: id, orgId: docs.get(id).orgId, wsId: docs.get(id).wsId });
  };
  const tombstone = (id) => {
    tombstones.add(id);
    feed.append({ kind: "deleted", documentId: id, orgId: docs.get(id).orgId, wsId: docs.get(id).wsId, revision: docs.get(id).revision });
  };
  const drain = (accountId, cursor = "0", limit = 100) => {
    let page = feed.read({ accountId, orgId: "org-1", wsId: "ws-1", cursor, limit });
    const events = [...page.events];
    let guard = 0;
    while (page.mode === "snapshot" && !page.done) {
      if (guard++ > 100) throw new Error("no progress");
      page = feed.read({ accountId, orgId: "org-1", wsId: "ws-1", cursor: page.nextCursor, limit });
      events.push(...page.events);
    }
    return { events, cursor: page.nextCursor, mode: page.mode };
  };
  return { docs, acl, feed, add, grant, revoke, tombstone, drain, clock };
}

test("a cold cursor returns a snapshot and the final page returns an incremental cursor", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const drained = world.drain("account-a");
  assert.equal(drained.mode, "snapshot");
  assert.deepEqual(drained.events.map((e) => e.documentId), ["doc-a"]);
  assert.equal(drained.events[0].snapshot, true);
  const next = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: drained.cursor });
  assert.equal(next.mode, "incremental");
  assert.equal(next.events.length, 0);
});

test("the cursor is opaque and bound to account, org and workspace", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const cursor = world.drain("account-a").cursor;
  assert.equal(cursor.includes("account-a"), false, "the cursor must not carry a raw account id");
  assert.throws(
    () => world.feed.read({ accountId: "account-b", orgId: "org-1", wsId: "ws-1", cursor }),
    (error) => error.code === "forbidden" && error.fields.reason === "cursor_scope",
  );
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-2", cursor }),
    (error) => error.fields.reason === "cursor_scope",
  );
  const tampered = cursor.slice(0, -1) + (cursor.endsWith("A") ? "B" : "A");
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: tampered }),
    (error) => error.fields.reason === "cursor_signature",
  );
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "1" }),
    (error) => error.fields.reason === "cursor_malformed",
  );
});

test("a hidden event still advances the cursor", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const start = world.drain("account-a").cursor;
  // doc-b is granted to nobody: its events are unreadable to account-a.
  world.add("doc-b");
  const page1 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: start, limit: 1 });
  assert.equal(page1.events.length, 0, "a hidden event must not be emitted");
  assert.notEqual(page1.nextCursor, start, "the cursor must move past the hidden event");
  const page2 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: page1.nextCursor, limit: 5 });
  assert.equal(page2.events.length, 0);
  assert.equal(page2.nextCursor, page1.nextCursor);
});

test("an unreadable document id never leaks, deleted or not", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-owned");
  world.grant("doc-owned", "account-a");
  world.add("doc-foreign");
  world.tombstone("doc-foreign");
  world.tombstone("doc-owned");
  const seen = world.drain("account-a").events;
  assert.deepEqual(seen.map((e) => [e.documentId, e.kind]), [["doc-owned", "deleted"]]);
});

test("a revoke reaches the reader who lost access, with the id and nothing else", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const cursor = world.drain("account-a").cursor;
  world.revoke("doc-a", "account-a");
  const events = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor, limit: 10 }).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "removed");
  assert.equal(events[0].documentId, "doc-a");
  assert.equal(events[0].revision, null, "an id-only removal carries no revision");
  // After the removal the reader can no longer read the document at all.
  const after = world.drain("account-a").events;
  assert.equal(after.some((event) => event.documentId === "doc-a"), false);
});

test("a grant is targeted at the granted account only", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const aCursor = world.drain("account-a").cursor;
  const bCursor = world.drain("account-b").cursor;
  world.grant("doc-a", "account-b");
  const aEvents = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: aCursor, limit: 10 }).events;
  const bEvents = world.feed.read({ accountId: "account-b", orgId: "org-1", wsId: "ws-1", cursor: bCursor, limit: 10 }).events;
  assert.equal(aEvents.some((event) => event.kind === "granted"), false);
  assert.equal(bEvents.some((event) => event.kind === "granted" && event.documentId === "doc-a"), true);
});

test("a snapshot is stable across pages even when retention would drop its events", () => {
  const world = makeWorld({ retention: 1 });
  for (const id of ["doc-a", "doc-b", "doc-c", "doc-d"]) {
    world.add(id);
    world.grant(id, "account-a");
  }
  const page1 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "0", limit: 1 });
  assert.equal(page1.done, false);
  // More writes race the snapshot, pushing everything out of a retention of 1.
  world.add("doc-e");
  const page2 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: page1.nextCursor, limit: 1 });
  assert.equal(page2.mode, "snapshot", "page 2 must still be the snapshot it started");
  assert.equal(page2.events.length, 1);
  const drained = world.drain("account-a", page2.nextCursor, 100);
  assert.equal(drained.events.every((event) => event.snapshot === true), true);
});

test("catchup after a snapshot carries the writes the client raced", () => {
  const world = makeWorld({ retention: 1 });
  for (const id of ["doc-a", "doc-b"]) {
    world.add(id);
    world.grant(id, "account-a");
  }
  const page1 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "0", limit: 1 });
  world.add("doc-raced");
  world.grant("doc-raced", "account-a");
  const drained = world.drain("account-a", page1.nextCursor, 100);
  const catchup = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: drained.cursor, limit: 50 });
  assert.equal(catchup.mode, "incremental");
  assert.equal(catchup.events.some((event) => event.documentId === "doc-raced"), true, "the raced write must be delivered");
});

test("a snapshot cursor abandoned past its TTL expires instead of silently restarting", () => {
  const world = makeWorld({ retention: 1000, snapshotTtlMs: 1_000 });
  for (const id of ["doc-a", "doc-b"]) {
    world.add(id);
    world.grant(id, "account-a");
  }
  const page1 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "0", limit: 1 });
  world.clock.t += 2_000;
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: page1.nextCursor, limit: 1 }),
    (error) => error.code === "change_cursor_expired",
  );
});

test("an incremental cursor older than retention expires and a fresh snapshot recovers", () => {
  const world = makeWorld({ retention: 1 });
  for (const id of ["doc-a", "doc-b"]) {
    world.add(id);
    world.grant(id, "account-a");
  }
  const start = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "0", limit: 1 });
  const incremental = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: start.nextCursor, limit: 100 }).nextCursor;
  // Two more writes push the cursor out of the retention window: retention is the
  // number of events the cursor may still point behind, so a single write is not
  // enough to make it stale.
  world.add("doc-c");
  world.grant("doc-c", "account-a");
  world.add("doc-d");
  world.grant("doc-d", "account-a");
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: incremental, limit: 10 }),
    (error) => error.code === "change_cursor_expired" && error.status === 410,
  );
  const resync = world.drain("account-a");
  assert.equal(resync.mode, "snapshot");
  assert.equal(resync.events.some((event) => event.documentId === "doc-c"), true);
});

test("a document deleted while the snapshot is open is emitted as its tombstone", () => {
  const world = makeWorld({ retention: 1 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  world.add("doc-b");
  world.grant("doc-b", "account-a");
  const page1 = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: "0", limit: 1 });
  world.tombstone("doc-b");
  const drained = world.drain("account-a", page1.nextCursor, 100);
  const kinds = drained.events.filter((event) => event.documentId === "doc-b").map((event) => event.kind);
  assert.deepEqual(kinds, ["deleted"], "a mid-snapshot delete must not be served as a live row");
});

test("owner ACL transitions fan out to owned documents and nowhere else", () => {
  const world = makeWorld({ retention: 1000 });
  const documents = [
    { id: "wp-a", ownerKind: "work_product", ownerId: "wp-1", orgId: "org-1", wsId: "ws-1", revision: 1 },
    { id: "wp-b", ownerKind: "work_product", ownerId: "wp-1", orgId: "org-1", wsId: "ws-1", revision: 1 },
    { id: "wp-other", ownerKind: "work_product", ownerId: "wp-2", orgId: "org-1", wsId: "ws-1", revision: 1 },
  ];
  const emitted = world.feed.ownerTransition({
    accountId: "account-a",
    ownerId: "wp-1",
    ownerKind: "work_product",
    kind: "granted",
    documents,
  });
  assert.deepEqual(emitted.map((event) => event.documentId).sort(), ["wp-a", "wp-b"]);
  assert.equal(emitted.some((event) => event.documentId === "wp-other"), false);
  assert.deepEqual([...new Set(emitted.map((event) => event.accountId))], ["account-a"]);
});

test("a cursor from another organization is refused", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const cursor = world.drain("account-a").cursor;
  assert.throws(
    () => world.feed.read({ accountId: "account-a", orgId: "org-2", wsId: "ws-1", cursor }),
    (error) => error.fields.reason === "cursor_scope",
  );
});

test("a cursor from a previous log expires instead of answering an empty catchup", () => {
  // Two worlds are two histories: each builds its own in-memory log, and a fresh
  // log reaches the same sequence numbers the previous one did. Position alone
  // cannot tell them apart, so a cursor must name the log it was issued against.
  const first = makeWorld({ retention: 1000 });
  first.add("doc-a");
  first.grant("doc-a", "account-a");
  const cursor = first.drain("account-a").cursor;
  // Asking the same log at the same position is a genuine "nothing new".
  const sameLog = first.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor, limit: 100 });
  assert.equal(sameLog.mode, "incremental");
  assert.equal(sameLog.events.length, 0);
  // A restart is a different log. Its events are not the ones the cursor names, so
  // it must expire into a fresh snapshot, never a silent empty catchup.
  const second = makeWorld({ retention: 1000 });
  second.add("doc-a");
  second.grant("doc-a", "account-a");
  assert.throws(
    () => second.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor, limit: 100 }),
    (error) => error.code === "change_cursor_expired" && error.fields.reason === "log_reset",
  );
  const resync = second.drain("account-a");
  assert.equal(resync.mode, "snapshot");
  assert.equal(resync.events.some((event) => event.documentId === "doc-a"), true);
});

// Plan 5.3 metadata kinds (Advisor g118, closing DOC-005): rename, move, archive and restore travel
// through the same feed as any other change. The feed carries identity (documentId + revision) and never a
// name or path, so a client keyed by id cannot be confused by a rename or a move.
test("rename and in-workspace move keep the document identity and carry no name or path", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const start = world.drain("account-a").cursor;
  world.feed.append({ kind: "renamed", documentId: "doc-a", orgId: "org-1", wsId: "ws-1", revision: 1, name: "Bao cao Q3.docx" });
  world.feed.append({ kind: "moved", documentId: "doc-a", orgId: "org-1", wsId: "ws-1", revision: 1, path: "/Reports/2026" });
  const page = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: start });
  assert.deepEqual(page.events.map((e) => [e.kind, e.documentId]), [["renamed", "doc-a"], ["moved", "doc-a"]]);
  for (const event of page.events) {
    assert.equal("name" in event, false, "a feed event must not carry a display name");
    assert.equal("path" in event, false, "a feed event must not carry a path");
  }
});

test("archive and restore are delivered in order to readers only, and a stranger's cursor still advances", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const readerStart = world.drain("account-a").cursor;
  const strangerStart = world.drain("account-b").cursor;
  world.feed.append({ kind: "archived", documentId: "doc-a", orgId: "org-1", wsId: "ws-1", revision: 1 });
  world.feed.append({ kind: "restored", documentId: "doc-a", orgId: "org-1", wsId: "ws-1", revision: 1 });
  const reader = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: readerStart });
  assert.deepEqual(reader.events.map((e) => e.kind), ["archived", "restored"]);
  const stranger = world.feed.read({ accountId: "account-b", orgId: "org-1", wsId: "ws-1", cursor: strangerStart });
  assert.deepEqual(stranger.events, [], "a non-reader never learns about the archive or restore");
  const after = world.feed.read({ accountId: "account-b", orgId: "org-1", wsId: "ws-1", cursor: stranger.nextCursor });
  assert.deepEqual(after.events, [], "the stranger's cursor moved past the hidden events");
});

test("a move to another workspace is an id-only removal in the old scope and a targeted grant in the new one", () => {
  const world = makeWorld({ retention: 1000 });
  world.add("doc-a");
  world.grant("doc-a", "account-a");
  const oldScope = world.drain("account-a").cursor;
  const newScope = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-2", cursor: "0" }).nextCursor;
  // The service moves doc-a from ws-1 to ws-2: prior readers of ws-1 learn only that the id left; readers who
  // keep access in ws-2 get a targeted grant there. The feed never names ws-2 inside the ws-1 scope.
  world.feed.revoke({ accountId: "account-a", documentId: "doc-a", orgId: "org-1", wsId: "ws-1" });
  world.docs.get("doc-a").wsId = "ws-2";
  world.feed.grant({ accountId: "account-a", documentId: "doc-a", orgId: "org-1", wsId: "ws-2", revision: 1 });
  const left = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-1", cursor: oldScope });
  assert.deepEqual(left.events.map((e) => [e.kind, e.documentId, e.revision]), [["removed", "doc-a", null]]);
  assert.equal(left.events.every((e) => e.wsId === "ws-1"), true, "the old scope never sees the destination");
  const arrived = world.feed.read({ accountId: "account-a", orgId: "org-1", wsId: "ws-2", cursor: newScope });
  assert.deepEqual(arrived.events.map((e) => [e.kind, e.documentId]), [["granted", "doc-a"]]);
  const stranger = world.feed.read({ accountId: "account-b", orgId: "org-1", wsId: "ws-1", cursor: "0" });
  assert.equal(stranger.events.some((e) => e.documentId === "doc-a"), false, "a stranger learns nothing about the move");
});

// change-feed.mjs — DOC-005 (UNI-669) change feed and reconnect reference model.
// Node 22 built-ins only. No HTTP server, no product imports.
//
// Models §5 of docs/office/g0/login-sync-contract.md: identity is
// account/organization/workspace/document, realtime only announces that
// something changed, and the cursor is the path that repairs what a disconnect
// missed. Three properties shape the design:
//
//   1. The cursor is opaque and AUTHENTICATED. It is a signed envelope naming the
//      account/org/workspace it was issued for, so a cursor replayed by another
//      account (or edited to widen its scope) is refused, not honoured.
//   2. A cold cursor (absent or "0") starts a stable current-state snapshot at a
//      highwater mark. Snapshot membership and state are frozen server-side, so
//      page 2 of a snapshot is never invalidated by retention or by writers
//      between pages; events appended during the snapshot are pinned and handed
//      over when the snapshot ends. The final snapshot page returns an
//      incremental cursor, which is the only place replay can begin.
//   3. Read permission is re-checked while emitting. An event the actor may not
//      read still advances the cursor (a cursor that stalls on a hidden event
//      loops forever), and a document the actor never had access to never leaks,
//      deleted or not. The single exception is a revoke: it is delivered to the
//      reader who just lost access, carrying the document id and nothing else,
//      so their client can drop it without learning anything new.

import crypto from "node:crypto";

import { base64url } from "./pkce.mjs";

const CURSOR_VERSION = 1;
const MODE_SNAPSHOT = "s";
const MODE_INCREMENTAL = "i";

/** Events whose visibility comes from the audience field, not the live ACL. */
const AUDIENCE_KINDS = new Set(["granted", "removed"]);

/**
 * @param {object} opts
 * @param {number} opts.retention   how many events are kept before a cursor is stale
 * @param {() => number} opts.now   injectable clock
 * @param {(code: string, fields?: object) => never} opts.fail
 *        thrower for the caller's error type (forbidden, change_cursor_expired)
 * @param {(scope: object) => object[]} opts.listCurrent
 *        current-state rows for the scope: {documentId, orgId, wsId, revision, kind?}
 * @param {(accountId: string, row: object) => boolean} opts.canRead
 *        live ACL check, evaluated at emit time, never cached
 * @param {(row: object) => object} [opts.resolveRow]
 *        live existence check for a frozen snapshot row: a document deleted while
 *        the snapshot was open must be emitted as its tombstone, while its
 *        revision stays the value the snapshot froze.
 * @param {Buffer} [opts.cursorKey] signing key for the opaque cursor envelope
 * @param {number} [opts.snapshotTtlMs] how long an unfinished snapshot may be resumed
 */
export function createChangeFeed({
  retention = 1000,
  now = () => Date.now(),
  fail,
  listCurrent,
  canRead,
  resolveRow = null,
  cursorKey,
  snapshotTtlMs = 10 * 60_000,
} = {}) {
  if (typeof fail !== "function") throw new TypeError("fail must be a function");
  if (typeof listCurrent !== "function") throw new TypeError("listCurrent must be a function");
  if (typeof canRead !== "function") throw new TypeError("canRead must be a function");
  if (!Number.isInteger(retention) || retention < 1) throw new RangeError("retention must be a positive integer");

  const key = cursorKey ?? crypto.randomBytes(32);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError("cursorKey must be a 32-byte Buffer");

  const log = [];
  const snapshots = new Map();
  /** Per-snapshot seqs appended while it was open; retention must not drop them. */
  const pinned = new Map();
  /**
   * Seqs appended while a snapshot was open, carried past the snapshot's final
   * page until the client's incremental read consumes them. Without this, the
   * cursor handed over at the end of a snapshot could already point behind the
   * retention window and the client would silently miss the writes it raced.
   * The carryover is bounded: when it exceeds the cap, retention wins and the
   * client's cursor expires, which is the documented full-resync path.
   */
  const carryover = new Map();
  const carryoverCap = Math.max(64, retention * 8);
  let seq = 0;
  let snapshotSeq = 0;

  // The log has an IDENTITY, not just a position. A restart builds a different
  // in-memory history, so a cursor minted by the previous instance names events
  // this process never had. Comparing sequence numbers alone cannot tell two logs
  // apart, because a fresh log reaches the same numbers; the cursor therefore
  // carries the log it was issued against, and a cursor from any other log expires
  // into a fresh snapshot instead of being answered as an empty "caught up".
  const epoch = crypto.randomBytes(16).toString("hex");

  const sign = (body) => base64url(crypto.createHmac("sha256", key).update(body).digest());
  function encodeCursor(payload) {
    const body = base64url(JSON.stringify(payload));
    return body + "." + sign(body);
  }
  function decodeCursor(cursor) {
    if (typeof cursor !== "string" || !cursor.includes(".")) fail("forbidden", { reason: "cursor_malformed" });
    const index = cursor.indexOf(".");
    const body = cursor.slice(0, index);
    const signature = cursor.slice(index + 1);
    const expected = sign(body);
    // Constant-time compare: a cursor is a credential, not a hint.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      fail("forbidden", { reason: "cursor_signature" });
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      fail("forbidden", { reason: "cursor_payload" });
    }
    if (!payload || payload.v !== CURSOR_VERSION) fail("forbidden", { reason: "cursor_version" });
    return payload;
  }
  function requireScope(payload, accountId, orgId, wsId) {
    if (payload.a !== accountId || payload.o !== orgId || payload.w !== wsId) {
      fail("forbidden", { reason: "cursor_scope" });
    }
  }

  /** Drop events that fell out of the retention window, except pinned ones. */
  function evict() {
    const retainedFrom = seq - retention + 1;
    const isProtected = (seqNo) => carryover.has(seqNo) || [...pinned.values()].some((set) => set.has(seqNo));
    while (log.length > 0 && log[0].seq < retainedFrom && !isProtected(log[0].seq)) log.shift();
  }
  const oldestRetained = () => (log.length === 0 ? seq + 1 : log[0].seq);

  const inScope = (row, orgId, wsId) => row.orgId === orgId && row.wsId === wsId;

  /**
   * Whether an event reaches this account. Audience-scoped transitions are the
   * only ones delivered on the strength of the audience alone: a revoke must
   * reach the reader who just lost access even though the live ACL now says no.
   */
  function visible(accountId, orgId, wsId, event) {
    if (!inScope(event, orgId, wsId)) return false;
    if (event.accountId) {
      if (event.accountId !== accountId) return false;
      if (AUDIENCE_KINDS.has(event.kind)) return true;
    }
    return canRead(accountId, event);
  }

  function append(event) {
    if (!event || typeof event.documentId !== "string" || typeof event.kind !== "string") {
      throw new TypeError("event needs documentId and kind");
    }
    seq += 1;
    const stored = {
      seq,
      kind: event.kind,
      documentId: event.documentId,
      orgId: event.orgId,
      wsId: event.wsId,
      revision: event.revision ?? null,
      accountId: event.accountId ?? null,
      at: now(),
    };
    log.push(stored);
    for (const snapshot of snapshots.values()) {
      if (stored.seq > snapshot.hw && inScope(stored, snapshot.orgId, snapshot.wsId)) {
        pinned.get(snapshot.id).add(stored.seq);
      }
    }
    evict();
    return stored;
  }

  /** Targeted upsert: the granted account learns about the document. */
  function grant({ accountId, documentId, orgId, wsId, revision = null }) {
    return append({ kind: "granted", documentId, orgId, wsId, revision, accountId });
  }
  /** Id-only removal: the prior reader learns the id went away, nothing more. */
  function revoke({ accountId, documentId, orgId, wsId }) {
    return append({ kind: "removed", documentId, orgId, wsId, revision: null, accountId });
  }
  /**
   * Work Product owner ACL transition (C-01 §13): one owner-level change fans out
   * to every document that delegates to that owner, and only to the account whose
   * level changed. Unknown ids are never named: the fan-out is over documents the
   * owner actually owns and the account is the one whose level moved.
   */
  function ownerTransition({ accountId, ownerId, ownerKind, kind, documents, revisionOf }) {
    if (!["granted", "removed"].includes(kind)) throw new TypeError("ownerTransition kind must be granted|removed");
    const emitted = [];
    for (const doc of documents) {
      if (doc.ownerKind !== ownerKind || doc.ownerId !== ownerId) continue;
      emitted.push(
        append({
          kind,
          documentId: doc.id,
          orgId: doc.orgId,
          wsId: doc.wsId,
          revision: kind === "granted" ? (revisionOf ? revisionOf(doc.id) : doc.revision ?? null) : null,
          accountId,
        }),
      );
    }
    return emitted;
  }

  function startSnapshot({ accountId, orgId, wsId }) {
    snapshotSeq += 1;
    const hw = seq;
    const rows = listCurrent({ accountId, orgId, wsId })
      .filter((row) => inScope(row, orgId, wsId))
      .map((row) => ({ ...row }));
    const id = "snap-" + snapshotSeq;
    pinned.set(id, new Set());
    snapshots.set(id, { id, accountId, orgId, wsId, hw, rows, pos: 0, expiresAt: now() + snapshotTtlMs });
    return { id, hw };
  }

  function readSnapshot(snapshot, limit) {
    const events = [];
    while (snapshot.pos < snapshot.rows.length && events.length < limit) {
      const row = snapshot.rows[snapshot.pos];
      snapshot.pos += 1; // always advance, hidden or not: a stalled cursor is a hung sync
      // Existence is live even though values are frozen: a document deleted while
      // the snapshot was open is emitted as its tombstone, not as a live row.
      const live = resolveRow ? resolveRow(row) : row;
      // Re-check the live ACL at emit time: a share revoked between two pages must
      // not be handed out by the snapshot that was built before the revoke.
      if (!canRead(snapshot.accountId, live)) continue;
      events.push({
        kind: live.kind ?? row.kind ?? "upsert",
        documentId: row.documentId,
        orgId: row.orgId,
        wsId: row.wsId,
        revision: row.revision ?? null,
        snapshot: true,
      });
    }
    if (snapshot.pos < snapshot.rows.length) {
      return {
        events,
        mode: "snapshot",
        done: false,
        nextCursor: encodeCursor({
          v: CURSOR_VERSION,
          a: snapshot.accountId,
          o: snapshot.orgId,
          w: snapshot.wsId,
          m: MODE_SNAPSHOT,
          s: snapshot.id,
        }),
      };
    }
    // Final page: hand back an incremental cursor at the highwater mark. Every
    // event appended during the snapshot sits above hw and was pinned, so nothing
    // written while the snapshot was open is lost, and nothing ancient replays.
    snapshots.delete(snapshot.id);
    // Hand this snapshot's pins to the carryover so the incremental cursor about
    // to be returned can still reach the writes the client raced. Pins that
    // another open snapshot also needs stay in place.
    const released = pinned.get(snapshot.id);
    pinned.delete(snapshot.id);
    for (const seqNo of released) {
      const stillNeeded = [...pinned.values()].some((set) => set.has(seqNo));
      if (!stillNeeded) carryover.set(seqNo, true);
    }
    // Bounded: past the cap, retention wins and the client's cursor expires.
    while (carryover.size > carryoverCap) carryover.delete(carryover.keys().next().value);
    evict();
    return {
      events,
      mode: "snapshot",
      done: true,
      nextCursor: encodeCursor({
        v: CURSOR_VERSION,
        a: snapshot.accountId,
        o: snapshot.orgId,
        w: snapshot.wsId,
        m: MODE_INCREMENTAL,
        f: snapshot.hw,
        e: epoch,
      }),
    };
  }

  function readIncremental({ accountId, orgId, wsId, from, limit }) {
    // Move the window before validating so a cursor that only just fell out is
    // judged against the latest log, not a stale one.
    evict();
    // A cold snapshot cursor is the only recovery from an expired incremental
    // cursor; tell the client exactly that instead of silently returning a gap.
    if (from + 1 < oldestRetained()) fail("change_cursor_expired", { retainFrom: oldestRetained() });
    // A log that was reset (a fresh process whose sequence never reached the
    // cursor position) cannot honour the cursor either: the events it names are
    // simply gone. Without this, a cursor minted by a previous instance would be
    // answered as an empty "caught up", which is the silent gap the retention
    // check exists to prevent. A cursor exactly at the current highwater is a
    // genuine "nothing new" and still returns empty.
    if (from > seq) fail("change_cursor_expired", { reason: "log_reset", from, highwater: seq });
    const events = [];
    let scannedTo = from;
    for (const event of log) {
      if (event.seq <= from) continue;
      if (events.length >= limit) break;
      scannedTo = event.seq;
      if (visible(accountId, orgId, wsId, event)) events.push({ ...event, snapshot: false });
    }
    // The client has now been handed everything up to scannedTo, so the carryover
    // protection for those events is no longer needed.
    for (const seqNo of [...carryover.keys()]) if (seqNo <= scannedTo) carryover.delete(seqNo);
    return {
      events,
      mode: "incremental",
      done: true,
      nextCursor: encodeCursor({
        v: CURSOR_VERSION,
        a: accountId,
        o: orgId,
        w: wsId,
        m: MODE_INCREMENTAL,
        f: scannedTo,
        e: epoch,
      }),
    };
  }

  function read({ accountId, orgId, wsId, cursor = "0", limit = 100 } = {}) {
    if (!accountId || !orgId || !wsId) throw new TypeError("read requires accountId, orgId and wsId");
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
    evict();
    if (cursor === null || cursor === undefined || cursor === "" || cursor === "0") {
      const snapshot = startSnapshot({ accountId, orgId, wsId });
      return readSnapshot(snapshots.get(snapshot.id), limit);
    }
    const payload = decodeCursor(cursor);
    requireScope(payload, accountId, orgId, wsId);
    if (payload.m === MODE_SNAPSHOT) {
      const snapshot = snapshots.get(payload.s);
      // An abandoned or superseded snapshot is not a silent restart: the client
      // must ask for a fresh snapshot so it re-reads current state wholesale.
      if (!snapshot || snapshot.expiresAt <= now()) fail("change_cursor_expired", { reason: "snapshot_gone" });
      return readSnapshot(snapshot, limit);
    }
    // The cursor names the log it was issued against. A different log means the
    // events it points past are gone, whatever the sequence numbers say: a fresh
    // process restarts its numbering, so a position is not an identity. Refuse it
    // into a fresh snapshot instead of answering an empty "caught up". A cursor
    // minted by THIS log, even exactly at the current highwater, still passes and
    // returns a genuine "nothing new".
    if (payload.e !== epoch) fail("change_cursor_expired", { reason: "log_reset" });
    return readIncremental({ accountId, orgId, wsId, from: payload.f, limit });
  }

  return {
    append,
    grant,
    revoke,
    ownerTransition,
    read,
    /** Diagnosis only: how much log is retained, how many snapshots are open. */
    stats: () => ({
      seq,
      retained: log.filter((e) => e.seq >= oldestRetained()).length,
      oldest: oldestRetained(),
      snapshots: snapshots.size,
      pinned: [...pinned.values()].reduce((total, set) => total + set.size, 0),
      carryover: carryover.size,
    }),
  };
}

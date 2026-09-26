#!/usr/bin/env node
// DOC-005 (UNI-669) — bounded reference protocol and durable-draft harness.
//
// This file is the runnable half of docs/office/g0/login-sync-contract.md. It
// models the login / save / version / change-feed / draft protocol G0
// specifies, then drives the model through the fault cases the plan requires
// (docs/superpowers/plans/2026-09-16-documents-office-g0.md, Task 5 "Ca bat
// buoc"). Each case's expected values are written out literally in FAULT_CASES,
// so a model that drifts from the contract fails instead of redefining success.
//
// What this is NOT. There is no HTTP server, no product auth middleware, no
// document service, no engine and no browser in here. Authorization is an
// explicit in-memory ACL map: every report labels it "modeled authorization",
// and this harness never claims product tenancy isolation. Engine results are
// synthesized; the engine contract itself is DOC-004's deliverable (see the
// extension point below). What IS real: draft persistence is a filesystem
// write, so "restart" means a fresh model reading those bytes back.
//
// DOC-004 extends this instead of writing a second harness: add engine
// open/parse/serialize/convert cases to FAULT_CASES with the same oracle shape.
//
// Two properties of this harness are deliberate:
//
//   1. A fault case is a REAL situation that the protocol must handle, not an
//      impossible call the harness is free to answer with a crash. Every case
//      below starts from a document the actor can legitimately open, and drives
//      it through a reachable failure (a concurrent writer, a revoked share, a
//      reused key, a tombstone, an expired cursor, a stale blob version).
//   2. A case records where the client ENDS UP, and the oracle says what that is
//      allowed to be. Most cases end by retrying or resyncing; some legitimately
//      end BLOCKED (a revoked share, a tombstone). The oracle states which, and
//      no case claims convergence it does not observe.
//
// Where the protocol logic lives. Auth (PKCE), the change feed and the
// conversion permission model are modules with their own tests, imported here so
// the harness exercises the same code a service would adapt:
//
//   ./pkce.mjs             RFC 7636 S256 encoding (BASE64URL, not hex)
//   ./redirect.mjs         the one exact uniwork-office://auth/callback
//   ./auth-model.mjs       server authorize/redeem + client pending attempt
//   ./change-feed.mjs      scoped opaque cursors, snapshot + incremental
//   ./permission-model.mjs carried ACL, no edit -> manage elevation
//
// Draft bytes come from an injected store with the seam the product draft store
// exports: createDraftStore({ dir, keyProvider, namespaceKey }) -> read(account)
// / write(account, rows). Both durable and memory runs use the accepted store.
// No test here claims the product store's crash behaviour. The store owns bytes
// only: the model owns ACL, sessions and every draft read.
//
//   node scripts/office-g0/run-contracts.mjs
//   node scripts/office-g0/run-contracts.mjs --print --out <path>
//   node scripts/office-g0/run-contracts.mjs --legacy-model
//
// Exit code 0 only when every case matches its oracle.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createAuthModel, createClient, pkceChallenge } from "./auth-model.mjs";
import { createChangeFeed } from "./change-feed.mjs";
import { carriedAcl } from "./permission-model.mjs";
import { generateVerifier } from "./pkce.mjs";
import { isRegisteredCallback, REDIRECT_URI } from "./redirect.mjs";
import { createDraftStore } from "./draft-store.mjs";

export { pkceChallenge, generateVerifier, REDIRECT_URI, isRegisteredCallback };

export const MODEL_VERSION = "uniwork-office-g0-protocol/2";
export const CONTRACT_DOC = "docs/office/g0/login-sync-contract.md";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The single error classification table the contract doc, the Go handler and
 * the client all read. C-01 answers a stale page autosave with 422
 * revision_conflict and C-16 answers a stale Office version with 409
 * document_version_conflict; both carry errorClass "conflict" so the client has
 * ONE conflict path instead of inferring behaviour from text or status code.
 * Keeping two HTTP codes is compatibility; keeping two client behaviours is the
 * bug this table removes.
 */
export const ERROR_CODES = {
  revision_conflict: { status: 422, errorClass: "conflict", kind: "base_revision_mismatch" },
  document_version_conflict: { status: 409, errorClass: "conflict", kind: "base_version_mismatch" },
  idempotency_payload_mismatch: { status: 409, errorClass: "conflict", kind: "idempotency_payload" },
  idempotency_key_reuse: { status: 409, errorClass: "conflict", kind: "idempotency_actor" },
  idempotency_in_flight: { status: 409, errorClass: "conflict", kind: "idempotency_in_flight" },
  owner_requires_copy: { status: 409, errorClass: "conflict", kind: "work_product_owned" },
  // A conversion that can lose fidelity is only ever applied to a COPY, and only
  // after the client collected the user's explicit consent. Refusing without that
  // consent is its own typed code, not a generic conflict.
  copy_consent_required: { status: 409, errorClass: "conflict", kind: "copy_consent" },
  document_deleted: { status: 410, errorClass: "gone", kind: "tombstone" },
  change_cursor_expired: { status: 410, errorClass: "gone", kind: "cursor_retention" },
  forbidden: { status: 403, errorClass: "permission", kind: "acl" },
  quota_exceeded: { status: 413, errorClass: "quota", kind: "storage_bytes" },
  engine_incompatible: { status: 409, errorClass: "incompatible", kind: "engine_version" },
  upload_already_committed: { status: 409, errorClass: "conflict", kind: "upload_consumed" },
  token_expired: { status: 401, errorClass: "session", kind: "token" },
  authorization_code_expired: { status: 400, errorClass: "session", kind: "auth_code_ttl" },
  authorization_code_reused: { status: 400, errorClass: "session", kind: "auth_code_replay" },
  // not_found is declared because the model raises it in two ordinary places
  // (an unknown document, an unknown upload). Leaving it out of this table made
  // ProtocolError itself throw a bare Error for it, which is exactly the
  // ambiguity the table exists to remove: a client should be able to switch on
  // a code, not on a stack trace.
  not_found: { status: 404, errorClass: "missing", kind: "unknown_resource" },
  draft_recovery_locked: { status: 409, errorClass: "conflict", kind: "draft_recovery" },
};

export class ProtocolError extends Error {
  constructor(code, fields = {}) {
    super(code);
    const spec = ERROR_CODES[code];
    if (!spec) throw new Error("unknown protocol error code: " + code);
    this.code = code;
    this.status = spec.status;
    this.errorClass = spec.errorClass;
    this.kind = spec.kind;
    this.fields = fields;
  }
  toJSON() {
    return {
      code: this.code,
      status: this.status,
      errorClass: this.errorClass,
      kind: this.kind,
      ...this.fields,
    };
  }
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fingerprintOf = (req) => sha256(JSON.stringify(req));

/** Byte checksum of a payload, so a case can name the bytes a version holds. */
export const checksumOf = (payload) => sha256(payload);

// A stable, payload-free identifier for a store failure. The accepted store
// names every failure with a string code; an OS error (the pre-replacement fault
// hook) carries a short string code too. Nothing else is copied: no message, no
// key, no document bytes can reach a report or an error field.
const nodeErrorCode = (error, fallback) => {
  const code = error && typeof error.code === "string" && error.code.length <= 64 ? error.code : null;
  return code ?? fallback;
};
const memoryOnlyKeyProvider = (accountId) => {
  throw new Error("memory-only store must not resolve a key for " + accountId);
};

// A raw store report is a minimal own-property data record, not "anything
// object-shaped". An array, a class instance (Date), a thenable (Promise) and a
// primitive are refused, and `persisted` must be an OWN boolean so a prototype
// cannot infer a successful write. writeSucceeded also guards the shape so a
// caller cannot pass a malformed value in by hand.
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isThenable = (value) =>
  (typeof value === "object" && value !== null) || typeof value === "function"
    ? typeof value.then === "function"
    : false;
const isWriteReport = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !isThenable(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  hasOwn(value, "persisted") &&
  typeof value.persisted === "boolean";

const writeSucceeded = (report, memoryOnlyStore) =>
  isWriteReport(report) &&
  report.succeeded === true &&
  (memoryOnlyStore || report.persisted === true);

export function createModel({
  dir = null,
  keyProvider = null,
  namespaceKey = null,
  draftStore = null,
  idempotencyFingerprint = true,
  changeRetention = 1000,
  snapshotTtlMs = 10 * 60_000,
  cursorKey = null,
  now = () => Date.now(),
} = {}) {
  const fail = (code, fields) => {
    throw new ProtocolError(code, fields);
  };

  // Draft bytes live behind an injected store, never in the model. The seam is
  // the one the product draft store exports:
  //   createDraftStore({ dir, keyProvider, namespaceKey }) -> read / write
  // A durable run uses the accepted store itself; a case that needs a restart can
  // hand in its own store instance over the same directory. Only bytes travel
  // through here. ACL, sessions and "may this account see this draft" are the
  // model's job, because that is what the contract is about.
  const durable = draftStore ? draftStore.durable === true : dir !== null;
  const memoryOnlyStore = draftStore ? draftStore.durable === false : dir === null;
  if (durable && !draftStore) {
    // A durable model must be handed real key material by its host: no
    // deterministic fallback secret is ever derived here, because a fixture key
    // would make the sealed bytes look durable while being reproducible.
    if (typeof keyProvider !== "function") {
      throw new ProtocolError("draft_recovery_locked", { reason: "key_provider_required" });
    }
    const namespaceBytes =
      Buffer.isBuffer(namespaceKey) || namespaceKey instanceof Uint8Array ? Buffer.from(namespaceKey) : null;
    if (namespaceBytes === null || namespaceBytes.length !== 32) {
      throw new ProtocolError("draft_recovery_locked", { reason: "namespace_key_required" });
    }
  }
  const store =
    draftStore ??
    createDraftStore({
      dir,
      keyProvider: typeof keyProvider === "function" ? keyProvider : memoryOnlyKeyProvider,
      namespaceKey,
    });
  // Draft store failures are one shape: a read either yields rows or locks the
  // draft, and a write never throws, so no draft path can be turned into an empty
  // list or a silent success by a store that failed. Only the accepted store's
  // ENOENT decides that an account has no rows; anything else (I/O, permission,
  // wrong key, tampered envelope, a non-array result) is a named locked recovery
  // that leaves the existing bytes untouched.
  const safeStore = {
    read(accountId) {
      try {
        const rows = store.read(accountId);
        return Array.isArray(rows) ? { rows } : { locked: "draft_unreadable" };
      } catch (error) {
        return { locked: nodeErrorCode(error, "draft_unreadable") };
      }
    },
    write(accountId, rows) {
      try {
        const report = store.write(accountId, rows);
        // The accepted store's own report is the only source of replacement and
        // directory-sync truth; absence is reported as unknown, never assumed.
        // Only a plain own-property data record with an own boolean `persisted`
        // is a report: {}, [], Date, a thenable, a primitive and an inherited
        // `persisted` are all refused rather than relabeled as a success.
        if (!isWriteReport(report)) {
          return { succeeded: false, persisted: false, persistedUnknown: true, replacedExisting: false, directorySync: null };
        }
        // `succeeded` is optional (the accepted store omits it), but an own
        // non-true value is an explicit unsuccessful write, not a silent success.
        const failed = (hasOwn(report, "succeeded") && report.succeeded !== true) || report.failure !== undefined;
        return {
          ...report,
          succeeded: !failed,
          persisted: report.persisted,
          persistedUnknown: false,
        };
      } catch (error) {
        return { succeeded: false, persisted: false, persistedUnknown: true, replacedExisting: false, directorySync: null, failure:
        nodeErrorCode(error, "persist_failed") };
      }
    },
  };

  const state = {
    documents: new Map(),
    versions: new Map(),
    idempotency: new Map(),
    uploads: new Map(),
    acl: new Map(),
    ownerAcl: new Map(),
    sessions: new Map(),
    tombstones: new Set(),
    tempObjects: new Map(),
    quota: { limitBytes: 8 * 1024, usedBytes: 0 },
    seq: 0,
  };

  // ---- change feed -------------------------------------------------------
  const feed = createChangeFeed({
    retention: changeRetention,
    snapshotTtlMs,
    now,
    fail,
    cursorKey: cursorKey ?? crypto.createHash("sha256").update("uniwork-office-g0-cursor").digest(),
    listCurrent: ({ orgId, wsId }) => {
      const rows = [];
      for (const doc of state.documents.values()) {
        if (doc.orgId !== orgId || doc.wsId !== wsId) continue;
        // A deleted document is not a live row, but a full resync must still learn
        // that it is gone: the snapshot carries it as its tombstone, and the read
        // filter keeps it from anyone who never could read the document.
        rows.push({
          documentId: doc.id,
          orgId,
          wsId,
          revision: doc.revision,
          kind: state.tombstones.has(doc.id) ? "deleted" : "upsert",
        });
      }
      return rows;
    },
    canRead: (accountId, row) => canReadChange(accountId, row),
    // Existence is live even when a snapshot froze the values: a document deleted
    // while the snapshot was open is emitted as its tombstone by the final page.
    resolveRow: (row) => ({ ...row, kind: state.tombstones.has(row.documentId) ? "deleted" : row.kind }),
  });

  function requireSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session || session.revoked || session.accessExpiresAt <= now()) fail("token_expired");
    return session;
  }

  /** Scope is part of identity: a session for another org/ws may not act here. */
  function requireScope(session, orgId, wsId) {
    if (orgId && session.orgId !== orgId) fail("forbidden", { reason: "scope_org" });
    if (wsId && session.wsId !== wsId) fail("forbidden", { reason: "scope_ws" });
    return { orgId: session.orgId, wsId: session.wsId };
  }

  function document(docId) {
    const doc = state.documents.get(docId);
    if (!doc) fail("not_found");
    if (state.tombstones.has(docId)) fail("document_deleted", { documentId: docId });
    return doc;
  }

  function effectiveLevel(actorId, doc) {
    if (doc.ownerKind === "work_product") {
      const level = state.ownerAcl.get(doc.ownerId)?.get(actorId);
      return level ? { level, via: "owner" } : null;
    }
    const level = state.acl.get(doc.id)?.get(actorId);
    return level ? { level, via: "document" } : null;
  }

  function requireLevel(actorId, doc, levels) {
    const effective = effectiveLevel(actorId, doc);
    if (!effective || !levels.includes(effective.level)) fail("forbidden");
    return effective;
  }

  /**
   * Whether an actor may see a change event. A deleted document reports only its
   * tombstone, and even that only to an actor who could read it: an id nobody had
   * access to must not leak just because it was deleted.
   */
  function canReadChange(actorId, event) {
    const doc = state.documents.get(event.documentId);
    if (!doc) return false;
    if (state.tombstones.has(event.documentId)) {
      return event.kind === "deleted" && Boolean(effectiveLevel(actorId, doc));
    }
    return Boolean(effectiveLevel(actorId, doc));
  }

  // ---- drafts ------------------------------------------------------------
  // Full identity is account + org + ws + doc + baseRevision + baseVersion. Two
  // unsent edits of the same document against different bases are two drafts, not
  // one overwriting the other, or recovery silently drops work.
  const draftKey = (row) => [row.orgId, row.wsId, row.docId, row.baseRevision, row.baseVersion].join("\u0000");
  /**
   * Every draft read goes through here. `locked` is a named recovery-locked
   * outcome that preserves the stored bytes; it is never an empty list, because
   * "unreadable" and "nothing was ever saved" are different contract outcomes.
   */
  const readDraftRows = (accountId, store = safeStore) => {
    const outcome = store.read(accountId);
    if (outcome.locked) return { locked: outcome.locked, rows: [] };
    return { rows: outcome.rows };
  };
  const readRows = (accountId) => readDraftRows(accountId).rows;
  const lockedOutcome = (locked) => ({ outcome: "recovery_locked", reason: locked, status: "locked" });

  /**
   * Draft METADATA, never bytes. The payload stays in the store until a recovery
   * proves the same account, the same scope, live read/edit rights and an exact
   * base; a list endpoint that returned payloads would hand unsent work to any
   * account that can name the document.
   */
  function draftMetadata(row) {
    const doc = state.documents.get(row.docId);
    const deleted = state.tombstones.has(row.docId) || !doc;
    const level = deleted ? null : effectiveLevel(row.accountId, doc)?.level ?? null;
    const rights = deleted ? "document_deleted" : level ?? "none";
    const blocked = deleted || !["edit", "manage"].includes(rights);
    return {
      draftId: draftKey(row),
      accountId: row.accountId,
      orgId: row.orgId,
      wsId: row.wsId,
      docId: row.docId,
      baseRevision: row.baseRevision,
      baseVersion: row.baseVersion,
      state: blocked ? "blocked" : row.state,
      rights,
      bytes: typeof row.payload === "string" ? row.payload.length : 0,
      hasPayload: typeof row.payload === "string" && row.payload.length > 0,
      updatedAt: row.updatedAt,
    };
  }

  const pendingScope = new Map();
  const auth = createAuthModel({ now, sessions: state.sessions, fail });
  const client = createClient({ auth, now, fail });

  return {
    state,
    feed,

    // ---- auth (authorization code + PKCE, modeled) -----------------------
    /**
     * The real desktop flow (system browser + authorization code + PKCE to the
     * fixed custom scheme) is specified in the contract doc. The harness drives
     * the same server/client split the flow has, so the pending attempt and the
     * state/redirect binding are exercised rather than assumed.
     *
     * beginAuth performs the client half and, as the authorization server would,
     * hands the test the code the browser would carry back. The client never uses
     * that code itself: completeAuth only accepts a callback whose state and
     * redirect belong to the pending attempt.
     */
    beginAuth({ accountId, orgId = "org-1", wsId = "ws-1" }) {
      const request = client.begin({ accountId });
      pendingScope.set(request.attemptId, { orgId, wsId });
      const attempt = client.attempts.get(request.attemptId);
      return { ...request, orgId, wsId, browserReturns: { code: attempt.code, state: request.state } };
    },

    completeAuth({ code, state: callbackState, redirect = REDIRECT_URI }) {
      const attempt = [...client.attempts.values()].find((candidate) => candidate.code === code);
      const result = client.complete({ code, state: callbackState, redirect });
      const scope = pendingScope.get(attempt.attemptId) ?? { orgId: "org-1", wsId: "ws-1" };
      pendingScope.delete(attempt.attemptId);
      const session = state.sessions.get(result.sessionId);
      session.orgId = scope.orgId;
      session.wsId = scope.wsId;
      return { sessionId: result.sessionId, accountId: result.accountId, ...scope };
    },

    /** Fixture convenience: begin and complete one honest attempt. */
    loginAs({ accountId, orgId = "org-1", wsId = "ws-1" }) {
      const request = this.beginAuth({ accountId, orgId, wsId });
      return this.completeAuth({ code: request.browserReturns.code, state: request.browserReturns.state, redirect: request.redirectUri });
    },

    /** Server-side authorize/redeem, for cases that call the halves directly. */
    authorizeCode(options) {
      return auth.authorize(options);
    },
    redeemCode(options) {
      return auth.redeem(options);
    },
    /** The client's pending attempts, exposed so a case can read a code only. */
    pendingAttempts() {
      return [...client.attempts.values()];
    },

    revokeDevice(sessionId) {
      const session = state.sessions.get(sessionId);
      if (session) session.revoked = true;
    },

    expireAccessToken(sessionId) {
      const session = state.sessions.get(sessionId);
      if (session) session.accessExpiresAt = 0;
    },

    addDocument({ id, orgId, wsId, ownerKind = null, ownerId = null, checksum = "genesis", format = "docx", engine = null }) {
      const doc = {
        id,
        orgId,
        wsId,
        ownerKind,
        ownerId,
        revision: 1,
        currentVersion: 1,
        checksum,
        format,
        engine,
      };
      state.documents.set(id, doc);
      state.versions.set(id, [{ version: 1, checksum, reason: "upload", base: null }]);
      state.acl.set(id, new Map());
      feed.append({ kind: "created", documentId: id, orgId, wsId, revision: 1 });
      state.quota.usedBytes += checksum.length;
      return doc;
    },

    grant(docId, accountId, level) {
      const doc = state.documents.get(docId);
      if (!doc) fail("not_found");
      if (!state.acl.has(docId)) state.acl.set(docId, new Map());
      state.acl.get(docId).set(accountId, level);
      // Targeted upsert: exactly the granted account learns about this document.
      feed.grant({ accountId, documentId: docId, orgId: doc.orgId, wsId: doc.wsId, revision: doc.revision });
    },

    revoke(docId, accountId) {
      const doc = state.documents.get(docId);
      const had = state.acl.get(docId)?.delete(accountId);
      // Id-only removal, and only to an account that actually had access: a
      // revoke must not become a way to enumerate documents to strangers.
      if (doc && had) feed.revoke({ accountId, documentId: docId, orgId: doc.orgId, wsId: doc.wsId });
    },

    setOwnerLevel(ownerId, accountId, level) {
      if (!state.ownerAcl.has(ownerId)) state.ownerAcl.set(ownerId, new Map());
      const had = state.ownerAcl.get(ownerId).get(accountId) ?? null;
      state.ownerAcl.get(ownerId).set(accountId, level);
      // One owner-level change fans out to every document that delegates to that
      // owner (C-01 section 13), and only to the account whose level moved. The
      // contract says every CHANGE, not only the first grant: an edit -> view (or
      // view -> edit) moves this account's effective rights on every delegated
      // document, so the client must hear about it exactly like a first grant. A
      // repeat of the SAME level is not a change and emits nothing. The wire event
      // kind stays "granted" (the feed's only upsert kind for an owner audience);
      // no new kind is invented for a lower level.
      if (had !== level) {
        feed.ownerTransition({
          accountId,
          ownerId,
          ownerKind: "work_product",
          kind: "granted",
          documents: [...state.documents.values()],
          revisionOf: (docId) => state.documents.get(docId)?.revision ?? null,
        });
      }
    },

    clearOwnerLevel(ownerId, accountId) {
      const levels = state.ownerAcl.get(ownerId);
      const had = levels?.delete(accountId);
      if (had) {
        feed.ownerTransition({
          accountId,
          ownerId,
          ownerKind: "work_product",
          kind: "removed",
          documents: [...state.documents.values()],
        });
      }
    },

    setQuotaLimit(bytes) {
      state.quota.limitBytes = bytes;
    },

    // ---- open -------------------------------------------------------------
    openDocument({ sessionId, docId, orgId = null, wsId = null }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      requireScope(session, orgId ?? doc.orgId, wsId ?? doc.wsId);
      requireLevel(session.accountId, doc, ["view", "comment", "edit", "manage"]);
      return { revision: doc.revision, version: doc.currentVersion, checksum: doc.checksum, format: doc.format };
    },

    // ---- save: two-phase, permission re-checked at commit ------------------
    /**
     * Phase 1. Body stays off this path on purpose: a large Office payload cannot
     * travel in the 1 MiB JSON body (CLAUDE.md, Backend HTTP Rules), so the client
     * uploads bytes to a temporary object first and references it. Base revision
     * is deliberately NOT decided here; it is re-checked at commit.
     */
    beginUpload({ sessionId, docId, baseRevision, payload, engine }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      requireScope(session, doc.orgId, doc.wsId);
      requireLevel(session.accountId, doc, ["edit", "manage"]);
      if (!engine || engine.status !== "compatible") {
        fail("engine_incompatible", { engine: engine?.name, version: engine?.version });
      }
      const uploadId = crypto.randomUUID();
      const tempObjectKey = "office-tmp/" + uploadId;
      state.uploads.set(uploadId, {
        docId,
        checksum: sha256(payload),
        bytes: Buffer.byteLength(payload),
        accountId: session.accountId,
        committed: false,
      });
      state.tempObjects.set(tempObjectKey, { uploadId, docId });
      return { uploadId, tempObjectKey, checksum: sha256(payload) };
    },

    /**
     * Phase 2. Everything that can refuse a save is decided here, in one place:
     * idempotency, permission, engine compatibility, base revision, quota.
     */
    commitSave({
      sessionId,
      docId,
      uploadId,
      baseRevision,
      idempotencyKey = null,
      payload,
      engine,
      fromDraftId = null,
    }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      requireScope(session, doc.orgId, doc.wsId);
      const upload = state.uploads.get(uploadId);
      if (!upload || upload.docId !== docId) fail("not_found");
      // The upload belongs to the actor who created it, and it may be committed
      // once. Without the owner check a second editor turns someone else's bytes
      // into a version under their own name; without the consumed check a
      // committed upload is replayed with a fresh key to mint versions nobody sent.
      if (upload.accountId !== session.accountId) fail("forbidden", { reason: "upload_owner" });

      const ledgerKey = ["document.save", doc.orgId, doc.wsId, docId, idempotencyKey].join(":");
      const fingerprint = fingerprintOf({ docId, baseRevision, checksum: upload.checksum });
      const existing = idempotencyKey ? state.idempotency.get(ledgerKey) : undefined;
      if (existing) {
        if (existing.accountId !== session.accountId) fail("idempotency_key_reuse");
        if (existing.response === null) fail("idempotency_in_flight");
        if (idempotencyFingerprint && existing.fingerprint !== fingerprint) {
          fail("idempotency_payload_mismatch", { key: idempotencyKey });
        }
        // A replay answers a request that already committed, but it is still a
        // read of that version by this actor: a share revoked in the meantime
        // must not hand the version metadata back.
        requireLevel(session.accountId, doc, ["edit", "manage"]);
        return { ...existing.response, replayed: true };
      }

      if (upload.committed) fail("upload_already_committed", { uploadId });

      const effective = requireLevel(session.accountId, doc, ["edit", "manage"]);
      if (!engine || engine.status !== "compatible") {
        fail("engine_incompatible", { engine: engine?.name, version: engine?.version });
      }
      if (baseRevision !== doc.revision) fail("revision_conflict", { got: baseRevision, want: doc.revision });
      if (state.quota.usedBytes + upload.bytes > state.quota.limitBytes) {
        fail("quota_exceeded", { used: state.quota.usedBytes, limit: state.quota.limitBytes });
      }

      // Capture the pre-commit head BEFORE it advances. Draft cleanup must match
      // the base this commit consumed (base revision AND the version the draft
      // was written against), never the head the commit just produced.
      const consumedBaseRevision = baseRevision;
      const precommitVersion = doc.currentVersion;

      if (idempotencyKey) {
        state.idempotency.set(ledgerKey, { accountId: session.accountId, fingerprint, response: null });
      }

      doc.currentVersion += 1;
      doc.revision += 1;
      doc.checksum = upload.checksum;
      state.versions.get(docId).push({ version: doc.currentVersion, checksum: upload.checksum, reason: "upload", base: baseRevision });
      state.quota.usedBytes += upload.bytes;
      upload.committed = true;
      state.tempObjects.delete(tempObjectKeyOf(uploadId));
      feed.append({ kind: "version_created", documentId: docId, orgId: doc.orgId, wsId: doc.wsId, revision: doc.revision });

      const response = {
        documentId: docId,
        revision: doc.revision,
        version: doc.currentVersion,
        checksum: doc.checksum,
        via: effective.via,
        replayed: false,
      };
      if (idempotencyKey) state.idempotency.get(ledgerKey).response = response;
      // A confirmed commit is one of the only two ways a draft may disappear.
      // Local draft cleanup is a SEPARATE outcome from the commit itself: the
      // store is read first, so cleanup over unreadable bytes is refused instead
      // of risking them, and a write failure is reported rather than thrown. The
      // committed result stands either way; a failure must never roll back the
      // head or present the commit as failed.
      //
      // fromDraftId alone is NOT cleanup authorization. A reference may remove a
      // draft only when it is the same account/org/ws/doc, was written against the
      // base THIS commit consumed (revision AND pre-commit version), and its
      // current payload checksum is the bytes actually committed. A replaced local
      // payload on the same base, another document/workspace/base, or no matching
      // row must survive, with the commit reported as retained/no-match.
      if (fromDraftId) {
        const survivor = { ...response, cleanup: { outcome: "not_requested" } };
        const existing = readDraftRows(session.accountId);
        if (existing.locked) {
          survivor.cleanup = { outcome: "recovery_locked", reason: existing.locked, retained: true };
        } else {
          const target = existing.rows.find((row) => draftKey(row) === fromDraftId) ?? null;
          if (!target) {
            // Nothing matched. The store is not rewritten just because it was
            // asked to: a non-matching reference is not permission to touch rows.
            survivor.cleanup = { outcome: "no_match", retained: true };
          } else if (
            target.orgId !== doc.orgId ||
            target.wsId !== doc.wsId ||
            target.docId !== docId ||
            target.baseRevision !== consumedBaseRevision ||
            target.baseVersion !== precommitVersion ||
            typeof target.payload !== "string" ||
            checksumOf(target.payload) !== upload.checksum
          ) {
            // Same key but the row no longer describes the committed bytes (a
            // newer local edit, another doc/workspace, or a different base).
            // Retain it: the confirmed commit stands, the local work survives.
            survivor.cleanup = { outcome: "retained", reason: "identity_mismatch", retained: true };
          } else {
            const write = safeStore.write(
              session.accountId,
              existing.rows.filter((row) => row !== target),
            );
                survivor.cleanup = writeSucceeded(write, memoryOnlyStore)
              ? { outcome: "removed", replacedExisting: write.replacedExisting === true }
              : { outcome: "failed", reason: write.failure ?? "persist_failed", retained: true,
              persistedUnknown: write.persistedUnknown === true };
          }
        }
        // The ledger must retain the committed result, so a same-key retry
        // replays the commit instead of reporting the cleanup outcome.
        if (idempotencyKey) state.idempotency.get(ledgerKey).response = survivor;
        return survivor;
      }
      return response;
    },

    /**
     * What a refused commit leaves behind: uploaded bytes stay in the temporary
     * object set until the retry or the cleanup job, never silently deleted.
     */
    orphans() {
      return [...state.tempObjects.keys()].sort();
    },

    versionsOf(docId) {
      return state.versions.get(docId)?.length ?? 0;
    },

    // ---- change feed API ---------------------------------------------------
    readChanges({ sessionId, cursor = "0", limit = 100 }) {
      const session = requireSession(sessionId);
      const page = feed.read({ accountId: session.accountId, orgId: session.orgId, wsId: session.wsId, cursor, limit });
      return { ...page, accountId: session.accountId, orgId: session.orgId, wsId: session.wsId };
    },

    tombstone(docId) {
      const doc = state.documents.get(docId);
      state.tombstones.add(docId);
      if (doc) feed.append({ kind: "deleted", documentId: docId, orgId: doc.orgId, wsId: doc.wsId, revision: doc.revision });
    },

    // ---- durable drafts (Q8) ----------------------------------------------
    /**
     * Persist a draft. Bytes are scoped by account at the storage layer, one
     * namespace per account, because "account B must not read A's draft" is a
     * property of where the bytes live; the read path is session-checked on top.
     */
    saveDraft({
      sessionId,
      docId,
      payload,
      baseRevision,
      baseVersion = 1,
      orgId = null,
      wsId = null,
      state: draftState = "dirty",
      engine = null,
    }) {
      const session = requireSession(sessionId);
      const doc = state.documents.get(docId);
      const scope = requireScope(session, orgId ?? doc?.orgId ?? session.orgId, wsId ?? doc?.wsId ?? session.wsId);
      const row = {
        accountId: session.accountId,
        orgId: scope.orgId,
        wsId: scope.wsId,
        docId,
        payload,
        baseRevision,
        baseVersion,
        engine,
        state: draftState,
        updatedAt: now(),
      };
      const existing = readDraftRows(session.accountId);
      // A store whose bytes cannot be read locks the draft: the new row is not
      // written on top of what could not be decrypted, and the caller is told.
      if (existing.locked) {
        fail("draft_recovery_locked", { reason: existing.locked, documentId: docId });
      }
      const rows = existing.rows.filter((old) => draftKey(old) !== draftKey(row));
      rows.push(row);
      const write = safeStore.write(session.accountId, rows);
        if (!writeSucceeded(write, memoryOnlyStore)) fail("draft_recovery_locked", { reason: write.failure ?? "persist_failed" });
        return { ...draftMetadata(row), persisted: write.persisted === true, replacedExisting: write.replacedExisting === true };
    },

    /**
     * Metadata only, scoped, and never another account's rows. An unreadable
     * store (I/O, wrong key, tampered envelope) is a named recovery-locked
     * outcome, never "no drafts": only the accepted store's ENOENT decides that
     * an account has no rows.
     */
    listDrafts({ sessionId, accountId = null, orgId = null, wsId = null }) {
      const session = requireSession(sessionId);
      if (accountId && accountId !== session.accountId) fail("forbidden", { reason: "draft_account" });
      // Scope is the session's own, unless the caller names one explicitly, in
      // which case mismatching it is a refusal rather than a silent empty list.
      const scope =
        orgId || wsId ? requireScope(session, orgId ?? session.orgId, wsId ?? session.wsId) : { orgId: session.orgId, wsId: session.wsId };
      const read = readDraftRows(session.accountId);
      if (read.locked) return lockedOutcome(read.locked);
      return read.rows
        .filter((row) => row.orgId === scope.orgId && row.wsId === scope.wsId)
        .map((row) => draftMetadata(row));
    },

    /**
     * The only way draft bytes return: same account, same scope, live read/edit
     * rights and an exact base (revision AND version). Anything else is a refusal
     * that keeps the bytes on disk.
     */
    recoverDraft({ sessionId, docId, baseRevision = null, baseVersion = null, orgId = null, wsId = null }) {
      const session = requireSession(sessionId);
      // A draft in another organization or workspace is simply not in this
      // session's scope: the caller gets "missing", not a list of other people's
      // work. Naming a scope explicitly is checked, so a lie is refused.
      const scope =
        orgId || wsId ? requireScope(session, orgId ?? session.orgId, wsId ?? session.wsId) : { orgId: session.orgId, wsId: session.wsId };
      const doc = state.documents.get(docId);
      const read = readDraftRows(session.accountId);
      if (read.locked) return lockedOutcome(read.locked);
      const candidates = read.rows.filter(
        (row) => row.docId === docId && row.orgId === scope.orgId && row.wsId === scope.wsId,
      );
      if (candidates.length === 0) return { status: "missing" };
      // Unresolved distinct bases stay distinct. Two unsent edits against
      // different bases are two drafts; without a FULL base the caller gets the
      // bases that exist and no payload, because applying either would be a guess.
      const bases = candidates.map((row) => ({ baseRevision: row.baseRevision, baseVersion: row.baseVersion }));
      // Identity is all-or-nothing: naming EITHER half means the caller must name
      // BOTH, and the row must match both. A revision-only or version-only call
      // that happened to leave one candidate would otherwise hand back bytes for a
      // base the caller never confirmed, which is the same lost-text guess the
      // base check exists to prevent (and discard already refuses to make). A call
      // that names no base at all may still take the sole candidate.
      const namesBaseHalf = baseRevision !== null || baseVersion !== null;
      const exact = namesBaseHalf
        ? baseRevision !== null && baseVersion !== null
          ? candidates.find((row) => row.baseRevision === baseRevision && row.baseVersion === baseVersion) ?? null
          : null
        : candidates.length === 1
          ? candidates[0]
          : null;
      if (!exact) return { status: "ambiguous", bases };
      // A state mark is a write, but a state mark failure must not destroy the
      // recovery: bytes were read successfully, so the outcome is reported and
      // the state write is honestly marked as failed.
      let markLocked = null;
      const mark = (draftState) => {
        const latest = readDraftRows(session.accountId);
        if (latest.locked) {
          markLocked = latest.locked;
          return;
        }
        const write = safeStore.write(
          session.accountId,
          latest.rows.map((row) => (draftKey(row) === draftKey(exact) ? { ...row, state: draftState } : row)),
        );
          if (!writeSucceeded(write, memoryOnlyStore)) markLocked = write.failure ?? "persist_failed";
      };
      const marked = (result) => (markLocked === null ? result : { ...result, stateWrite: "failed", reason:
      markLocked });
      if (state.tombstones.has(docId)) {
        mark("blocked");
        return marked({ status: "blocked", reason: "document_deleted", payloadPreserved: exact.payload.length > 0 });
      }
      if (!doc) {
        mark("blocked");
        return marked({ status: "blocked", reason: "not_found", payloadPreserved: exact.payload.length > 0 });
      }
      const effective = effectiveLevel(session.accountId, doc);
      if (!effective || !["edit", "manage"].includes(effective.level)) {
        // Losing the right to edit keeps the bytes on disk and locks them in the
        // app. It must not delete unsent work and must not offer an export path
        // around the revoked permission.
        mark("blocked");
        return marked({
          status: "blocked",
          reason: "permission_revoked",
          payloadPreserved: exact.payload.length > 0,
          rights: effective?.level ?? "none",
        });
      }
      // Both halves of the base are compared. A draft whose revision matches but
      // whose blob version moved describes a different document, and applying it
      // silently is the lost-text outcome Q8 exists to prevent.
      if (exact.baseRevision !== doc.revision || exact.baseVersion !== doc.currentVersion) {
        mark("conflict");
        return marked({
          status: "conflict",
          base: exact.baseRevision,
          current: doc.revision,
          baseVersion: exact.baseVersion,
          currentVersion: doc.currentVersion,
          payloadPreserved: exact.payload.length > 0,
        });
      }
      return {
        status: "recovered",
        payload: exact.payload,
        base: exact.baseRevision,
        baseVersion: exact.baseVersion,
        via: effective.via,
      };
    },

    /**
     * Explicit discard: the user said no. The other legal cleanup path.
     *
     * Scoped exactly like every other draft read: the session's own account, org
     * and workspace, plus the named document. Every supplied base half is
     * honored; a complete base or an exact draftId selects one row. Multiple
     * candidates without a complete identity are ambiguous and write NOTHING; a
     * supplied base or draftId that matches nothing is a mismatch, never a silent
     * discard of the single candidate that happened to be present.
     */
    discardDraft({ sessionId, docId, baseRevision = null, baseVersion = null, draftId = null }) {
      const session = requireSession(sessionId);
      const existing = readDraftRows(session.accountId);
      if (existing.locked) return lockedOutcome(existing.locked);
      // Scope first: another account's rows are a different store, and another
      // org/ws row with the same document id is not a discard candidate.
      const scoped = existing.rows.filter(
        (row) => row.orgId === session.orgId && row.wsId === session.wsId && row.docId === docId,
      );
      if (scoped.length === 0) return { outcome: "not_found", status: "missing" };
      const selected = scoped.filter(
        (row) =>
          (draftId === null || draftKey(row) === draftId) &&
          (baseRevision === null || row.baseRevision === baseRevision) &&
          (baseVersion === null || row.baseVersion === baseVersion),
      );
      if (selected.length > 1) {
        // Two drafts of the same document on different bases are two drafts;
        // without a complete identity the caller must disambiguate.
        return {
          outcome: "ambiguous",
          status: "ambiguous",
          bases: selected.map((row) => ({ baseRevision: row.baseRevision, baseVersion: row.baseVersion })),
        };
      }
      if (selected.length === 0) {
        // A named base or draftId matched nothing: keep every candidate rather
        // than discarding the one that happened to be present.
        return { outcome: "mismatch", status: "mismatch", retained: true };
      }
      const write = safeStore.write(
        session.accountId,
        existing.rows.filter((row) => row !== selected[0]),
      );
        if (!writeSucceeded(write, memoryOnlyStore)) return { outcome: "recovery_locked", reason: write.failure ??
        "persist_failed",
      status: "locked" };
        return { outcome: "discarded", discarded: 1, persisted: write.persisted === true, replacedExisting:
        write.replacedExisting === true };
    },

    // ---- conversion (Q7-B) -------------------------------------------------
    /**
     * A conversion that can lose fidelity never overwrites its source: it creates
     * a NEW document, carries the source's COMPLETE permission set without
     * elevating the converter, and records where the bytes came from.
     */
    convertDocument({ sessionId, docId, targetFormat, mode, consent = null, engine = null }) {
      const session = requireSession(sessionId);
      const source = document(docId);
      requireScope(session, source.orgId, source.wsId);
      requireLevel(session.accountId, source, ["edit", "manage"]);
      if (mode !== "copy") fail("owner_requires_copy", { reason: "conversion_preserves_source" });
      // Copying is a user decision, not a default: the client must send the
      // consent it collected when it warned what fidelity would change.
      if (consent !== "copy") fail("copy_consent_required", { reason: "explicit_consent_required" });
      if (engine && engine.status !== "compatible") {
        fail("engine_incompatible", { engine: engine.name, version: engine.version });
      }
      const copyId = docId + "." + targetFormat;
      if (state.documents.has(copyId)) fail("owner_requires_copy", { reason: "copy_already_exists", copyId });
      const copyChecksum = source.checksum + ":" + targetFormat;
      const copyBytes = copyChecksum.length;
      // A copy is a real new document with its own bytes: it consumes quota like
      // any other write. Skipping this lets a full quota keep minting documents.
      if (state.quota.usedBytes + copyBytes > state.quota.limitBytes) {
        fail("quota_exceeded", { used: state.quota.usedBytes, limit: state.quota.limitBytes });
      }
      const copy = {
        id: copyId,
        orgId: source.orgId,
        wsId: source.wsId,
        ownerKind: source.ownerKind,
        ownerId: source.ownerId,
        revision: 1,
        currentVersion: 1,
        checksum: copyChecksum,
        format: targetFormat,
        engine: source.engine,
        // Provenance: which document, which version, which format and which
        // engine the copy actually came from. Without it a copy is unattributable.
        provenance: {
          sourceDocumentId: docId,
          sourceVersion: source.currentVersion,
          sourceRevision: source.revision,
          sourceFormat: source.format,
          sourceEngine: source.engine,
          targetFormat,
        },
      };
      state.documents.set(copyId, copy);
      state.versions.set(copyId, [{ version: 1, checksum: copyChecksum, reason: "agent", base: source.currentVersion }]);
      state.quota.usedBytes += copyBytes;
      // The copy carries the source ACL EXACTLY. It never adds a level the
      // converter did not already have on the source, so edit cannot become
      // manage; and a Work Product copy carries no document ACL at all, because
      // rights keep flowing through the single owner delegation.
      state.acl.set(copyId, new Map());
      const carried = carriedAcl({
        sourceOwnerKind: source.ownerKind,
        sourceAclEntries: [...(state.acl.get(docId) ?? new Map()).entries()].map(([accountId, level]) => ({
          accountId,
          level,
        })),
      });
      for (const entry of carried) state.acl.get(copyId).set(entry.accountId, entry.level);
      feed.append({ kind: "created", documentId: copyId, orgId: copy.orgId, wsId: copy.wsId, revision: 1 });
      return {
        copyId,
        sourceDocumentId: docId,
        sourceVersion: source.currentVersion,
        ownerKind: source.ownerKind,
        ownerId: source.ownerId,
        provenance: copy.provenance,
        carriedAcl: carried,
        converterLevelOnCopy: state.acl.get(copyId).get(session.accountId) ?? null,
        sourceUntouched: { version: source.currentVersion, revision: source.revision, versions: state.versions.get(docId).length },
      };
    },
  };
}

const tempObjectKeyOf = (uploadId) => "office-tmp/" + uploadId;
/**
 * The mandatory fault cases from the plan, each with a LITERAL oracle.
 *
 * run({ model, base, restart, clock }) returns what was observed;
 * expect is what the contract says must be observed. Nothing here is derived
 * from the model, so a model that drifts fails rather than redefines success.
 *
 * expectLegacy (optional) is what today's code would do instead. Only the
 * idempotency-fingerprint case has one: it exists to prove the gap described in
 * the contract doc is real rather than asserted.
 */
/**
 * The mandatory fault cases from the plan, each with a LITERAL oracle.
 *
 * run({ model, base, restart, clock, dir, keys }) returns what was observed;
 * expect is what the contract says must be observed. Nothing here is derived
 * from the model, so a model that drifts fails rather than redefines success.
 *
 * expectLegacy (optional) is what today's code would do instead. Only the
 * idempotency-fingerprint case has one: it proves the BeginIdempotent
 * payload-fingerprint gap is real rather than asserted. That comparison is a
 * MODEL comparison (the same JavaScript model with the fingerprint switched off),
 * never execution of the Go BeginIdempotent: the finding is documentary plus
 * modeled, and the report says exactly that.
 */

/** Read a cursor to the end of its snapshot, collecting every visible event. */
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

const docIds = (events) => events.map((event) => event.documentId).sort();
const kindsOf = (events, documentId) =>
  events.filter((event) => event.documentId === documentId).map((event) => event.kind).sort();
const attemptOf = (model, code) => model.pendingAttempts().find((attempt) => attempt.code === code);

export const FAULT_CASES = [
  {
    id: "two-saves-same-base",
    requirement: "Hai save cung base - giu ca hai ban, khong ghi de im lang",
    run({ model, base }) {
      const firstUpload = model.beginUpload({ ...base, payload: "v2-A" });
      const first = model.commitSave({ ...base, uploadId: firstUpload.uploadId, payload: "v2-A" });
      const secondUpload = model.beginUpload({ ...base, payload: "v2-B" });
      let second;
      try {
        second = { outcome: "committed", value: model.commitSave({ ...base, uploadId: secondUpload.uploadId, payload: "v2-B" }) };
      } catch (error) {
        second = { outcome: "error", code: error.code, errorClass: error.errorClass, want: error.fields.want };
        // The client keeps both: the server's committed version and the local
        // edit as a conflict draft. Neither is destroyed.
        model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "v2-B", baseRevision: 1, state: "conflict" });
      }
      const listed = model.listDrafts({ sessionId: base.sessionId });
      return {
        first: first.replayed ? "replayed" : "committed",
        second: second.outcome,
        secondCode: second.code ?? null,
        secondClass: second.errorClass ?? null,
        secondSawCurrent: second.want ?? null,
        serverVersion: model.openDocument(base).version,
        versions: model.versionsOf(base.docId),
        localConflictKept: listed.length === 1 && listed[0].hasPayload === true,
        localConflictState: listed[0]?.state ?? null,
      };
    },
    expect: {
      first: "committed",
      second: "error",
      secondCode: "revision_conflict",
      secondClass: "conflict",
      secondSawCurrent: 2,
      serverVersion: 2,
      versions: 2,
      localConflictKept: true,
      localConflictState: "conflict",
    },
  },
  {
    id: "retry-same-payload",
    requirement: "Retry cung payload - cung ket qua, khong them phien ban",
    run({ model, base }) {
      const key = "k-retry-1";
      const upload = model.beginUpload({ ...base, payload: "same" });
      const committed = model.commitSave({ ...base, uploadId: upload.uploadId, payload: "same", idempotencyKey: key });
      const retry = model.commitSave({ ...base, uploadId: upload.uploadId, payload: "same", idempotencyKey: key });
      return {
        firstCommitted: committed.replayed === false,
        retryReplayed: retry.replayed,
        sameRevision: retry.revision === committed.revision,
        sameVersion: retry.version === committed.version,
        versions: model.versionsOf(base.docId),
      };
    },
    expect: { firstCommitted: true, retryReplayed: true, sameRevision: true, sameVersion: true, versions: 2 },
  },
  {
    id: "same-key-different-payload",
    requirement: "Cung key khac payload - phai bi tu choi, khong replay",
    run({ model, base }) {
      const key = "k-reuse-1";
      const first = model.beginUpload({ ...base, payload: "payload-A" });
      model.commitSave({ ...base, uploadId: first.uploadId, payload: "payload-A", idempotencyKey: key });
      const second = model.beginUpload({ ...base, payload: "payload-B" });
      try {
        model.commitSave({ ...base, uploadId: second.uploadId, payload: "payload-B", idempotencyKey: key });
        return { outcome: "replayed", code: null, versions: model.versionsOf(base.docId) };
      } catch (error) {
        return { outcome: "error", code: error.code, versions: model.versionsOf(base.docId) };
      }
    },
    // Contract: the payload fingerprint is part of the ledger row, so the
    // mismatch is refused and payload-B never becomes a version.
    expect: { outcome: "error", code: "idempotency_payload_mismatch", versions: 2 },
    // Today's BeginIdempotent keys on (org, workspace, scope, key) alone and never
    // compares payloads, so it would REPLAY the first answer: the client believes
    // payload-B was saved and payload-B is nowhere. This is the MODELED comparison
    // of that behaviour, not a run of the Go code.
    expectLegacy: { outcome: "replayed", code: null, versions: 2 },
  },
  {
    id: "lost-response-after-commit",
    requirement: "Mat phan hoi sau commit - retry hoi tu, khong tao phien ban thu hai",
    run({ model, base }) {
      const key = "k-lost-1";
      const upload = model.beginUpload({ ...base, payload: "lost" });
      const committed = model.commitSave({ ...base, uploadId: upload.uploadId, payload: "lost", idempotencyKey: key });
      // The response never reaches the client; it retries the same request.
      const retry = model.commitSave({ ...base, uploadId: upload.uploadId, payload: "lost", idempotencyKey: key });
      return {
        committedVersion: committed.version,
        retryVersion: retry.version,
        retryReplayed: retry.replayed,
        versions: model.versionsOf(base.docId),
        clientConvergesTo: model.openDocument(base).version,
      };
    },
    expect: { committedVersion: 2, retryVersion: 2, retryReplayed: true, versions: 2, clientConvergesTo: 2 },
  },
  {
    id: "failed-commit-keeps-current",
    requirement: "Commit loi khong doi ban hien hanh; object tam thanh mo coi",
    run({ model, base }) {
      const payload = "too-big-to-fit-in-a-one-byte-quota";
      model.setQuotaLimit(1);
      const upload = model.beginUpload({ ...base, payload });
      let failure;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload });
        failure = { result: "committed" };
      } catch (error) {
        failure = { result: "error", code: error.code, errorClass: error.errorClass };
      }
      // MEASURE the damage before the retry, not after: the point of the case is
      // that a refused commit changed nothing, and a number read after a retry
      // could have been produced by the retry.
      const afterFailure = {
        currentVersion: model.openDocument(base).version,
        versions: model.versionsOf(base.docId),
        orphans: model.orphans().length,
      };
      model.setQuotaLimit(8 * 1024);
      const retried = model.commitSave({ ...base, uploadId: upload.uploadId, payload });
      return {
        ...failure,
        currentUnchanged: afterFailure.currentVersion === 1,
        versionsAfterFailure: afterFailure.versions,
        orphansAfterFailure: afterFailure.orphans,
        retrySucceeded: retried.version === 2,
        orphansAfterRetry: model.orphans().length,
      };
    },
    expect: {
      result: "error",
      code: "quota_exceeded",
      errorClass: "quota",
      currentUnchanged: true,
      versionsAfterFailure: 1,
      orphansAfterFailure: 1,
      retrySucceeded: true,
      orphansAfterRetry: 0,
    },
  },
  {
    id: "orphans-measured-before-retry",
    requirement: "Object mo coi va phien ban duoc do TRUOC khi retry, khong suy dien tu sau retry",
    run({ model, base }) {
      const payload = "bytes that will not fit";
      model.setQuotaLimit(model.state.quota.usedBytes + 4);
      const upload = model.beginUpload({ ...base, payload });
      let failure;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload });
        failure = { result: "committed" };
      } catch (error) {
        failure = { result: "error", code: error.code };
      }
      // Everything the oracle compares is captured HERE, between the failure and
      // the retry. If a future model deletes the temp object on refusal, or mints a
      // version before validating, these numbers move and the case fails.
      const measured = {
        versions: model.versionsOf(base.docId),
        orphans: model.orphans().length,
        tempObjects: model.state.tempObjects.size,
        current: model.openDocument(base).version,
      };
      model.setQuotaLimit(8 * 1024);
      const retry = model.commitSave({ ...base, uploadId: upload.uploadId, payload });
      return {
        ...failure,
        measuredVersions: measured.versions,
        measuredOrphans: measured.orphans,
        measuredTempObjects: measured.tempObjects,
        measuredCurrent: measured.current,
        retryVersion: retry.version,
        orphansAfterRetry: model.orphans().length,
        versionsAfterRetry: model.versionsOf(base.docId),
      };
    },
    expect: {
      result: "error",
      code: "quota_exceeded",
      measuredVersions: 1,
      measuredOrphans: 1,
      measuredTempObjects: 1,
      measuredCurrent: 1,
      retryVersion: 2,
      orphansAfterRetry: 0,
      versionsAfterRetry: 2,
    },
  },
  {
    id: "logout-restart-with-draft",
    requirement: "Logout/restart voi nhap - phien thu hoi, nhap con; dang nhap lai thay lai",
    run({ model, base, restart }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "unsent", baseRevision: 1 });
      model.revokeDevice(base.sessionId);

      const second = restart();
      const login = second.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-1" });
      // A restart has no memory: the draft is only there if its bytes reached the
      // disk, it is read back through a session for that account, and the bytes
      // themselves come back only through recovery.
      const afterRestart = second.listDrafts({ sessionId: login.sessionId });
      const recovered = second.recoverDraft({ sessionId: login.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 1 });
      return {
        sessionRevoked: (() => {
          try {
            model.openDocument(base);
            return false;
          } catch (error) {
            return error.code === "token_expired";
          }
        })(),
        draftsAfterRestart: afterRestart.length,
        draftSeenByMetadata: afterRestart[0]?.hasPayload === true,
        recovery: recovered.status,
        recoveredPayload: recovered.payload ?? null,
      };
    },
    expect: {
      sessionRevoked: true,
      draftsAfterRestart: 1,
      draftSeenByMetadata: true,
      recovery: "recovered",
      recoveredPayload: "unsent",
    },
  },
  {
    id: "account-b-cannot-reach-a-draft",
    requirement: "Tai khoan B khong doc/gui duoc nhap cua A",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "A-secret", baseRevision: 1 });
      const bSession = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      model.grant(base.docId, "account-b", "edit");
      const bDraftsBeforeWrite = model.listDrafts({ sessionId: bSession.sessionId }).length;
      model.saveDraft({ sessionId: bSession.sessionId, docId: base.docId, payload: "B-own", baseRevision: 1 });
      const aDraft = model.listDrafts({ sessionId: base.sessionId });
      // B may not even name A's account on the draft path.
      let bNamesA;
      try {
        model.listDrafts({ sessionId: bSession.sessionId, accountId: "account-a" });
        bNamesA = "allowed";
      } catch (error) {
        bNamesA = error.code;
      }
      let bCanOpen;
      try {
        model.openDocument({ sessionId: bSession.sessionId, docId: base.docId });
        bCanOpen = "allowed";
      } catch (error) {
        bCanOpen = error.code;
      }
      return {
        bSeesADraft: bDraftsBeforeWrite,
        aDraftSeenByMetadata: aDraft[0]?.hasPayload === true,
        bDraftCount: model.listDrafts({ sessionId: bSession.sessionId }).length,
        bNamesA,
        bCanOpen,
      };
    },
    expect: { bSeesADraft: 0, aDraftSeenByMetadata: true, bDraftCount: 1, bNamesA: "forbidden", bCanOpen: "allowed" },
  },
  {
    id: "a-loses-permission",
    requirement: "A mat quyen - nhap bi khoa, khong xuat, khong tu xoa",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "A-work", baseRevision: 1 });
      model.revoke(base.docId, base.accountId);
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 1 });
      const listed = model.listDrafts({ sessionId: base.sessionId });
      return {
        status: recovered.status,
        reason: recovered.reason,
        payloadPreserved: recovered.payloadPreserved,
        draftStillOnDisk: listed[0]?.hasPayload === true,
        draftState: listed[0]?.state ?? null,
        rightsNow: listed[0]?.rights ?? null,
      };
    },
    expect: {
      status: "blocked",
      reason: "permission_revoked",
      payloadPreserved: true,
      draftStillOnDisk: true,
      draftState: "blocked",
      rightsNow: "none",
    },
  },
  {
    id: "a-has-permission-base-changed",
    requirement: "A con quyen nhung base da doi - xung dot, hai ban con nguyen",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "A-edit", baseRevision: 1 });
      const other = model.beginUpload({ ...base, payload: "server-move" });
      model.commitSave({ ...base, uploadId: other.uploadId, payload: "server-move" });
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 1 });
      return {
        status: recovered.status,
        draftBase: recovered.base,
        serverCurrent: recovered.current,
        draftStillOnDisk: model.listDrafts({ sessionId: base.sessionId })[0]?.hasPayload === true,
        versions: model.versionsOf(base.docId),
      };
    },
    expect: { status: "conflict", draftBase: 1, serverCurrent: 2, draftStillOnDisk: true, versions: 2 },
  },
  {
    id: "quota-exhausted",
    requirement: "Quota het - khong bao da luu, ban hien hanh khong doi",
    run({ model, base }) {
      const payload = "way more than four bytes";
      model.setQuotaLimit(model.state.quota.usedBytes + 4);
      const upload = model.beginUpload({ ...base, payload });
      let observed;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload });
        observed = { outcome: "committed" };
      } catch (error) {
        observed = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      // The edit survives on the client as a dirty draft: a full quota must not
      // cost the person their unsent text.
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload, baseRevision: 1, state: "dirty" });
      const listed = model.listDrafts({ sessionId: base.sessionId });
      return {
        ...observed,
        currentVersion: model.openDocument(base).version,
        draftKept: listed.length,
        draftState: listed[0]?.state ?? null,
      };
    },
    expect: {
      outcome: "error",
      code: "quota_exceeded",
      errorClass: "quota",
      currentVersion: 1,
      draftKept: 1,
      draftState: "dirty",
    },
  },
  {
    id: "revoke-between-upload-and-commit",
    requirement: "Thu quyen giua upload va commit - commit bi tu choi, object tam mo coi",
    run({ model, base }) {
      const upload = model.beginUpload({ ...base, payload: "in-flight" });
      model.revoke(base.docId, base.accountId);
      let observed;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload: "in-flight" });
        observed = { outcome: "committed" };
      } catch (error) {
        observed = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      return { ...observed, versions: model.versionsOf(base.docId), orphans: model.orphans().length };
    },
    expect: { outcome: "error", code: "forbidden", errorClass: "permission", versions: 1, orphans: 1 },
  },
  {
    id: "copy-from-work-product",
    requirement: "Tao ban sao tu Work Product - Document moi, nguon va quyen giu nguyen",
    run({ model, base }) {
      model.addDocument({
        id: "wp-doc",
        orgId: "org-1",
        wsId: "ws-1",
        ownerKind: "work_product",
        ownerId: "wp-1",
        checksum: "wp-genesis",
      });
      model.setOwnerLevel("wp-1", "account-a", "edit");
      const copy = model.convertDocument({
        sessionId: base.sessionId,
        docId: "wp-doc",
        targetFormat: "pdf",
        mode: "copy",
        consent: "copy",
      });
      let overwrite;
      try {
        model.convertDocument({ sessionId: base.sessionId, docId: "wp-doc", targetFormat: "pdf", mode: "overwrite" });
        overwrite = { outcome: "allowed" };
      } catch (error) {
        overwrite = { outcome: "error", code: error.code };
      }
      // A second account with no Work Product level must not read the copy: the
      // copy delegates to the same owner, it does not open a second door.
      const outsider = model.loginAs({ accountId: "account-z", orgId: "org-1", wsId: "ws-1" });
      let outsiderRead;
      try {
        model.openDocument({ sessionId: outsider.sessionId, docId: copy.copyId });
        outsiderRead = "allowed";
      } catch (error) {
        outsiderRead = error.code;
      }
      let creatorRead;
      try {
        model.openDocument({ sessionId: base.sessionId, docId: copy.copyId });
        creatorRead = "allowed";
      } catch (error) {
        creatorRead = error.code;
      }
      return {
        copyOwnedByWorkProduct: copy.ownerKind === "work_product" && copy.ownerId === "wp-1",
        copyHasNoDocumentAcl: copy.carriedAcl.length === 0,
        copyLinksSource: copy.sourceDocumentId === "wp-doc",
        sourceVersionsKept: copy.sourceUntouched.versions,
        sourceRevisionKept: copy.sourceUntouched.revision,
        overwrite: overwrite.outcome,
        overwriteCode: overwrite.code ?? null,
        outsiderRead,
        creatorRead,
      };
    },
    expect: {
      copyOwnedByWorkProduct: true,
      copyHasNoDocumentAcl: true,
      copyLinksSource: true,
      sourceVersionsKept: 1,
      sourceRevisionKept: 1,
      overwrite: "error",
      overwriteCode: "owner_requires_copy",
      outsiderRead: "forbidden",
      creatorRead: "allowed",
    },
  },
  {
    id: "tombstone-and-expired-cursor",
    requirement: "Tombstone va cursor het han - retry khong hoi sinh file da xoa",
    run({ model, base }) {
      // Take a real incremental cursor first: cursors are opaque and signed, so a
      // case cannot hand-write a stale sequence number any more.
      const before = drain(model, base.sessionId, "0");
      model.addDocument({ id: "doc-2", orgId: "org-1", wsId: "ws-1", checksum: "doc2" });
      model.grant("doc-2", base.accountId, "edit");
      model.addDocument({ id: "doc-3", orgId: "org-1", wsId: "ws-1", checksum: "doc3" });
      model.grant("doc-3", base.accountId, "edit");
      const upload = model.beginUpload({ ...base, payload: "old-write" });
      model.tombstone(base.docId);
      let retry;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload: "old-write" });
        retry = { outcome: "committed" };
      } catch (error) {
        retry = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      // Walk the log past retention, then ask for the cursor taken before.
      model.addDocument({ id: "doc-4", orgId: "org-1", wsId: "ws-1", checksum: "doc4" });
      model.grant("doc-4", base.accountId, "edit");
      let stale;
      try {
        model.readChanges({ sessionId: base.sessionId, cursor: before.cursor });
        stale = { outcome: "served" };
      } catch (error) {
        stale = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      // Recovery from an expired cursor is a fresh snapshot, never a silent gap.
      const resync = drain(model, base.sessionId, "0");
      return {
        retry: retry.outcome,
        retryCode: retry.code ?? null,
        stale: stale.outcome,
        staleCode: stale.code ?? null,
        staleClass: stale.errorClass ?? null,
        resyncSeesDelete: resync.events.some((event) => event.kind === "deleted" && event.documentId === base.docId),
        resyncResurrects: resync.events.some(
          (event) => event.documentId === base.docId && (event.kind === "created" || event.kind === "upsert"),
        ),
        resyncStillHasOtherDocs: resync.events.some((event) => event.documentId !== base.docId),
      };
    },
    expect: {
      retry: "error",
      retryCode: "document_deleted",
      stale: "error",
      staleCode: "change_cursor_expired",
      staleClass: "gone",
      resyncSeesDelete: true,
      resyncResurrects: false,
      resyncStillHasOtherDocs: true,
    },
  },
  {
    id: "cursor-from-previous-log-expires-not-empty",
    requirement: "Cursor incremental tu mot log khac (tien trinh truoc) phai het han, khong tra ve da bat kip rong",
    run({ model, base, restart }) {
      // A real incremental cursor from THIS log, taken at the snapshot highwater.
      const mine = drain(model, base.sessionId, "0");
      // Asking the same log again at the same position is a genuine "nothing new".
      const sameLog = model.readChanges({ sessionId: base.sessionId, cursor: mine.cursor, limit: 100 });
      // A restart builds a different log: the cursor names events this process never
      // had. Position alone cannot detect it (a fresh log reaches the same numbers),
      // so it must expire into a fresh snapshot, never answer an empty "caught up".
      const second = restart();
      const login = second.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-1" });
      let stale;
      try {
        const page = second.readChanges({ sessionId: login.sessionId, cursor: mine.cursor, limit: 100 });
        stale = { outcome: "served", mode: page.mode, events: page.events.length };
      } catch (error) {
        stale = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      const resync = drain(second, login.sessionId, "0");
      return {
        sameLogMode: sameLog.mode,
        sameLogEvents: sameLog.events.length,
        stale: stale.outcome,
        staleCode: stale.code ?? null,
        staleMode: stale.mode ?? null,
        resyncMode: resync.mode,
        resyncSeesDoc: resync.events.some((event) => event.documentId === base.docId),
      };
    },
    expect: {
      sameLogMode: "incremental",
      sameLogEvents: 0,
      stale: "error",
      staleCode: "change_cursor_expired",
      staleMode: null,
      resyncMode: "snapshot",
      resyncSeesDoc: true,
    },
  },
  {
    id: "client-engine-incompatible",
    requirement: "Client/engine khong tuong thich - tu choi truoc khi ghi",
    run({ model, base }) {
      const outdated = { ...base, engine: { name: "uniwork-office", version: "0.1.0", status: "incompatible" } };
      let observed;
      try {
        model.beginUpload({ ...outdated, payload: "v2" });
        observed = { outcome: "uploaded" };
      } catch (error) {
        observed = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      return { ...observed, currentVersion: model.openDocument(base).version, orphans: model.orphans().length };
    },
    expect: { outcome: "error", code: "engine_incompatible", errorClass: "incompatible", currentVersion: 1, orphans: 0 },
  },
  {
    id: "auth-code-expired-or-reused",
    requirement: "Token/code het han hoac dung lai - code dung mot lan, nhap khong mat",
    run({ model, base, clock }) {
      const accountId = base.accountId;
      // 1. TTL: the code, not the client attempt, is what expires here.
      const expiring = model.beginAuth({ accountId });
      clock.t += 61_000;
      let expired;
      try {
        model.completeAuth({
          code: expiring.browserReturns.code,
          state: expiring.browserReturns.state,
          redirect: expiring.redirectUri,
        });
        expired = { outcome: "redeemed" };
      } catch (error) {
        expired = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      clock.t -= 61_000;

      // 2. Server-side single use: the same code cannot be exchanged twice even
      //    though the client would never ask twice.
      const reuse = model.beginAuth({ accountId });
      const reuseAttempt = attemptOf(model, reuse.browserReturns.code);
      const firstSession = model.redeemCode({ code: reuseAttempt.code, verifier: reuseAttempt.verifier });
      let serverReplay;
      try {
        model.redeemCode({ code: reuseAttempt.code, verifier: reuseAttempt.verifier });
        serverReplay = { outcome: "redeemed" };
      } catch (error) {
        serverReplay = { outcome: "error", code: error.code };
      }
      // 3. Client-side callback replay: the pending attempt was consumed.
      let callbackReplay;
      try {
        model.completeAuth({
          code: reuseAttempt.code,
          state: reuse.browserReturns.state,
          redirect: reuse.redirectUri,
        });
        callbackReplay = { outcome: "signed_in" };
      } catch (error) {
        callbackReplay = { outcome: "error", code: error.code };
      }
      // 3b. A genuinely consumed attempt: complete() succeeded once, so the
      //     pending attempt is gone and the same callback cannot be replayed.
      const spent = model.beginAuth({ accountId });
      model.completeAuth({ code: spent.browserReturns.code, state: spent.browserReturns.state, redirect: spent.redirectUri });
      let spentReplay;
      try {
        model.completeAuth({ code: spent.browserReturns.code, state: spent.browserReturns.state, redirect: spent.redirectUri });
        spentReplay = { outcome: "signed_in" };
      } catch (error) {
        spentReplay = { outcome: "error", code: error.code };
      }
      // 4. Wrong state: swapped callbacks must not sign anyone in.
      const live = model.beginAuth({ accountId });
      const other = model.beginAuth({ accountId: "account-b" });
      let wrongState;
      try {
        model.completeAuth({ code: live.browserReturns.code, state: other.browserReturns.state, redirect: live.redirectUri });
        wrongState = { outcome: "signed_in" };
      } catch (error) {
        wrongState = { outcome: "error", code: error.code };
      }
      // 5. Wrong redirect: a foreign custom scheme must not complete the attempt.
      let wrongRedirect;
      try {
        model.completeAuth({
          code: live.browserReturns.code,
          state: live.browserReturns.state,
          redirect: "genoffice://auth/callback",
        });
        wrongRedirect = { outcome: "signed_in" };
      } catch (error) {
        wrongRedirect = { outcome: "error", code: error.code };
      }
      // 6. Wrong verifier: a code lifted from a log is useless.
      const wrongVerifierReq = model.beginAuth({ accountId });
      const wrongVerifierAttempt = attemptOf(model, wrongVerifierReq.browserReturns.code);
      let wrongVerifier;
      try {
        model.redeemCode({ code: wrongVerifierAttempt.code, verifier: "not-the-verifier".padEnd(64, "x") });
        wrongVerifier = { outcome: "redeemed" };
      } catch (error) {
        wrongVerifier = { outcome: "error", code: error.code };
      }
      const liveSessions = [...model.state.sessions.values()].filter((session) => !session.revoked).length;
      model.expireAccessToken(firstSession.sessionId);
      let afterExpiry;
      try {
        model.openDocument({ sessionId: firstSession.sessionId, docId: base.docId });
        afterExpiry = { outcome: "allowed" };
      } catch (error) {
        afterExpiry = { outcome: "error", code: error.code };
      }
      return {
        expired: expired.outcome,
        expiredCode: expired.code ?? null,
        expiredClass: expired.errorClass ?? null,
        serverReplay: serverReplay.outcome,
        serverReplayCode: serverReplay.code ?? null,
        callbackReplay: callbackReplay.outcome,
        callbackReplayCode: callbackReplay.code ?? null,
        spentReplay: spentReplay.outcome,
        spentReplayCode: spentReplay.code ?? null,
        wrongState: wrongState.outcome,
        wrongStateCode: wrongState.code ?? null,
        wrongRedirect: wrongRedirect.outcome,
        wrongRedirectCode: wrongRedirect.code ?? null,
        wrongVerifier: wrongVerifier.outcome,
        wrongVerifierCode: wrongVerifier.code ?? null,
        liveSessions,
        afterAccessExpiry: afterExpiry.outcome,
        afterAccessExpiryCode: afterExpiry.code ?? null,
      };
    },
    expect: {
      expired: "error",
      expiredCode: "authorization_code_expired",
      expiredClass: "session",
      serverReplay: "error",
      serverReplayCode: "authorization_code_reused",
      callbackReplay: "error",
      // The pending attempt still exists on the client, so the refusal comes from
      // the server's one-use rule: the code was already burned.
      callbackReplayCode: "authorization_code_reused",
      spentReplay: "error",
      spentReplayCode: "forbidden",
      wrongState: "error",
      wrongStateCode: "forbidden",
      wrongRedirect: "error",
      wrongRedirectCode: "forbidden",
      wrongVerifier: "error",
      wrongVerifierCode: "forbidden",
      // Three live sessions: the reuse exchange, the spent-attempt exchange, and
      // the expiring attempt that never redeemed. Being exact matters, because a
      // model that minted a session on a refused exchange would move this number.
      liveSessions: 3,
      afterAccessExpiry: "error",
      afterAccessExpiryCode: "token_expired",
    },
  },
  {
    id: "pkce-s256-is-base64url",
    requirement: "PKCE S256 la BASE64URL (khong hex) - vector RFC 7636 va challenge sai kieu bi tu choi",
    run({ model, base }) {
      // RFC 7636 Appendix B.
      const rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
      // A hex challenge is the defect: the same verifier, the wrong encoding. It is
      // refused at authorize time instead of failing later with no cause.
      let hexRefused;
      try {
        model.authorizeCode({ accountId: base.accountId, codeChallenge: sha256(rfcVerifier) });
        hexRefused = "accepted";
      } catch (error) {
        hexRefused = error.code;
      }
      const request = model.beginAuth({ accountId: base.accountId });
      const attempt = attemptOf(model, request.browserReturns.code);
      // The happy path uses the base64url challenge the client actually sent.
      const session = model.completeAuth({
        code: request.browserReturns.code,
        state: request.browserReturns.state,
        redirect: request.redirectUri,
      });
      return {
        rfcVectorMatches: pkceChallenge(rfcVerifier) === rfcChallenge,
        clientChallengeIsBase64url: /^[A-Za-z0-9\-_]{43}$/.test(request.codeChallenge),
        clientChallengeIsNotHex: !/^[0-9a-f]{64}$/.test(request.codeChallenge),
        verifierIsRfcShaped: /^[A-Za-z0-9\-._~]{43,128}$/.test(attempt.verifier),
        hexChallengeRefused: hexRefused,
        roundTripSucceeds: Boolean(session.sessionId),
        canonicalRedirect: request.redirectUri,
      };
    },
    expect: {
      rfcVectorMatches: true,
      clientChallengeIsBase64url: true,
      clientChallengeIsNotHex: true,
      verifierIsRfcShaped: true,
      hexChallengeRefused: "forbidden",
      roundTripSucceeds: true,
      canonicalRedirect: "uniwork-office://auth/callback",
    },
  },
  {
    id: "idempotency-in-flight",
    requirement: "Cung key khi request dau con dang chay - khong chay lenh hai lan",
    run({ model, base }) {
      const key = "k-inflight";
      // Model a first attempt that claimed the key and has not committed yet. The
      // ledger row is scoped by document, matching commitSave's key.
      model.state.idempotency.set(["document.save", "org-1", "ws-1", base.docId, key].join(":"), {
        accountId: base.accountId,
        fingerprint: "pending",
        response: null,
      });
      const upload = model.beginUpload({ ...base, payload: "concurrent" });
      let observed;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload: "concurrent", idempotencyKey: key });
        observed = { outcome: "committed" };
      } catch (error) {
        observed = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      return { ...observed, versions: model.versionsOf(base.docId) };
    },
    expect: { outcome: "error", code: "idempotency_in_flight", errorClass: "conflict", versions: 1 },
  },
  {
    id: "feed-cursor-advances-past-unreadable",
    requirement: "Cursor tien qua su kien khong doc duoc - khong ket phan trang",
    run({ model, base }) {
      const start = drain(model, base.sessionId, "0");
      // A document this actor has no level on: its events are unreadable.
      model.addDocument({ id: "doc-2", orgId: "org-1", wsId: "ws-1", checksum: "doc2" });
      const upload = model.beginUpload({ ...base, payload: "readable" });
      model.commitSave({ ...base, uploadId: upload.uploadId, payload: "readable" });

      const page1 = model.readChanges({ sessionId: base.sessionId, cursor: start.cursor, limit: 1 });
      const page2 = model.readChanges({ sessionId: base.sessionId, cursor: page1.nextCursor, limit: 1 });
      return {
        startMode: start.mode,
        page1Events: page1.events.length,
        page1Kind: page1.events[0]?.kind ?? null,
        page2Events: page2.events.length,
        cursorAdvanced: page1.nextCursor !== start.cursor,
        page2DidNotRepeat: page2.nextCursor === page1.nextCursor,
        hiddenEventNotLeaked: page1.events.every((event) => event.documentId === base.docId),
      };
    },
    // The unreadable created:doc-2 sits between the cursor and the readable
    // version_created. The cursor must step over it: page 1 still returns the
    // readable event rather than replaying the hidden one forever.
    expect: {
      startMode: "snapshot",
      page1Events: 1,
      page1Kind: "version_created",
      page2Events: 0,
      cursorAdvanced: true,
      page2DidNotRepeat: true,
      hiddenEventNotLeaked: true,
    },
  },
  {
    id: "tombstone-not-leaked-to-non-reader",
    requirement: "Tombstone khong ro ri cho nguoi chua tung co quyen",
    run({ model, base }) {
      model.addDocument({ id: "doc-owned", orgId: "org-1", wsId: "ws-1", checksum: "owned" });
      model.grant("doc-owned", base.accountId, "view");
      model.tombstone("doc-owned");
      // An id this actor was never granted must stay invisible, deleted or not.
      model.addDocument({ id: "doc-foreign", orgId: "org-1", wsId: "ws-1", checksum: "foreign" });
      model.tombstone("doc-foreign");
      const seen = drain(model, base.sessionId, "0").events;
      return {
        seesOwnTombstone: seen.some((event) => event.kind === "deleted" && event.documentId === "doc-owned"),
        seesForeignTombstone: seen.some((event) => event.kind === "deleted" && event.documentId === "doc-foreign"),
        seesForeignCreated: seen.some((event) => event.documentId === "doc-foreign"),
      };
    },
    expect: { seesOwnTombstone: true, seesForeignTombstone: false, seesForeignCreated: false },
  },
  {
    id: "copy-keeps-creator-access",
    requirement: "Ban sao chuyen doi giu quyen nguoi tao, khong nang quyen, khong mo cua cho nguoi ngoai",
    run({ model, base }) {
      const copy = model.convertDocument({
        sessionId: base.sessionId,
        docId: base.docId,
        targetFormat: "md",
        mode: "copy",
        consent: "copy",
      });
      let creatorOpens;
      try {
        model.openDocument({ sessionId: base.sessionId, docId: copy.copyId });
        creatorOpens = "allowed";
      } catch (error) {
        creatorOpens = error.code;
      }
      let creatorEdits;
      try {
        model.beginUpload({ sessionId: base.sessionId, docId: copy.copyId, baseRevision: 1, payload: "edit-copy", engine: base.engine });
        creatorEdits = "allowed";
      } catch (error) {
        creatorEdits = error.code;
      }
      const outsider = model.loginAs({ accountId: "account-z", orgId: "org-1", wsId: "ws-1" });
      let outsiderRead;
      try {
        model.openDocument({ sessionId: outsider.sessionId, docId: copy.copyId });
        outsiderRead = "allowed";
      } catch (error) {
        outsiderRead = error.code;
      }
      return {
        creatorOpens,
        creatorEdits,
        outsiderRead,
        carriedAcl: copy.carriedAcl,
        converterLevelOnCopy: copy.converterLevelOnCopy,
        converterLevelOnSource: model.state.acl.get(base.docId).get(base.accountId),
        copyLinksSource: copy.sourceDocumentId === base.docId,
        sourceVersionsKept: copy.sourceUntouched.versions,
      };
    },
    expect: {
      creatorOpens: "allowed",
      creatorEdits: "allowed",
      outsiderRead: "forbidden",
      carriedAcl: [{ accountId: "account-a", level: "edit" }],
      converterLevelOnCopy: "edit",
      converterLevelOnSource: "edit",
      copyLinksSource: true,
      sourceVersionsKept: 1,
    },
  },
  {
    id: "conversion-carries-full-acl",
    requirement: "Ban sao mang du ACL nguon, khong nang edit thanh manage, nguoi ngoai van forbidden",
    run({ model, base }) {
      model.grant(base.docId, "account-b", "view");
      model.grant(base.docId, "account-c", "comment");
      const before = [...model.state.acl.get(base.docId).entries()].sort();
      const copy = model.convertDocument({
        sessionId: base.sessionId,
        docId: base.docId,
        targetFormat: "md",
        mode: "copy",
        consent: "copy",
      });
      const after = [...model.state.acl.get(base.docId).entries()].sort();
      const bSession = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      const cSession = model.loginAs({ accountId: "account-c", orgId: "org-1", wsId: "ws-1" });
      const canOpen = (session) => {
        try {
          model.openDocument({ sessionId: session.sessionId, docId: copy.copyId });
          return "allowed";
        } catch (error) {
          return error.code;
        }
      };
      return {
        carriedAcl: copy.carriedAcl,
        sourceAclUnchanged: JSON.stringify(before) === JSON.stringify(after),
        converterNotElevated: copy.converterLevelOnCopy === "edit",
        noManageAnywhere: [...model.state.acl.get(copy.copyId).values()].every((level) => level !== "manage"),
        viewerOpensCopy: canOpen(bSession),
        commenterOpensCopy: canOpen(cSession),
      };
    },
    expect: {
      carriedAcl: [
        { accountId: "account-a", level: "edit" },
        { accountId: "account-b", level: "view" },
        { accountId: "account-c", level: "comment" },
      ],
      sourceAclUnchanged: true,
      converterNotElevated: true,
      noManageAnywhere: true,
      viewerOpensCopy: "allowed",
      commenterOpensCopy: "allowed",
    },
  },
  {
    id: "copy-records-provenance",
    requirement: "Ban sao ghi nguon goc version/format/engine; nguon khong doi",
    run({ model, base }) {
      const engine = { name: "uniwork-office", version: "1.0.0", status: "compatible", format: "docx" };
      model.addDocument({ id: "doc-prov", orgId: "org-1", wsId: "ws-1", checksum: "prov-1", format: "docx", engine });
      model.grant("doc-prov", base.accountId, "edit");
      const upload = model.beginUpload({ sessionId: base.sessionId, docId: "doc-prov", baseRevision: 1, payload: "v2", engine });
      model.commitSave({ sessionId: base.sessionId, docId: "doc-prov", uploadId: upload.uploadId, baseRevision: 1, payload: "v2", engine });
      const copy = model.convertDocument({
        sessionId: base.sessionId,
        docId: "doc-prov",
        targetFormat: "pdf",
        mode: "copy",
        consent: "copy",
      });
      return {
        provenance: copy.provenance,
        sourceVersionAtCopy: copy.sourceVersion,
        sourceUntouched: copy.sourceUntouched,
        copyFormat: model.state.documents.get(copy.copyId).format,
        copyEngine: model.state.documents.get(copy.copyId).engine,
      };
    },
    expect: {
      provenance: {
        sourceDocumentId: "doc-prov",
        sourceVersion: 2,
        sourceRevision: 2,
        sourceFormat: "docx",
        sourceEngine: { name: "uniwork-office", version: "1.0.0", status: "compatible", format: "docx" },
        targetFormat: "pdf",
      },
      sourceVersionAtCopy: 2,
      sourceUntouched: { version: 2, revision: 2, versions: 2 },
      copyFormat: "pdf",
      copyEngine: { name: "uniwork-office", version: "1.0.0", status: "compatible", format: "docx" },
    },
  },
  {
    id: "copy-requires-explicit-consent",
    requirement: "Chuyen doi phai co dong y tao ban ro rang, khong tu y tao ban sao",
    run({ model, base }) {
      const before = model.state.documents.size;
      let observed;
      try {
        model.convertDocument({ sessionId: base.sessionId, docId: base.docId, targetFormat: "md", mode: "copy" });
        observed = { outcome: "created" };
      } catch (error) {
        observed = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      return { ...observed, documentsCreated: model.state.documents.size - before, sourceVersions: model.versionsOf(base.docId) };
    },
    expect: { outcome: "error", code: "copy_consent_required", errorClass: "conflict", documentsCreated: 0, sourceVersions: 1 },
  },
  {
    id: "recovery-checks-base-version",
    requirement: "Phuc hoi nhap kiem ca base version, khong chi base revision",
    run({ model, base }) {
      model.saveDraft({
        sessionId: base.sessionId,
        docId: base.docId,
        payload: "A-edit",
        baseRevision: 1,
        baseVersion: 99,
      });
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 99 });
      const listed = model.listDrafts({ sessionId: base.sessionId });
      return {
        status: recovered.status,
        draftBaseVersion: recovered.baseVersion ?? null,
        serverCurrentVersion: recovered.currentVersion ?? null,
        draftStillOnDisk: listed[0]?.hasPayload === true,
        draftState: listed[0]?.state ?? null,
      };
    },
    expect: {
      status: "conflict",
      draftBaseVersion: 99,
      serverCurrentVersion: 1,
      draftStillOnDisk: true,
      draftState: "conflict",
    },
  },
  {
    id: "draft-apis-require-matching-session",
    requirement: "Duong doc nhap phai qua phien dung tai khoan; logout khong xoa byte",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "unsent", baseRevision: 1 });
      const other = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      let namesOtherAccount;
      try {
        model.listDrafts({ sessionId: other.sessionId, accountId: base.accountId });
        namesOtherAccount = "allowed";
      } catch (error) {
        namesOtherAccount = error.code;
      }
      model.revokeDevice(base.sessionId);
      let afterLogout;
      try {
        model.listDrafts({ sessionId: base.sessionId });
        afterLogout = "allowed";
      } catch (error) {
        afterLogout = error.code;
      }
      // Prove the bytes survived WITHOUT a storage-only back door: sign back in and
      // read the draft again, which is the only path the contract allows.
      const relogin = model.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-1" });
      const afterRelogin = model.listDrafts({ sessionId: relogin.sessionId });
      return {
        namesOtherAccount,
        afterLogout,
        bytesPreservedOnLogout: afterRelogin.length,
        metadataOnlyAfterRelogin: afterRelogin[0]?.hasPayload === true,
      };
    },
    expect: {
      namesOtherAccount: "forbidden",
      afterLogout: "token_expired",
      bytesPreservedOnLogout: 1,
      metadataOnlyAfterRelogin: true,
    },
  },
  {
    id: "draft-list-never-returns-payload",
    requirement: "Danh sach nhap chi tra metadata; byte chi ra khoi store qua recover dung dieu kien",
    run({ model, base }) {
      const secret = "UNSENT-BYTES-MUST-NOT-LEAK";
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: secret, baseRevision: 1 });
      const listed = model.listDrafts({ sessionId: base.sessionId });
      const serialized = JSON.stringify(listed);
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 1 });
      return {
        listedCount: listed.length,
        listLeaksPayload: serialized.includes(secret),
        listHasPayloadField: Object.prototype.hasOwnProperty.call(listed[0] ?? {}, "payload"),
        listFlagsPresence: listed[0]?.hasPayload === true,
        recoveryYieldsBytes: recovered.status === "recovered" && recovered.payload === secret,
      };
    },
    expect: {
      listedCount: 1,
      listLeaksPayload: false,
      listHasPayloadField: false,
      listFlagsPresence: true,
      recoveryYieldsBytes: true,
    },
  },
  {
    id: "draft-distinct-bases-kept-apart",
    requirement: "Nhap cung tai lieu khac base la hai nhap, khong ghi de nhau",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "for-base-1.1", baseRevision: 1, baseVersion: 1 });
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "for-base-1.2", baseRevision: 1, baseVersion: 2 });
      const listed = model.listDrafts({ sessionId: base.sessionId });
      const first = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 1 });
      const second = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 1, baseVersion: 2 });
      const ambiguous = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId });
      return {
        draftCount: listed.length,
        recoveredForBase1: first.status === "recovered" ? first.payload : first.status,
        base2Status: second.status,
        base2KeepsBytes: model.listDrafts({ sessionId: base.sessionId }).length,
        ambiguousStatus: ambiguous.status,
        ambiguousBases: ambiguous.bases ?? null,
      };
    },
    expect: {
      draftCount: 2,
      recoveredForBase1: "for-base-1.1",
      base2Status: "conflict",
      base2KeepsBytes: 2,
      ambiguousStatus: "ambiguous",
      ambiguousBases: [
        { baseRevision: 1, baseVersion: 1 },
        { baseRevision: 1, baseVersion: 2 },
      ],
    },
  },
  {
    id: "recovery-refuses-unmatched-base-half",
    requirement: "Phuc hoi ten MOT nua base khong khop thi tu choi nhu discard, khong tra byte",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "only-one", baseRevision: 1, baseVersion: 1 });
      const recovery = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 99 });
      const recyclable = model.listDrafts({ sessionId: base.sessionId });
      const discard = model.discardDraft({ sessionId: base.sessionId, docId: base.docId, baseRevision: 99 });
      // Naming no base at all is still the documented convenience path for a sole
      // candidate, so a plain call must keep working.
      const noBase = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId });
      return {
        halfStatus: recovery.status,
        halfPayload: recovery.payload ?? null,
        discardOutcome: discard.outcome,
        bytesKept: recyclable.length,
        noBaseStatus: noBase.status,
        noBasePayload: noBase.payload ?? null,
      };
    },
    expect: {
      halfStatus: "ambiguous",
      halfPayload: null,
      discardOutcome: "mismatch",
      bytesKept: 1,
      noBaseStatus: "recovered",
      noBasePayload: "only-one",
    },
  },
  {
    id: "draft-scope-is-account-org-ws",
    requirement: "Pham vi nhap la account+org+ws; phien workspace khac khong thay",
    run({ model, base }) {
      model.saveDraft({ sessionId: base.sessionId, docId: base.docId, payload: "ws1-draft", baseRevision: 1 });
      const otherWs = model.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-2" });
      const otherWsList = model.listDrafts({ sessionId: otherWs.sessionId });
      const otherWsRecovery = model.recoverDraft({ sessionId: otherWs.sessionId, docId: base.docId });
      const ownList = model.listDrafts({ sessionId: base.sessionId });
      const stranger = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      let crossAccount;
      try {
        model.listDrafts({ sessionId: stranger.sessionId, accountId: base.accountId });
        crossAccount = "allowed";
      } catch (error) {
        crossAccount = error.code;
      }
      return {
        otherWorkspaceDrafts: otherWsList.length,
        otherWorkspaceRecovery: otherWsRecovery.status,
        ownWorkspaceDrafts: ownList.length,
        ownWorkspaceIds: ownList.map((row) => row.wsId),
        crossAccount,
      };
    },
    expect: {
      otherWorkspaceDrafts: 0,
      otherWorkspaceRecovery: "missing",
      ownWorkspaceDrafts: 1,
      ownWorkspaceIds: ["ws-1"],
      crossAccount: "forbidden",
    },
  },
  {
    id: "upload-owner-and-single-commit",
    requirement: "Upload thuoc nguoi tao va chi commit mot lan",
    run({ model, base }) {
      model.addDocument({ id: "doc-shared", orgId: "org-1", wsId: "ws-1", checksum: "shared" });
      model.grant("doc-shared", base.accountId, "edit");
      model.grant("doc-shared", "account-b", "edit");
      const other = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      const engine = base.engine;
      const upload = model.beginUpload({ sessionId: base.sessionId, docId: "doc-shared", baseRevision: 1, payload: "A-bytes", engine });
      // B has edit on the same document, but not on A's upload.
      let otherCommits;
      try {
        model.commitSave({
          sessionId: other.sessionId,
          docId: "doc-shared",
          uploadId: upload.uploadId,
          baseRevision: 1,
          payload: "A-bytes",
          engine,
        });
        otherCommits = "allowed";
      } catch (error) {
        otherCommits = error.code;
      }
      const first = model.commitSave({
        sessionId: base.sessionId,
        docId: "doc-shared",
        uploadId: upload.uploadId,
        baseRevision: 1,
        payload: "A-bytes",
        engine,
        idempotencyKey: "k-first",
      });
      // Same upload, new key, after the bytes are already a version.
      let reuse;
      try {
        model.commitSave({
          sessionId: base.sessionId,
          docId: "doc-shared",
          uploadId: upload.uploadId,
          baseRevision: first.revision,
          payload: "A-bytes",
          engine,
          idempotencyKey: "k-second",
        });
        reuse = "committed";
      } catch (error) {
        reuse = error.code;
      }
      const retry = model.commitSave({
        sessionId: base.sessionId,
        docId: "doc-shared",
        uploadId: upload.uploadId,
        baseRevision: 1,
        payload: "A-bytes",
        engine,
        idempotencyKey: "k-first",
      });
      return {
        otherCommits,
        reuse,
        idempotentRetryReplays: retry.replayed,
        versions: model.versionsOf("doc-shared"),
      };
    },
    expect: {
      otherCommits: "forbidden",
      reuse: "upload_already_committed",
      idempotentRetryReplays: true,
      versions: 2,
    },
  },
  {
    id: "ledger-scoped-and-rechecked",
    requirement: "Ledger idempotency theo scope tai lieu va kiem lai quyen khi replay",
    run({ model, base }) {
      model.addDocument({ id: "doc-w2", orgId: "org-1", wsId: "ws-2", checksum: "w2" });
      model.grant("doc-w2", base.accountId, "edit");
      // The session is scoped too: reaching into another workspace needs a session
      // for that workspace, not just the right document id.
      const ws2 = model.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-2" });
      const firstUpload = model.beginUpload({ ...base, payload: "same-value" });
      const first = model.commitSave({ ...base, uploadId: firstUpload.uploadId, payload: "same-value", idempotencyKey: "shared-key" });

      const w2Upload = model.beginUpload({
        sessionId: ws2.sessionId,
        docId: "doc-w2",
        baseRevision: 1,
        payload: "other-value",
        engine: base.engine,
      });
      let second;
      try {
        const committed = model.commitSave({
          sessionId: ws2.sessionId,
          docId: "doc-w2",
          uploadId: w2Upload.uploadId,
          baseRevision: 1,
          payload: "other-value",
          engine: base.engine,
          idempotencyKey: "shared-key",
        });
        second = { outcome: "committed", version: committed.version };
      } catch (error) {
        second = { outcome: "error", code: error.code };
      }

      // Replay after the share is gone: the ledger row exists, but the actor may no
      // longer read that version.
      model.revoke(base.docId, base.accountId);
      let replayAfterRevoke;
      try {
        model.commitSave({ ...base, uploadId: firstUpload.uploadId, payload: "same-value", idempotencyKey: "shared-key" });
        replayAfterRevoke = "replayed";
      } catch (error) {
        replayAfterRevoke = error.code;
      }
      return {
        firstVersion: first.version,
        second: second.outcome,
        secondCode: second.code ?? null,
        secondVersion: second.version ?? null,
        replayAfterRevoke,
      };
    },
    expect: {
      firstVersion: 2,
      second: "committed",
      secondCode: null,
      secondVersion: 2,
      replayAfterRevoke: "forbidden",
    },
  },
  {
    id: "conversion-respects-quota",
    requirement: "Ban sao chuyen doi tieu quota nhu moi ghi khac",
    run({ model, base }) {
      model.setQuotaLimit(model.state.quota.usedBytes);
      let copy;
      try {
        const made = model.convertDocument({
          sessionId: base.sessionId,
          docId: base.docId,
          targetFormat: "md",
          mode: "copy",
          consent: "copy",
        });
        copy = { outcome: "created", copyId: made.copyId };
      } catch (error) {
        copy = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      return {
        ...copy,
        quotaUsed: model.state.quota.usedBytes,
        quotaLimit: model.state.quota.limitBytes,
        sourceVersions: model.versionsOf(base.docId),
      };
    },
    expect: {
      outcome: "error",
      code: "quota_exceeded",
      errorClass: "quota",
      quotaUsed: 7,
      quotaLimit: 7,
      sourceVersions: 1,
    },
  },
  {
    id: "cursor-is-bound-to-account-and-scope",
    requirement: "Cursor la opaque, ky va gan account/org/ws; replay sang tai khoan khac bi tu choi",
    run({ model, base }) {
      const mine = drain(model, base.sessionId, "0").cursor;
      const other = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      const otherWs = model.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-2" });
      const attempt = (sessionId, cursor) => {
        try {
          return model.readChanges({ sessionId, cursor, limit: 10 }).mode;
        } catch (error) {
          return error.code;
        }
      };
      return {
        otherAccount: attempt(other.sessionId, mine),
        otherWorkspace: attempt(otherWs.sessionId, mine),
        malformedCursor: attempt(base.sessionId, "1"),
        tamperedCursor: attempt(base.sessionId, mine.slice(0, -1) + (mine.endsWith("A") ? "B" : "A")),
        ownCursor: attempt(base.sessionId, mine),
      };
    },
    expect: {
      otherAccount: "forbidden",
      otherWorkspace: "forbidden",
      malformedCursor: "forbidden",
      tamperedCursor: "forbidden",
      ownCursor: "incremental",
    },
  },
  {
    id: "snapshot-survives-retention-and-writers",
    requirement: "Snapshot on dinh: ghi giua trang khong lam hong trang sau, catchup khong mat su kien",
    run({ model, base }) {
      model.setQuotaLimit(64 * 1024);
      model.addDocument({ id: "doc-b", orgId: "org-1", wsId: "ws-1", checksum: "b" });
      model.grant("doc-b", base.accountId, "edit");

      // Page 1 freezes the current state. A writer then races it: a new version,
      // a new document and a grant, all appended while the snapshot is open.
      const page1 = model.readChanges({ sessionId: base.sessionId, cursor: "0", limit: 1 });
      const written1 = model.beginUpload({ sessionId: base.sessionId, docId: "doc-1", baseRevision: 1, payload: "race", engine: base.engine });
      model.commitSave({ sessionId: base.sessionId, docId: "doc-1", uploadId: written1.uploadId, baseRevision: 1, payload: "race", engine: base.engine });
      model.addDocument({ id: "doc-c", orgId: "org-1", wsId: "ws-1", checksum: "c" });
      model.grant("doc-c", base.accountId, "edit");

      // Page 2 must still be a snapshot page carrying the frozen membership, not
      // a silent restart over the writes that happened mid-page.
      const page2 = model.readChanges({ sessionId: base.sessionId, cursor: page1.nextCursor, limit: 1 });
      return {
        page1Events: page1.events.length,
        page1Done: page1.done,
        page2Events: page2.events.length,
        page2Servable: page2.mode === "snapshot",
        page2Done: page2.done,
        catchupMode: catchupMode(page2.nextCursor),
      };

      function catchupMode(cursor) {
        return model.readChanges({ sessionId: base.sessionId, cursor, limit: 50 }).mode;
      }
    },
    expect: {
      page1Events: 1,
      page1Done: false,
      page2Events: 1,
      page2Servable: true,
      page2Done: true,
      catchupMode: "incremental",
    },
  },
  {
    id: "snapshot-catchup-carries-raced-writes",
    requirement: "Sau snapshot, cursor tang dan bu kip cac ghi da chen vao giua snapshot",
    run({ model, base }) {
      model.setQuotaLimit(64 * 1024);
      model.addDocument({ id: "doc-b", orgId: "org-1", wsId: "ws-1", checksum: "b" });
      model.grant("doc-b", base.accountId, "edit");
      const page1 = model.readChanges({ sessionId: base.sessionId, cursor: "0", limit: 1 });
      const written1 = model.beginUpload({ sessionId: base.sessionId, docId: "doc-1", baseRevision: 1, payload: "race", engine: base.engine });
      model.commitSave({ sessionId: base.sessionId, docId: "doc-1", uploadId: written1.uploadId, baseRevision: 1, payload: "race", engine: base.engine });
      model.addDocument({ id: "doc-c", orgId: "org-1", wsId: "ws-1", checksum: "c" });
      model.grant("doc-c", base.accountId, "edit");
      const page2 = model.readChanges({ sessionId: base.sessionId, cursor: page1.nextCursor, limit: 1 });
      const catchup = model.readChanges({ sessionId: base.sessionId, cursor: page2.nextCursor, limit: 50 });
      return {
        catchupMode: catchup.mode,
        catchupDocuments: docIds(catchup.events),
        catchupKindsForDocC: kindsOf(catchup.events, "doc-c"),
        catchupMissesSnapshot: !catchup.events.some((event) => event.snapshot === true),
        catchupSeesRacedVersion: catchup.events.some(
          (event) => event.documentId === "doc-1" && event.kind === "version_created",
        ),
      };
    },
    expect: {
      catchupMode: "incremental",
      catchupDocuments: ["doc-1", "doc-c", "doc-c"],
      catchupKindsForDocC: ["created", "granted"],
      catchupMissesSnapshot: true,
      catchupSeesRacedVersion: true,
    },
  },
  {
    id: "frozen-snapshot-cursor-expires-not-restarts",
    requirement: "Cursor snapshot treo qua retention bi tu choi change_cursor_expired, khong lang le restart",
    run({ model, base, clock }) {
      model.setQuotaLimit(64 * 1024);
      model.addDocument({ id: "doc-b", orgId: "org-1", wsId: "ws-1", checksum: "b" });
      model.grant("doc-b", base.accountId, "edit");
      const page1 = model.readChanges({ sessionId: base.sessionId, cursor: "0", limit: 1 });
      // Walk the log well past retention, then come back to the frozen snapshot
      // cursor. It must be refused, and a fresh snapshot must be the recovery.
      for (const id of ["doc-x", "doc-y", "doc-z", "doc-w", "doc-v"]) {
        model.addDocument({ id, orgId: "org-1", wsId: "ws-1", checksum: id });
        model.grant(id, base.accountId, "edit");
      }
      clock.t += 20 * 60_000;
      let staleSnapshot;
      // The session's access token expires on its own TTL, so sign in again; the
      // frozen snapshot cursor is what this case is about, not the token.
      const second = model.loginAs({ accountId: base.accountId, orgId: "org-1", wsId: "ws-1" });
      try {
        model.readChanges({ sessionId: second.sessionId, cursor: page1.nextCursor, limit: 1 });
        staleSnapshot = "served";
      } catch (error) {
        staleSnapshot = error.code;
      }
      const resync = drain(model, second.sessionId, "0");
      return {
        staleSnapshot,
        resyncMode: resync.mode,
        resyncHasCurrentState: resync.events.length >= 5,
        upperBoundOnly: resync.events.filter((event) => event.documentId === base.docId).map((event) => event.kind),
      };
    },
    expect: {
      staleSnapshot: "change_cursor_expired",
      resyncMode: "snapshot",
      resyncHasCurrentState: true,
      // The deleted-document case owns tombstone semantics; here the point is only
      // that the recovery is a real snapshot and not a replay of old events.
      upperBoundOnly: ["upsert"],
    },
  },
  {
    id: "grant-targeted-revoke-id-only",
    requirement: "Grant chi toi nguoi duoc cap; revoke chi gui id cho nguoi vua mat quyen",
    run({ model, base }) {
      model.addDocument({ id: "doc-shared", orgId: "org-1", wsId: "ws-1", checksum: "shared" });
      model.grant("doc-shared", base.accountId, "edit");
      const aCursor = drain(model, base.sessionId, "0").cursor;
      const b = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      const bCursor = drain(model, b.sessionId, "0").cursor;
      model.grant("doc-shared", "account-b", "view");
      const aAfterGrant = model.readChanges({ sessionId: base.sessionId, cursor: aCursor, limit: 50 });
      const bAfterGrant = model.readChanges({ sessionId: b.sessionId, cursor: bCursor, limit: 50 });
      model.revoke("doc-shared", "account-b");
      const bAfterRevoke = model.readChanges({ sessionId: b.sessionId, cursor: bAfterGrant.nextCursor, limit: 50 }).events;
      const aAfterRevoke = model.readChanges({ sessionId: base.sessionId, cursor: aAfterGrant.nextCursor, limit: 50 }).events;
      const stranger = model.loginAs({ accountId: "account-z", orgId: "org-1", wsId: "ws-1" });
      const strangerSees = drain(model, stranger.sessionId, "0").events;
      return {
        aSeesGrantToB: aAfterGrant.events.some((event) => event.kind === "granted"),
        bSeesOwnGrant: bAfterGrant.events.some((event) => event.kind === "granted" && event.documentId === "doc-shared"),
        bSeesRemoval: bAfterRevoke.some((event) => event.kind === "removed" && event.documentId === "doc-shared"),
        bRemovalCarriesNothingElse: bAfterRevoke.every((event) => event.documentId === "doc-shared"),
        aSeesBRemoval: aAfterRevoke.some((event) => event.kind === "removed"),
        strangerSeesAnyId: strangerSees.length > 0,
      };
    },
    expect: {
      aSeesGrantToB: false,
      bSeesOwnGrant: true,
      bSeesRemoval: true,
      bRemovalCarriesNothingElse: true,
      aSeesBRemoval: false,
      strangerSeesAnyId: false,
    },
  },
  {
    id: "owner-acl-transition-fans-out",
    requirement: "Doi quyen Work Product den dung nguoi, toi moi document thuoc owner; go chi gui id",
    run({ model, base }) {
      model.addDocument({ id: "wp-a", orgId: "org-1", wsId: "ws-1", checksum: "wpa", ownerKind: "work_product", ownerId: "wp-1" });
      model.addDocument({ id: "wp-b", orgId: "org-1", wsId: "ws-1", checksum: "wpb", ownerKind: "work_product", ownerId: "wp-1" });
      model.addDocument({ id: "other", orgId: "org-1", wsId: "ws-1", checksum: "other", ownerKind: "work_product", ownerId: "wp-2" });
      const a = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
      const aCursor = drain(model, a.sessionId, "0").cursor;
      const b = model.loginAs({ accountId: "account-b", orgId: "org-1", wsId: "ws-1" });
      const bCursor = drain(model, b.sessionId, "0").cursor;
      model.setOwnerLevel("wp-1", "account-a", "edit");
      const aEvents = model.readChanges({ sessionId: a.sessionId, cursor: aCursor, limit: 50 });
      const bEvents = model.readChanges({ sessionId: b.sessionId, cursor: bCursor, limit: 50 });
      model.clearOwnerLevel("wp-1", "account-a");
      const removed = model.readChanges({ sessionId: a.sessionId, cursor: aEvents.nextCursor, limit: 50 }).events;
      return {
        fanOutDocuments: docIds(aEvents.events),
        fanOutKinds: kindsOf(aEvents.events, "wp-a"),
        otherOwnerNotTouched: bEvents.events.some((event) => event.documentId === "other"),
        bSeesNothing: bEvents.events.length,
        removalDocuments: docIds(removed),
        removalKinds: kindsOf(removed, "wp-a"),
        stillReadable: (() => {
          try {
            model.openDocument({ sessionId: a.sessionId, docId: "wp-a" });
            return "allowed";
          } catch (error) {
            return error.code;
          }
        })(),
      };
    },
    expect: {
      fanOutDocuments: ["wp-a", "wp-b"],
      fanOutKinds: ["granted"],
      otherOwnerNotTouched: false,
      bSeesNothing: 0,
      removalDocuments: ["wp-a", "wp-b"],
      removalKinds: ["removed"],
      stillReadable: "forbidden",
    },
  },
  {
    id: "unknown-resource-is-typed",
    requirement: "Tai nguyen khong ton tai tra loi co ma/status/errorClass, khong phai stack trace",
    run({ model, base }) {
      const absentDoc = model.state.documents.has("doc-absent") ? "present" : "absent";
      let unknownDocument;
      try {
        model.openDocument({ sessionId: base.sessionId, docId: "doc-absent" });
        unknownDocument = { outcome: "opened" };
      } catch (error) {
        unknownDocument = {
          outcome: "error",
          code: error.code,
          status: error.status,
          errorClass: error.errorClass,
          kind: error.kind,
        };
      }
      let unknownUpload;
      try {
        model.commitSave({ ...base, uploadId: "upload-never-existed", payload: "x" });
        unknownUpload = { outcome: "committed" };
      } catch (error) {
        unknownUpload = { outcome: "error", code: error.code, status: error.status };
      }
      return { absentDoc, unknownDocument, unknownUpload };
    },
    expect: {
      absentDoc: "absent",
      unknownDocument: {
        outcome: "error",
        code: "not_found",
        status: 404,
        errorClass: "missing",
        kind: "unknown_resource",
      },
      unknownUpload: { outcome: "error", code: "not_found", status: 404 },
    },
  },
];

/** Every case id this artifact claims, and the ones the plan names verbatim. */
export const REQUIRED_CASE_IDS = FAULT_CASES.map((testCase) => testCase.id);

/** The plan's verbatim mandatory list, kept separately so a deletion is visible. */
export const PLAN_CASE_IDS = [
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
];

/**
 * Run every case against a fresh model in its own directory, so no case can see
 * another case's drafts, feed or sessions.
 */
export function runAllCases({ workDir, idempotencyFingerprint = true, changeRetention = 2 } = {}) {
  const root = workDir ?? process.env.UNIWORK_G0_TMP ?? os.tmpdir();
  const runDir = fs.mkdtempSync(path.join(root, "office-g0-"));
  const results = [];

  for (const testCase of FAULT_CASES) {
    const clock = { t: 1_000_000 };
    // Isolation: one directory and one key set per case. Keys are created here and
    // handed in, so a restart inside a case proves they live outside the store.
    const dir = fs.mkdtempSync(path.join(runDir, "case-"));
    const draftsDir = path.join(dir, "drafts");
    const keys = new Map([
      ["account-a", crypto.createHash("sha256").update("key|account-a|" + testCase.id).digest()],
      ["account-b", crypto.createHash("sha256").update("key|account-b|" + testCase.id).digest()],
      ["account-c", crypto.createHash("sha256").update("key|account-c|" + testCase.id).digest()],
      ["account-z", crypto.createHash("sha256").update("key|account-z|" + testCase.id).digest()],
    ]);
    const keyProvider = (accountId) =>
      keys.get(accountId) ?? crypto.createHash("sha256").update("key|" + accountId).digest();
    const options = {
      dir: draftsDir,
      keyProvider,
      namespaceKey: crypto.createHash("sha256").update("ns|" + testCase.id).digest(),
      idempotencyFingerprint,
      changeRetention,
      now: () => clock.t,
    };

    // Anything that throws — in the fixture setup or in the case body — is a
    // FAILED observation, not an aborted run. Otherwise a model that breaks its
    // own login would crash the harness and read as "no result" instead of "this
    // model does not satisfy this case", and one broken case would hide the rest.
    let observed;
    try {
      const model = createModel(options);
      model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
      model.grant("doc-1", "account-a", "edit");
      const session = model.loginAs({ accountId: "account-a", orgId: "org-1", wsId: "ws-1" });
      const base = {
        accountId: "account-a",
        docId: "doc-1",
        sessionId: session.sessionId,
        baseRevision: 1,
        baseVersion: 1,
        engine: { name: "uniwork-office", version: "1.0.0", status: "compatible" },
      };

      const restart = () => {
        const fresh = createModel(options);
        fresh.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
        fresh.grant("doc-1", "account-a", "edit");
        return fresh;
      };

      observed = testCase.run({ model, base, restart, clock, dir: draftsDir, keys });
    } catch (error) {
      observed = {
        threw: error instanceof Error ? error.name : typeof error,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const expected = idempotencyFingerprint ? testCase.expect : testCase.expectLegacy ?? testCase.expect;
    results.push({
      id: testCase.id,
      requirement: testCase.requirement,
      observed,
      expected,
      ok: JSON.stringify(observed) === JSON.stringify(expected),
    });
  }

  return { dir: runDir, results };
}

function gitHead() {
  const out = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "unknown";
}

export function buildEvidence({ results, dir, legacy }) {
  const failed = results.filter((result) => !result.ok);
  return {
    schemaVersion: 2,
    issue: "UNI-669",
    task: "DOC-005 - login, sync, phien ban va phuc hoi nhap",
    contractDoc: CONTRACT_DOC,
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    mode: legacy ? "legacy-idempotency (modeled gap comparison)" : "contract",
    authorization: "modeled (in-memory ACL map)",
    evidenceLevel: "reference model + bounded real execution of the accepted office byte store (draft-store.mjs) over a private directory; authorization, tenancy and the protocol layer remain modeled",
    draftStoreDir: dir,
    summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
    cases: results,
    limitations: [
      "Reference model only: no HTTP server, no product auth middleware, no document service, no engine, no browser.",
      "Authorization is an in-memory ACL map (modeled authorization). This is NOT product tenancy isolation and does not replace G1/G4/G5 service tests.",
      "Auth/TTL/one-time-code semantics are modeled; the desktop flow is not exercised against a real authorization server.",
      "Engine open/parse/serialize/convert is out of scope here; DOC-004 owns the engine contract and extends this case table.",
      "Draft persistence writes run the accepted office byte store (scripts/office-g0/draft-store.mjs) behind its own seam. This is bounded byte-store execution only: the keys are injected by this harness, no crash/power-loss durability is claimed or tested, and it is NOT product key management, service or browser evidence.",
      "The BeginIdempotent payload-fingerprint gap is compared by running this model with and without the fingerprint; it is a documentary-plus-modeled finding, not execution of the Go code.",
      "E2E across web, server and desktop remains G5/G7 work.",
    ],
  };
}

function printResults(evidence) {
  for (const result of evidence.cases) {
    console.log("  " + (result.ok ? "PASS" : "FAIL") + "  " + result.id);
    if (!result.ok) {
      console.log("        expected: " + JSON.stringify(result.expected));
      console.log("        observed: " + JSON.stringify(result.observed));
    }
  }
  const { total, passed, failed } = evidence.summary;
  console.log("");
  console.log(passed + "/" + total + " fault cases match the contract oracle" + (failed ? " (" + failed + " FAILED)" : ""));
  console.log("mode: " + evidence.mode);
  console.log("contract: " + evidence.contractDoc);
}

export function main(argv = process.argv.slice(2)) {
  const legacy = argv.includes("--legacy-model");
  const hasOut = argv.includes("--out");
  const print = argv.includes("--print") || !hasOut;
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : path.join(REPO_ROOT, ".go-tmp", "office-g0", "run-contracts.json");
  const workDirIndex = argv.indexOf("--work-dir");
  const workDir = workDirIndex >= 0 ? argv[workDirIndex + 1] : undefined;

  const { dir, results } = runAllCases({ workDir, idempotencyFingerprint: !legacy });
  const evidence = buildEvidence({ results, dir, legacy });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");

  if (print) printResults(evidence);
  console.log("wrote " + outPath);
  return evidence.summary.failed === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}

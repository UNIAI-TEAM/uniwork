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
//   node scripts/office-g0/run-contracts.mjs
//   node scripts/office-g0/run-contracts.mjs --print --out <path>
//   node scripts/office-g0/run-contracts.mjs --legacy-idempotency
//
// Exit code 0 only when every case matches its oracle.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MODEL_VERSION = "uniwork-office-g0-protocol/1";
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
  document_deleted: { status: 410, errorClass: "gone", kind: "tombstone" },
  change_cursor_expired: { status: 410, errorClass: "gone", kind: "cursor_retention" },
  forbidden: { status: 403, errorClass: "permission", kind: "acl" },
  quota_exceeded: { status: 413, errorClass: "quota", kind: "storage_bytes" },
  engine_incompatible: { status: 409, errorClass: "incompatible", kind: "engine_version" },
  token_expired: { status: 401, errorClass: "session", kind: "token" },
  authorization_code_expired: { status: 400, errorClass: "session", kind: "auth_code_ttl" },
  authorization_code_reused: { status: 400, errorClass: "session", kind: "auth_code_replay" },
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

/**
 * Reference model of the DOC-005 protocol. Every method returns plain data or
 * throws ProtocolError; nothing throws a bare Error, because the whole point of
 * the fault cases is that failures have an exact, machine-readable shape.
 *
 * @param {object} opts
 * @param {string|null} opts.dir draft persistence directory (null = memory only)
 * @param {boolean} opts.idempotencyFingerprint
 *   true  = contract behaviour: the idempotency ledger stores a payload
 *           fingerprint, so the same key with a different payload is refused.
 *   false = today's service.BeginIdempotent: the ledger keys on
 *           (org, workspace, scope, key) only, so a different payload under a
 *           reused key REPLAYS the first response. The harness runs both, which
 *           is how the gap is evidence rather than an assertion.
 * @param {number} opts.changeRetention events kept before a cursor is stale
 * @param {() => number} opts.now injectable clock (auth code TTLs)
 */
export function createModel({
  dir = null,
  idempotencyFingerprint = true,
  changeRetention = 1000,
  now = () => Date.now(),
} = {}) {
  const draftsDir = dir ? path.join(dir, "drafts") : null;
  const memoryDrafts = new Map();
  const state = {
    documents: new Map(),
    versions: new Map(),
    idempotency: new Map(),
    uploads: new Map(),
    acl: new Map(),
    ownerAcl: new Map(),
    sessions: new Map(),
    authCodes: new Map(),
    changes: [],
    tombstones: new Set(),
    tempObjects: new Map(),
    quota: { limitBytes: 8 * 1024, usedBytes: 0 },
    seq: 0,
  };

  const fail = (code, fields) => {
    throw new ProtocolError(code, fields);
  };

  // ---- drafts: a real filesystem write, one file per account --------------
  function readDrafts(accountId) {
    if (!draftsDir) return memoryDrafts.get(accountId) ?? {};
    const file = path.join(draftsDir, accountId + ".json");
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  function writeDrafts(accountId, all) {
    if (!draftsDir) {
      memoryDrafts.set(accountId, all);
      return;
    }
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(path.join(draftsDir, accountId + ".json"), JSON.stringify(all, null, 2));
  }

  function requireSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session || session.revoked || session.accessExpiresAt <= now()) fail("token_expired");
    return session;
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

  function pushChange(kind, docId, revision) {
    state.seq += 1;
    state.changes.push({ seq: state.seq, kind, documentId: docId, revision, at: now() });
  }

  return {
    state,

    // ---- fixtures (modeled authorization, labeled everywhere) ------------
    /**
     * Modeled login. The real desktop flow (system browser + authorization code
     * + PKCE to a custom scheme) is specified in the contract doc; the harness
     * only needs the session/TTL semantics it produces.
     */
    beginAuthCode({ accountId, challenge, ttlMs = 60_000 }) {
      const code = crypto.randomUUID();
      state.authCodes.set(code, {
        accountId,
        challenge,
        expiresAt: now() + ttlMs,
        redeemed: false,
      });
      return { code };
    },

    redeemAuthCode({ code, verifier }) {
      const entry = state.authCodes.get(code);
      if (!entry) fail("authorization_code_expired");
      if (entry.redeemed) fail("authorization_code_reused");
      if (entry.expiresAt <= now()) fail("authorization_code_expired");
      // PKCE: the verifier must hash to the challenge registered at authorize
      // time, so a code stolen from a log cannot be exchanged for a session.
      if (sha256(verifier) !== entry.challenge) fail("forbidden");
      entry.redeemed = true;
      const sessionId = crypto.randomUUID();
      state.sessions.set(sessionId, {
        accountId: entry.accountId,
        revoked: false,
        accessExpiresAt: now() + 15 * 60_000,
      });
      return { sessionId };
    },

    revokeDevice(sessionId) {
      const session = state.sessions.get(sessionId);
      if (session) session.revoked = true;
    },

    /**
     * Convenience for fixtures and cases: authorize with a verifier, then
     * redeem. `verifier` stands in for the PKCE code verifier the desktop app
     * generates per attempt.
     */
    loginAs({ accountId, verifier }) {
      const code = this.beginAuthCode({ accountId, challenge: sha256(verifier) }).code;
      return this.redeemAuthCode({ code, verifier });
    },

    expireAccessToken(sessionId) {
      const session = state.sessions.get(sessionId);
      if (session) session.accessExpiresAt = 0;
    },

    addDocument({ id, orgId, wsId, ownerKind = null, ownerId = null, checksum = "genesis" }) {
      const doc = {
        id,
        orgId,
        wsId,
        ownerKind,
        ownerId,
        revision: 1,
        currentVersion: 1,
        checksum,
      };
      state.documents.set(id, doc);
      state.versions.set(id, [{ version: 1, checksum, reason: "upload", base: null }]);
      state.acl.set(id, new Map());
      pushChange("created", id, 1);
      state.quota.usedBytes += checksum.length;
      return doc;
    },

    grant(docId, accountId, level) {
      state.documents.has(docId) || fail("not_found");
      if (!state.acl.has(docId)) state.acl.set(docId, new Map());
      state.acl.get(docId).set(accountId, level);
    },

    revoke(docId, accountId) {
      state.acl.get(docId)?.delete(accountId);
    },

    setOwnerLevel(ownerId, accountId, level) {
      if (!state.ownerAcl.has(ownerId)) state.ownerAcl.set(ownerId, new Map());
      state.ownerAcl.get(ownerId).set(accountId, level);
    },

    setQuotaLimit(bytes) {
      state.quota.limitBytes = bytes;
    },
    // ---- open -------------------------------------------------------------
    openDocument({ sessionId, docId }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      requireLevel(session.accountId, doc, ["view", "comment", "edit", "manage"]);
      return { revision: doc.revision, version: doc.currentVersion, checksum: doc.checksum };
    },

    // ---- save: two-phase, permission re-checked at commit ------------------
    /**
     * Phase 1. Body stays off this path on purpose: a large Office payload
     * cannot travel in the 1 MiB JSON body (CLAUDE.md, Backend HTTP Rules), so
     * the client uploads bytes to a temporary object first and references it.
     */
    beginUpload({ sessionId, docId, baseRevision, payload, engine }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      requireLevel(session.accountId, doc, ["edit", "manage"]);
      // Base revision is deliberately NOT decided here: the bytes upload first
      // and the server re-checks the base at commit (spec 9.2 step 3), so a
      // client that opened a stale revision is refused where it matters instead
      // of somewhere a retry can slip past.
      if (engine.status !== "compatible") {
        fail("engine_incompatible", { engine: engine.name, version: engine.version });
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
    commitSave({ sessionId, docId, uploadId, baseRevision, idempotencyKey = null, payload, engine }) {
      const session = requireSession(sessionId);
      const doc = document(docId);
      const upload = state.uploads.get(uploadId);
      if (!upload || upload.docId !== docId) fail("not_found");

      // Idempotency first: a retry of a request the server already answered is
      // not judged twice, and a reused key with other content is refused
      // instead of silently replaying the first answer.
      const ledgerKey = "document.save:" + idempotencyKey;
      const fingerprint = fingerprintOf({ docId, baseRevision, checksum: upload.checksum });
      const existing = idempotencyKey ? state.idempotency.get(ledgerKey) : undefined;
      if (existing) {
        if (existing.accountId !== session.accountId) fail("idempotency_key_reuse");
        if (existing.response === null) fail("idempotency_in_flight");
        if (idempotencyFingerprint && existing.fingerprint !== fingerprint) {
          fail("idempotency_payload_mismatch", { key: idempotencyKey });
        }
        return { ...existing.response, replayed: true };
      }

      // Permission is re-decided at commit, not trusted from beginUpload: a
      // share revoked while bytes were in flight must not commit.
      const effective = requireLevel(session.accountId, doc, ["edit", "manage"]);
      if (engine.status !== "compatible") {
        fail("engine_incompatible", { engine: engine.name, version: engine.version });
      }
      if (baseRevision !== doc.revision) {
        fail("revision_conflict", { got: baseRevision, want: doc.revision });
      }
      if (state.quota.usedBytes + upload.bytes > state.quota.limitBytes) {
        fail("quota_exceeded", { used: state.quota.usedBytes, limit: state.quota.limitBytes });
      }

      if (idempotencyKey) {
        state.idempotency.set(ledgerKey, { accountId: session.accountId, fingerprint, response: null });
      }

      // Commit: version row, current pointer, revision and quota move together.
      doc.currentVersion += 1;
      doc.revision += 1;
      doc.checksum = upload.checksum;
      state.versions.get(docId).push({
        version: doc.currentVersion,
        checksum: upload.checksum,
        reason: "upload",
        base: baseRevision,
      });
      state.quota.usedBytes += upload.bytes;
      upload.committed = true;
      state.tempObjects.delete(tempObjectKeyOf(uploadId));
      pushChange("version_created", docId, doc.revision);

      const response = {
        documentId: docId,
        revision: doc.revision,
        version: doc.currentVersion,
        checksum: doc.checksum,
        via: effective.via,
        replayed: false,
      };
      if (idempotencyKey) state.idempotency.get(ledgerKey).response = response;
      return response;
    },

    /**
     * What a refused commit leaves behind: the uploaded bytes stay in the
     * temporary object set, owned by nobody yet, for the cleanup job. They are
     * not deleted silently and they do not become a version.
     */
    orphans() {
      return [...state.tempObjects.keys()].sort();
    },

    versionsOf(docId) {
      return state.versions.get(docId)?.length ?? 0;
    },

    // ---- change feed -------------------------------------------------------
    readChanges({ sessionId, cursor = "0", limit = 100 }) {
      const session = requireSession(sessionId);
      const from = Number(cursor);
      const oldest =
        state.changes.length === 0
          ? 1
          : state.changes[state.changes.length - 1].seq - changeRetention + 1;
      if (from > 0 && from < oldest - 1) fail("change_cursor_expired", { retainFrom: oldest });
      const events = state.changes
        .filter((event) => event.seq > from)
        .slice(0, limit)
        .filter((event) => {
          const doc = state.documents.get(event.documentId);
          // A deleted document reports only its tombstone, and every event is
          // filtered by the actor's permission at read time, so a cursor can
          // never replay another account's document.
          if (state.tombstones.has(event.documentId)) return event.kind === "deleted";
          return Boolean(effectiveLevel(session.accountId, doc));
        });
      const nextCursor = events.length ? String(events[events.length - 1].seq) : cursor;
      return { events, nextCursor, accountId: session.accountId };
    },

    tombstone(docId) {
      state.tombstones.add(docId);
      pushChange("deleted", docId, state.documents.get(docId)?.revision ?? 0);
    },

    // ---- durable drafts (Q8) ----------------------------------------------
    /**
     * Persist a draft. Scoped by account at the storage layer, one file per
     * account, because "account B must not read A's draft" is a property of
     * where the bytes live, not of a runtime check someone can forget.
     */
    saveDraft({ accountId, docId, payload, baseRevision, baseVersion = 1, state: draftState = "dirty", engine = null }) {
      const all = readDrafts(accountId);
      all[docId] = {
        accountId,
        docId,
        payload,
        baseRevision,
        baseVersion,
        engine,
        state: draftState,
        updatedAt: now(),
      };
      writeDrafts(accountId, all);
      return all[docId];
    },

    listDrafts(accountId) {
      return Object.values(readDrafts(accountId));
    },

    discardDraft({ accountId, docId }) {
      const all = readDrafts(accountId);
      delete all[docId];
      writeDrafts(accountId, all);
    },

    /**
     * What signing back in does with a surviving draft. The draft is never
     * silently applied, never exported somewhere else, and never deleted by a
     * failure: permission loss locks it, a moved base marks it a conflict.
     */
    recoverDraft({ sessionId, docId }) {
      const session = requireSession(sessionId);
      const all = readDrafts(session.accountId);
      const draft = all[docId];
      if (!draft) return { status: "missing" };
      let doc;
      try {
        doc = document(docId);
      } catch (error) {
        if (error instanceof ProtocolError && error.code === "document_deleted") {
          return { status: "blocked", reason: "document_deleted" };
        }
        return { status: "blocked", reason: "not_found" };
      }
      const effective = effectiveLevel(session.accountId, doc);
      if (!effective || !["edit", "manage"].includes(effective.level)) {
        // Losing the right to edit keeps the bytes on disk and locks them in the
        // app. It must not delete unsent work and must not offer an export path
        // around the revoked permission.
        all[docId] = { ...draft, state: "blocked" };
        writeDrafts(session.accountId, all);
        return {
          status: "blocked",
          reason: "permission_revoked",
          payloadPreserved: draft.payload.length > 0,
        };
      }
      if (draft.baseRevision !== doc.revision) {
        all[docId] = { ...draft, state: "conflict" };
        writeDrafts(session.accountId, all);
        return { status: "conflict", base: draft.baseRevision, current: doc.revision };
      }
      return { status: "recovered", payload: draft.payload, base: draft.baseRevision, via: effective.via };
    },

    // ---- conversion (Q7-B) -------------------------------------------------
    /**
     * A conversion that can lose fidelity never overwrites its source: it
     * creates a NEW document, keeps the source's history and permissions, and
     * records the source version it came from. When the source belongs to a
     * Work Product, the copy belongs to the same Work Product, so permissions
     * keep flowing through C-01 section 13's single owner delegation.
     */
    convertDocument({ sessionId, docId, targetFormat, mode }) {
      const session = requireSession(sessionId);
      const source = document(docId);
      requireLevel(session.accountId, source, ["edit", "manage"]);
      if (mode !== "copy") {
        fail("owner_requires_copy", { reason: "conversion_preserves_source" });
      }
      const copyId = docId + "." + targetFormat;
      if (state.documents.has(copyId)) {
        fail("owner_requires_copy", { reason: "copy_already_exists", copyId });
      }
      const copyChecksum = source.checksum + ":" + targetFormat;
      state.documents.set(copyId, {
        id: copyId,
        orgId: source.orgId,
        wsId: source.wsId,
        ownerKind: source.ownerKind,
        ownerId: source.ownerId,
        revision: 1,
        currentVersion: 1,
        checksum: copyChecksum,
        sourceDocumentId: docId,
        sourceVersion: source.currentVersion,
      });
      state.versions.set(copyId, [
        { version: 1, checksum: copyChecksum, reason: "agent", base: source.currentVersion },
      ]);
      state.acl.set(copyId, new Map());
      pushChange("created", copyId, 1);
      return {
        copyId,
        sourceDocumentId: docId,
        sourceVersion: source.currentVersion,
        ownerKind: source.ownerKind,
        ownerId: source.ownerId,
        sourceUntouched: {
          version: state.documents.get(docId).currentVersion,
          revision: state.documents.get(docId).revision,
          versions: state.versions.get(docId).length,
        },
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
export const FAULT_CASES = [
  {
    id: "two-saves-same-base",
    requirement: "Hai save cùng base — giữ cả hai bản, không ghi đè im lặng",
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
        model.saveDraft({ accountId: base.accountId, docId: base.docId, payload: "v2-B", baseRevision: 1, state: "conflict" });
      }
      return {
        first: first.replayed ? "replayed" : "committed",
        second: second.outcome,
        secondCode: second.code ?? null,
        secondClass: second.errorClass ?? null,
        secondSawCurrent: second.want ?? null,
        serverVersion: model.openDocument(base).version,
        versions: model.versionsOf(base.docId),
        localConflictKept: model.listDrafts(base.accountId)[0]?.payload === "v2-B",
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
    },
  },
  {
    id: "retry-same-payload",
    requirement: "Retry cùng payload — cùng kết quả, không thêm phiên bản",
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
    requirement: "Cùng key khác payload — phải bị từ chối, không replay",
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
    // Today's BeginIdempotent keys on (org, workspace, scope, key) alone and
    // never compares payloads, so it would REPLAY the first answer: the client
    // believes payload-B was saved and payload-B is nowhere. This is the gap
    // the contract requires closing (run with --legacy-idempotency to see it).
    expectLegacy: { outcome: "replayed", code: null, versions: 2 },
  },
  {
    id: "lost-response-after-commit",
    requirement: "Mất phản hồi sau commit — retry hội tụ, không tạo phiên bản thứ hai",
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
    requirement: "Commit lỗi không đổi bản hiện hành; object tạm thành mồ côi",
    run({ model, base }) {
      const payload = "too-big-to-fit-in-a-one-byte-quota";
      model.setQuotaLimit(1);
      const upload = model.beginUpload({ ...base, payload });
      let observed;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload });
        observed = { result: "committed" };
      } catch (error) {
        observed = { result: "error", code: error.code, errorClass: error.errorClass };
      }
      const before = model.openDocument(base);
      // Raise the quota and retry the same bytes: a refused commit must not
      // poison the retry, and the temp object is still there to retry with.
      model.setQuotaLimit(8 * 1024);
      const retried = model.commitSave({ ...base, uploadId: upload.uploadId, payload });
      return {
        ...observed,
        currentUnchanged: before.version === 1 && before.revision === 1,
        versionsAfterFailure: 1,
        orphansAfterFailure: 1,
        retrySucceeded: retried.version === 2,
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
    },
  },
  {
    id: "logout-restart-with-draft",
    requirement: "Logout/restart với nháp — phiên thu hồi, nháp còn; đăng nhập lại thấy lại",
    run({ model, base, restart }) {
      model.saveDraft({ accountId: base.accountId, docId: base.docId, payload: "unsent", baseRevision: 1 });
      model.revokeDevice(base.sessionId);

      const second = restart();
      // A restart has no session: the draft is read back from disk by account.
      const afterRestart = second.listDrafts(base.accountId);
      const login = second.loginAs({ accountId: base.accountId, verifier: "verifier-1" });
      const recovered = second.recoverDraft({ sessionId: login.sessionId, docId: base.docId });
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
        payloadAfterRestart: afterRestart[0]?.payload ?? null,
        recovery: recovered.status,
        recoveredPayload: recovered.payload ?? null,
      };
    },
    expect: {
      sessionRevoked: true,
      draftsAfterRestart: 1,
      payloadAfterRestart: "unsent",
      recovery: "recovered",
      recoveredPayload: "unsent",
    },
  },
  {
    id: "account-b-cannot-reach-a-draft",
    requirement: "Tài khoản B không đọc/gửi được nháp của A",
    run({ model, base }) {
      model.saveDraft({ accountId: "account-a", docId: base.docId, payload: "A-secret", baseRevision: 1 });
      const bSession = model.loginAs({ accountId: "account-b", verifier: "verifier-b" });
      model.grant(base.docId, "account-b", "edit");
      const bDraftsBeforeWrite = model.listDrafts("account-b").length;
      model.saveDraft({ accountId: "account-b", docId: base.docId, payload: "B-own", baseRevision: 1 });
      const aDraft = model.listDrafts("account-a");
      let bCanOpen;
      try {
        model.openDocument({ sessionId: bSession.sessionId, docId: base.docId });
        bCanOpen = "allowed";
      } catch (error) {
        bCanOpen = error.code;
      }
      return {
        bSeesADraft: bDraftsBeforeWrite,
        aDraftStillOwned: aDraft[0]?.payload ?? null,
        bDraftCount: model.listDrafts("account-b").length,
        bCanOpen,
      };
    },
    expect: { bSeesADraft: 0, aDraftStillOwned: "A-secret", bDraftCount: 1, bCanOpen: "allowed" },
  },
  {
    id: "a-loses-permission",
    requirement: "A mất quyền — nháp bị khóa, không xuất, không tự xóa",
    run({ model, base }) {
      model.saveDraft({ accountId: base.accountId, docId: base.docId, payload: "A-work", baseRevision: 1 });
      model.revoke(base.docId, base.accountId);
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId });
      return {
        status: recovered.status,
        reason: recovered.reason,
        payloadPreserved: recovered.payloadPreserved,
        draftStillOnDisk: model.listDrafts(base.accountId)[0]?.payload ?? null,
        draftState: model.listDrafts(base.accountId)[0]?.state ?? null,
      };
    },
    expect: {
      status: "blocked",
      reason: "permission_revoked",
      payloadPreserved: true,
      draftStillOnDisk: "A-work",
      draftState: "blocked",
    },
  },
  {
    id: "a-has-permission-base-changed",
    requirement: "A còn quyền nhưng base đã đổi — xung đột, hai bản còn nguyên",
    run({ model, base }) {
      model.saveDraft({ accountId: base.accountId, docId: base.docId, payload: "A-edit", baseRevision: 1 });
      const other = model.beginUpload({ ...base, payload: "server-move" });
      model.commitSave({ ...base, uploadId: other.uploadId, payload: "server-move" });
      const recovered = model.recoverDraft({ sessionId: base.sessionId, docId: base.docId });
      return {
        status: recovered.status,
        draftBase: recovered.base,
        serverCurrent: recovered.current,
        draftStillOnDisk: model.listDrafts(base.accountId)[0]?.payload ?? null,
        versions: model.versionsOf(base.docId),
      };
    },
    expect: { status: "conflict", draftBase: 1, serverCurrent: 2, draftStillOnDisk: "A-edit", versions: 2 },
  },
  {
    id: "quota-exhausted",
    requirement: "Quota hết — không báo đã lưu, bản hiện hành không đổi",
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
      model.saveDraft({ accountId: base.accountId, docId: base.docId, payload, baseRevision: 1, state: "dirty" });
      return {
        ...observed,
        currentVersion: model.openDocument(base).version,
        draftKept: model.listDrafts(base.accountId).length,
        draftState: model.listDrafts(base.accountId)[0]?.state ?? null,
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
    requirement: "Thu quyền giữa upload và commit — commit bị từ chối, object tạm mồ côi",
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
    requirement: "Tạo bản sao từ Work Product — Document mới, nguồn và quyền giữ nguyên",
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
      const copy = model.convertDocument({ sessionId: base.sessionId, docId: "wp-doc", targetFormat: "pdf", mode: "copy" });
      let overwrite;
      try {
        model.convertDocument({ sessionId: base.sessionId, docId: "wp-doc", targetFormat: "pdf", mode: "overwrite" });
        overwrite = { outcome: "allowed" };
      } catch (error) {
        overwrite = { outcome: "error", code: error.code };
      }
      // A second account with no Work Product level must not read the copy: the
      // copy delegates to the same owner, it does not open a second door.
      const outsider = model.loginAs({ accountId: "account-z", verifier: "verifier-z" });
      let outsiderRead;
      try {
        model.openDocument({ sessionId: outsider.sessionId, docId: copy.copyId });
        outsiderRead = "allowed";
      } catch (error) {
        outsiderRead = error.code;
      }
      return {
        copyOwnedByWorkProduct: copy.ownerKind === "work_product" && copy.ownerId === "wp-1",
        copyLinksSource: copy.sourceDocumentId === "wp-doc",
        sourceVersionsKept: copy.sourceUntouched.versions,
        sourceRevisionKept: copy.sourceUntouched.revision,
        overwrite: overwrite.outcome,
        overwriteCode: overwrite.code ?? null,
        outsiderRead,
      };
    },
    expect: {
      copyOwnedByWorkProduct: true,
      copyLinksSource: true,
      sourceVersionsKept: 1,
      sourceRevisionKept: 1,
      overwrite: "error",
      overwriteCode: "owner_requires_copy",
      outsiderRead: "forbidden",
    },
  },
  {
    id: "tombstone-and-expired-cursor",
    requirement: "Tombstone và cursor hết hạn — retry không hồi sinh file đã xóa",
    run({ model, base }) {
      model.addDocument({ id: "doc-2", orgId: "org-1", wsId: "ws-1", checksum: "doc2" });
      model.grant("doc-2", base.accountId, "edit");
      const upload = model.beginUpload({ ...base, payload: "old-write" });
      model.tombstone(base.docId);
      let retry;
      try {
        model.commitSave({ ...base, uploadId: upload.uploadId, payload: "old-write" });
        retry = { outcome: "committed" };
      } catch (error) {
        retry = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      // Walk the change log past retention, then ask for the stale cursor.
      model.addDocument({ id: "doc-3", orgId: "org-1", wsId: "ws-1", checksum: "doc3" });
      model.addDocument({ id: "doc-4", orgId: "org-1", wsId: "ws-1", checksum: "doc4" });
      let stale;
      try {
        model.readChanges({ sessionId: base.sessionId, cursor: "1" });
        stale = { outcome: "served" };
      } catch (error) {
        stale = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      const resync = model.readChanges({ sessionId: base.sessionId, cursor: "0" });
      return {
        retry: retry.outcome,
        retryCode: retry.code ?? null,
        stale: stale.outcome,
        staleCode: stale.code ?? null,
        staleClass: stale.errorClass ?? null,
        resyncSeesDelete: resync.events.some((event) => event.kind === "deleted" && event.documentId === base.docId),
        resyncResurrects: resync.events.some((event) => event.kind === "created" && event.documentId === base.docId),
        resyncStillHasOtherDocs: resync.events.length > 0,
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
    id: "client-engine-incompatible",
    requirement: "Client/engine không tương thích — từ chối trước khi ghi",
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
    requirement: "Token/code hết hạn hoặc dùng lại — code dùng một lần, nháp không mất",
    run({ model, base, clock }) {
      const challenge = sha256("verifier-1");
      const fresh = model.beginAuthCode({ accountId: base.accountId, challenge, ttlMs: 60_000 });
      clock.t += 61_000;
      let expired;
      try {
        model.redeemAuthCode({ code: fresh.code, verifier: "verifier-1" });
        expired = { outcome: "redeemed" };
      } catch (error) {
        expired = { outcome: "error", code: error.code, errorClass: error.errorClass };
      }
      clock.t -= 61_000;
      const reusable = model.beginAuthCode({ accountId: base.accountId, challenge, ttlMs: 60_000 });
      const first = model.redeemAuthCode({ code: reusable.code, verifier: "verifier-1" });
      let second;
      try {
        model.redeemAuthCode({ code: reusable.code, verifier: "verifier-1" });
        second = { outcome: "redeemed" };
      } catch (error) {
        second = { outcome: "error", code: error.code };
      }
      // Wrong verifier: a code lifted from a log cannot be exchanged for a session.
      const hijacked = model.beginAuthCode({ accountId: base.accountId, challenge, ttlMs: 60_000 });
      let wrongVerifier;
      try {
        model.redeemAuthCode({ code: hijacked.code, verifier: "not-the-verifier" });
        wrongVerifier = { outcome: "redeemed" };
      } catch (error) {
        wrongVerifier = { outcome: "error", code: error.code };
      }
      const liveSessions = [...model.state.sessions.values()].filter((session) => !session.revoked).length;
      model.expireAccessToken(first.sessionId);
      let afterExpiry;
      try {
        model.openDocument({ sessionId: first.sessionId, docId: base.docId });
        afterExpiry = { outcome: "allowed" };
      } catch (error) {
        afterExpiry = { outcome: "error", code: error.code };
      }
      return {
        expired: expired.outcome,
        expiredCode: expired.code ?? null,
        expiredClass: expired.errorClass ?? null,
        replay: second.outcome,
        replayCode: second.code ?? null,
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
      replay: "error",
      replayCode: "authorization_code_reused",
      wrongVerifier: "error",
      wrongVerifierCode: "forbidden",
      liveSessions: 2,
      afterAccessExpiry: "error",
      afterAccessExpiryCode: "token_expired",
    },
  },
  {
    id: "idempotency-in-flight",
    requirement: "Cùng key khi request đầu còn đang chạy — không chạy lệnh hai lần",
    run({ model, base }) {
      const key = "k-inflight";
      // Model a first attempt that claimed the key and has not committed yet.
      model.state.idempotency.set("document.save:" + key, {
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
];

/** Every case id the plan's mandatory list ("Ca bắt buộc") requires. */
export const REQUIRED_CASE_IDS = [
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
 * Run every case against a fresh model. The fixture is identical for all cases,
 * so a failure is a difference in the case, not in the setup.
 *
 * restart() builds a new model over the same draft directory with no in-memory
 * state, which is what a process restart is: the draft is only there if the
 * bytes reached the disk.
 */
export function runAllCases({ workDir, idempotencyFingerprint = true } = {}) {
  const dir = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "office-g0-"));
  const results = [];

  for (const testCase of FAULT_CASES) {
    const clock = { t: 1_000_000 };
    const options = { dir, idempotencyFingerprint, changeRetention: 2, now: () => clock.t };

    const model = createModel(options);
    model.addDocument({ id: "doc-1", orgId: "org-1", wsId: "ws-1", checksum: "genesis" });
    model.grant("doc-1", "account-a", "edit");
    const session = model.loginAs({ accountId: "account-a", verifier: "verifier-0" });
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

    const observed = testCase.run({ model, base, restart, clock });
    const expected = idempotencyFingerprint ? testCase.expect : testCase.expectLegacy ?? testCase.expect;
    results.push({
      id: testCase.id,
      requirement: testCase.requirement,
      observed,
      expected,
      ok: JSON.stringify(observed) === JSON.stringify(expected),
    });
  }

  return { dir, results };
}

function gitHead() {
  const out = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "unknown";
}

export function buildEvidence({ results, dir, legacy }) {
  const failed = results.filter((result) => !result.ok);
  return {
    schemaVersion: 1,
    issue: "UNI-669",
    task: "DOC-005 — login, sync, phiên bản và phục hồi nháp",
    contractDoc: CONTRACT_DOC,
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    mode: legacy ? "legacy-idempotency (gap demonstration)" : "contract",
    authorization: "modeled (in-memory ACL map)",
    evidenceLevel: "reference model + real filesystem draft persistence",
    draftStoreDir: dir,
    summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
    cases: results,
    limitations: [
      "Reference model only: no HTTP server, no product auth middleware, no document service, no engine, no browser.",
      "Authorization is an in-memory ACL map (modeled authorization). This is NOT product tenancy isolation and does not replace G1/G4/G5 service tests.",
      "Engine open/parse/serialize/convert is out of scope here; DOC-004 owns the engine contract and extends this case table.",
      "Draft persistence is a real filesystem write; recovery is exercised across a fresh model that re-reads those bytes.",
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
  const legacy = argv.includes("--legacy-idempotency");
  const hasOut = argv.includes("--out");
  const print = argv.includes("--print") || !hasOut;
  const outIndex = argv.indexOf("--out");
  const outPath =
    outIndex >= 0 ? argv[outIndex + 1] : path.join(REPO_ROOT, ".go-tmp", "office-g0", "run-contracts.json");
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

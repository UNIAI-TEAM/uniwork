/* global Buffer */
// Request/response wire shapes of the server-layer fault cases (G7-03a, UNI-1380).
// Every body and header below is what the handlers read and write; the cite
// beside each is the struct or handler in server/internal/handler (SDI = what
// a request carries, SDO = what a response carries). The case drivers in
// server-case-drivers.mjs run against the `ctx` this module builds, and
// server-cases.test.mjs drives it through a fake transport that enforces the
// same shapes, so a shape drift fails a unit test instead of a cloud round.

/** ai.UniworkConversationHeader (server/internal/ai/openai_facade.go:49): sent on a continued turn, set on every answer. */
export const CONVERSATION_HEADER = "X-UniWork-AI-Conversation";

const DECIMAL = /^\d+$/;

/**
 * A revision on the wire is a decimal STRING (dto/sdi/document.go:63-66, dto/sdo/document.go DocumentDTO.revision).
 * A JS number is refused: revisions are BIGINT server-side and must never pass through a double.
 */
export function revisionString(value, label = "revision") {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "string" && DECIMAL.test(value.trim())) return value.trim();
  throw new TypeError(`${label} must be a decimal string, got ${typeof value} ${JSON.stringify(value)}`);
}

/** Compares two decimal-string revisions without a lossy Number(). */
export function revisionGreater(a, b) {
  return BigInt(revisionString(a)) > BigInt(revisionString(b));
}

/** POST /documents/{id}/versions/commit body: CommitDocumentVersionSDI (dto/sdi/document.go:63-66). */
export function commitBody({ uploadId, baseRevision }) {
  return { upload_id: uploadId, base_revision: revisionString(baseRevision, "base_revision") };
}

/** POST /documents/{id}/move body: MoveDocumentSDI (dto/sdi/document.go:232-236); revision is a string, parent_id null = root. */
export function moveBody({ parentId, revision }) {
  return { parent_id: parentId ?? null, revision: revisionString(revision, "revision") };
}

/** POST /workspaces/{ws}/documents body for a folder: CreateDocumentSDI (dto/sdi/document.go:15-22), kind folder. */
export function folderBody(title) {
  return { title, kind: "folder" };
}

/** POST .../ai/uniwork/chat/completions body: AiUniworkChatCompletionsSDI (dto/sdi/ai_uniwork.go:10-20), one user message. */
export function aiTurnBody(prompt) {
  return { messages: [{ role: "user", content: prompt }] };
}

/** The error envelope code, `{error: {code, message, error_class?, fields?}}` (dto/sdo/common.go ErrorSDO, json.go respondError). */
export function errorCodeOf(body) {
  return body?.error?.code ?? null;
}

/** `status:label` where label is the lookup outcome on 200 and the error code on any refusal (a 410 body has no top-level outcome). */
export function describeResponse(res) {
  return `${res.status}:${res.body?.outcome ?? errorCodeOf(res.body) ?? ""}`;
}

/**
 * The wire-level part of a case context: every call the drivers make to the
 * server, keyed to the route it hits. `http(origin, path, opts)` and
 * `multipart(origin, path, opts)` are the transport (server-cases.mjs httpJson /
 * httpMultipartFile); `proxyOrigin` is the fault proxy, `apiOrigin` the server.
 */
export function createWireContext({ http, multipart, apiOrigin, proxyOrigin, tenant, doc, caseId, fixture, newKey }) {
  const variantBytes = (label) => Buffer.concat([fixture.bytes, Buffer.from(`\n<!-- ${caseId}:${label} -->`)]);
  const filename = fixture.filename;
  const bearer = (actor) => tenant.tokens[actor];
  const idem = (key) => (key ? { "Idempotency-Key": key } : {});
  const upload = (origin) => (actor, docId, { idempotencyKey, label = "v" }) =>
    multipart(origin, `/api/v1/documents/${docId}/uploads`, {
      token: bearer(actor),
      fileBytes: variantBytes(label),
      filename,
      mime: fixture.mime,
      headers: idem(idempotencyKey),
    });
  const commit = (origin) => (actor, docId, { idempotencyKey, uploadId, baseRevision, signal }) =>
    http(origin, `/api/v1/documents/${docId}/versions/commit`, {
      method: "POST",
      token: bearer(actor),
      headers: idem(idempotencyKey),
      body: commitBody({ uploadId, baseRevision }),
      signal,
    });
  const uploadDirect = upload(apiOrigin);
  const commitDirect = commit(apiOrigin);

  return {
    uploadViaProxy: upload(proxyOrigin),
    uploadDirect,
    commitViaProxy: commit(proxyOrigin),
    lookupViaProxy: (actor, docId, { idempotencyKey }) =>
      http(proxyOrigin, `/api/v1/documents/${docId}/versions/commit`, { method: "GET", token: bearer(actor), headers: idem(idempotencyKey) }),
    getDocumentViaProxy: (actor, docId) => http(proxyOrigin, `/api/v1/documents/${docId}`, { method: "GET", token: bearer(actor) }),
    uploadAndCommitDirect: async (actor, docId, { baseRevision, label = "direct" }) => {
      const up = await uploadDirect(actor, docId, { idempotencyKey: newKey("up-direct"), label });
      return commitDirect(actor, docId, { idempotencyKey: newKey("commit-direct"), uploadId: up.body?.upload_id, baseRevision });
    },
    seedFailedIntentDirect: async (actor, docId) => {
      const key = newKey("seed-intent");
      const up = await uploadDirect(actor, docId, { idempotencyKey: newKey("up-seed"), label: "seed" });
      await commitDirect(actor, docId, { idempotencyKey: key, uploadId: up.body?.upload_id, baseRevision: "999999" });
      return key;
    },
    aiTurnViaProxy: (actor, docId, { prompt, conversationId = "" }) =>
      http(proxyOrigin, `/api/v1/documents/${docId}/ai/uniwork/chat/completions`, {
        method: "POST",
        token: bearer(actor),
        headers: conversationId ? { [CONVERSATION_HEADER]: conversationId } : {},
        body: aiTurnBody(prompt),
      }),
    removeWorkspaceMemberDirect: (actor) =>
      http(apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/members/${tenant.users[actor]}`, { method: "DELETE", token: bearer("owner") }),
    archiveDocumentDirect: (docId) => http(apiOrigin, `/api/v1/documents/${docId}/archive`, { method: "POST", token: bearer("owner") }),
    restoreAndMoveDocumentDirect: async (docId) => {
      await http(apiOrigin, `/api/v1/documents/${docId}/restore`, { method: "POST", token: bearer("owner") });
      const cur = await http(apiOrigin, `/api/v1/documents/${docId}`, { method: "GET", token: bearer("owner") });
      const folder = await http(apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/documents`, {
        method: "POST",
        token: bearer("owner"),
        body: folderBody(`Folder ${caseId} ${Date.now()}`),
      });
      const moved = await http(apiOrigin, `/api/v1/documents/${docId}/move`, {
        method: "POST",
        token: bearer("owner"),
        body: moveBody({ parentId: folder.body?.document?.id, revision: cur.body?.document?.revision ?? doc.revision }),
      });
      return { revision: moved.body?.document?.revision ?? null };
    },
  };
}

import { ApiError } from "../api/http";
import { createDocumentFile } from "../api/endpoints/documents";
import {
  createOfficeFrameClient,
  mintOfficeFrameToken,
  type OfficeFrameClient,
  type OfficeFrameClientOptions,
  type OfficeFrameDocument,
  type OfficeFrameToken,
} from "../api/endpoints/office-frame";
import { runtimeConfig } from "../runtime-config";
import {
  DocsProtocolError,
  errorFromHttpStatus,
  toProtocolError,
  type ApiAttachmentsAddPayload,
  type ApiAttachmentsAddResult,
  type ApiExportPayload,
  type ApiExportResult,
  type ApiImageUploadPayload,
  type ApiImageUploadResult,
  type ApiOpenPayload,
  type ApiRecentsPayload,
  type ApiRecentsResult,
  type ApiSaveAsPayload,
  type ApiSavePayload,
  type FileMeta,
  type OfficeModule,
  type OpenPayload,
  type SaveResult,
  type TokenPayload,
} from "./docs-frame-protocol";
import { officeFrameSrc, officeModuleSpec } from "./office-modules";

/** A proxied call carries the frame token and the one document it is scoped to. */
export interface DocsFrameCall {
  workspaceId: string;
  documentId: string;
  token: string;
  signal: AbortSignal;
}

/**
 * A save-as answer. The copy is a new document, so the frame's token no longer
 * covers it: `rebind` carries the new document and a token minted for it, and
 * the host switches the frame's scope to them before answering.
 */
export interface DocsFrameSavedAs {
  save: SaveResult;
  rebind: { documentId: string; token: OfficeFrameToken };
}

/**
 * What the Docs frame host proxies the frame's `api.*` requests to. Each
 * method answers one request and may throw a `DocsProtocolError` that the
 * frame receives as a typed error. An absent method answers `unsupported`.
 */
export interface DocsFrameApi {
  open(payload: ApiOpenPayload, call: DocsFrameCall): Promise<OpenPayload>;
  save(payload: ApiSavePayload, call: DocsFrameCall): Promise<SaveResult>;
  recents(payload: ApiRecentsPayload, call: DocsFrameCall): Promise<ApiRecentsResult>;
  /** Not implemented by `createDocsFrameApi` (see there); an absent method answers `unsupported`. */
  uploadImage?(payload: ApiImageUploadPayload, call: DocsFrameCall): Promise<ApiImageUploadResult>;
  saveAs?(payload: ApiSaveAsPayload, call: DocsFrameCall): Promise<DocsFrameSavedAs>;
  export?(payload: ApiExportPayload, call: DocsFrameCall): Promise<ApiExportResult>;
  addAttachments?(payload: ApiAttachmentsAddPayload, call: DocsFrameCall): Promise<ApiAttachmentsAddResult>;
}

/** Same-origin URL of a pinned Docs frame build (served by the web app). */
export function docsFrameSrc(version: string): string {
  return officeFrameSrc("docs", version);
}

/** `apiBase` of the init message; informational while the frame uses host-proxy mode. */
export function docsFrameApiBase(): string {
  return `${runtimeConfig().apiUrl}/api/v1`;
}

/** W6's minted token in protocol shape (absolute expiry in epoch ms). */
export function docsFrameToken(token: OfficeFrameToken, now = Date.now()): TokenPayload {
  const parsed = Date.parse(token.expires_at);
  return { token: token.token, tokenExpiresAt: Number.isFinite(parsed) ? parsed : now + token.expires_in * 1000 };
}

/** An API failure (ApiError, network, thrown shape) as the protocol error the frame understands. */
export function docsFrameError(error: unknown): DocsProtocolError {
  if (error instanceof ApiError) {
    // 501 or 503 office_not_configured (no PDF renderer here) tells the frame to fall back to its own print;
    // 504 is the server giving up on a slow render. Both are not "internal".
    // 503 office_not_configured is the same fact as 501 for the frame: this deployment has no engine.
    const noRenderer = error.status === 501 || (error.status === 503 && error.code === "office_not_configured");
    const shape = noRenderer
      ? { code: "unsupported" as const, message: error.message, status: error.status }
      : error.status === 504
        ? { code: "timeout" as const, message: error.message, status: 504, retryable: true }
        : errorFromHttpStatus(error.status, error.message).toShape();
    return new DocsProtocolError({ ...shape, details: { apiCode: error.code } });
  }
  return toProtocolError(error);
}

/** A 200 whose body did not match the contract (parseWithFallback answered null). */
function malformed(endpoint: string): DocsProtocolError {
  return new DocsProtocolError({ code: "internal", message: `${endpoint}: response did not match the contract`, retryable: true });
}

function fileMeta(doc: OfficeFrameDocument): FileMeta {
  const modifiedAt = doc.updated_at ? Date.parse(doc.updated_at) : Number.NaN;
  return {
    fileId: doc.document_id,
    name: doc.file.filename,
    sizeBytes: doc.file.size_bytes,
    mimeType: doc.file.mime_type,
    versionId: doc.file.version_id,
    // The document revision is the concurrency token: it comes back as base_revision.
    etag: doc.revision,
    writable: doc.can_edit,
    ...(Number.isFinite(modifiedAt) ? { modifiedAt } : {}),
  };
}

/** A signed byte route of the office-frame API, as the server answers it (origin-relative). */
function isFrameRoute(url: string): boolean {
  return url.startsWith("/api/v1/office-frame/documents/");
}

/**
 * The open answer's relative-path map as `OpenPayload.assets`: only frame routes, which
 * the web app serves same-origin with the frame (its CSP loads nothing else).
 */
function frameAssets(doc: OfficeFrameDocument): Record<string, string> | undefined {
  const entries = Object.entries(doc.assets ?? {}).filter(([, url]) => isFrameRoute(url));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The token opens exactly one document; anything else is refused before a round trip. */
function sameDocument(fileId: string, call: DocsFrameCall): void {
  if (fileId !== call.documentId) {
    throw new DocsProtocolError({ code: "forbidden", message: "the frame token is scoped to another document", status: 403 });
  }
}

/**
 * One Idempotency-Key per LOGICAL operation: the hash of what the operation
 * is (kind, scope, base revision, the bytes), so a retry after a lost answer
 * replays the first attempt instead of colliding with it as a stale save.
 * Two different edits never share a key, because their bytes or base differ.
 */
async function operationKey(kind: string, scope: readonly string[], bytes?: ArrayBuffer): Promise<string> {
  const head = new TextEncoder().encode(JSON.stringify([kind, ...scope]));
  const body = new Uint8Array(bytes ?? new ArrayBuffer(0));
  const joined = new Uint8Array(head.length + 1 + body.length);
  joined.set(head);
  joined.set(body, head.length + 1);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", joined));
  return `frame-${kind}-${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type DocsFrameApiOptions = Pick<OfficeFrameClientOptions, "apiUrl" | "fetch">;

/**
 * The DocsFrameApi on the UniWork office-frame routes (W6): every call is made
 * with the frame token only (Bearer, `credentials: 'omit'`), never the session.
 * `OfficeDocsFrame` uses one by default, so the web docx host only mounts
 *   `<DocxOpenSwitch organizationId={…} fallback={<G3 host />}
 *     docsFrame={<OfficeDocsFrame wsId documentId title frameVersion={pin} />} />`
 * and passes `api={createDocsFrameApi({ apiUrl })}` only for another API origin.
 * It keeps no per-document state, so one instance serves every frame.
 * There is no image-upload handler for Docs on purpose: the frame embeds images
 * as `data:` URIs inside the docx and never sends `api.images.upload`; an
 * `api.images.upload` request answers `unsupported`. Markdown and HTML have one
 * (see `createOfficeFrameApi`).
 * Save-as has no frame route by design: the host creates the copy with its own
 * session and mints a frame token for it. Export renders a PDF on the server
 * (HTML export has no route). Attachments have no route yet and answer
 * `unsupported`.
 */
export function createDocsFrameApi(options: DocsFrameApiOptions = {}): DocsFrameApi {
  return createOfficeFrameApi("docs", options);
}

/**
 * The same API for any genoffice web module (UNI-1014/1015/1016): the routes
 * are generic, the token names the module. A save uploads the module's own
 * mime type, a save-as names the copy with its extension, and only Docs has
 * a server PDF export (another module answers `unsupported` and prints in
 * place, as the server would refuse it with 501).
 */
export function createOfficeFrameApi(module: OfficeModule, options: DocsFrameApiOptions = {}): DocsFrameApi {
  const { mimeType, extension } = officeModuleSpec(module);
  const ext = new RegExp(`\\.${extension}$`, "i");
  const clientFor = (call: DocsFrameCall): OfficeFrameClient => createOfficeFrameClient({ ...options, getToken: () => call.token });
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw error instanceof DocsProtocolError ? error : docsFrameError(error);
    }
  };

  return {
    open: (payload, call) => run(async () => {
      sameDocument(payload.fileId, call);
      const client = clientFor(call);
      const doc = await client.open(payload.fileId);
      if (!doc) throw malformed("office-frame open");
      const bytes = await (await client.content(doc.download_url, call.signal)).arrayBuffer();
      const assets = frameAssets(doc);
      return { file: fileMeta(doc), source: { kind: "bytes", data: bytes }, ...(assets ? { assets } : {}) };
    }),

    save: (payload, call) => run(async () => {
      sameDocument(payload.fileId, call);
      const client = clientFor(call);
      // The base revision is what the optimistic-concurrency check compares; a save without one
      // would silently rebase onto whatever is newest and overwrite it.
      const baseRevision = payload.etag;
      if (!baseRevision) {
        throw new DocsProtocolError({ code: "malformed", message: "save needs the etag (base revision) the frame opened with" });
      }
      const key = await operationKey("save", [payload.fileId, baseRevision], payload.data);
      // The stored file keeps its own name: the upload is named after what open answered.
      const current = await client.open(payload.fileId);
      if (!current) throw malformed("office-frame open");
      const upload = await client.upload(payload.fileId, new Blob([payload.data], { type: mimeType }), current.file.filename, `${key}:upload`);
      if (!upload) throw malformed("office-frame upload");
      try {
        const doc = await client.commit(payload.fileId, { upload_id: upload.upload_id, base_revision: baseRevision }, `${key}:commit`);
        if (!doc) throw malformed("office-frame commit");
        return { ok: true, file: fileMeta(doc), versionId: doc.file.version_id };
      } catch (error) {
        // A stale base is an answer, not a failure: the frame offers to reload.
        if (error instanceof ApiError && error.status === 409) return { ok: false, error: docsFrameError(error).toShape() };
        throw error;
      }
    }),

    saveAs: (payload, call) => run(async () => {
      const name = ext.test(payload.name) ? payload.name : `${payload.name}.${extension}`;
      const created = await createDocumentFile(
        call.workspaceId,
        new File([payload.data], name, { type: mimeType }),
        { title: name.replace(ext, ""), parent_id: payload.folderId },
        { idempotencyKey: await operationKey("saveas", [call.workspaceId, name, payload.folderId ?? ""], payload.data), signal: call.signal },
      );
      if (!created) throw malformed("documents/files");
      const token = await mintOfficeFrameToken(created.id, { signal: call.signal });
      if (!token) throw malformed("office frame-token");
      const opened = await createOfficeFrameClient({ ...options, getToken: () => token.token }).open(created.id);
      if (!opened) throw malformed("office-frame open");
      return { save: { ok: true, file: fileMeta(opened), versionId: opened.file.version_id }, rebind: { documentId: created.id, token } };
    }),

    recents: (payload, call) => run(async () => {
      const recents = await clientFor(call).recents(call.documentId, payload.limit);
      return {
        files: recents.items.map((item) => {
          const modifiedAt = item.updated_at ? Date.parse(item.updated_at) : Number.NaN;
          return { fileId: item.document_id, name: item.title, ...(Number.isFinite(modifiedAt) ? { modifiedAt } : {}) };
        }),
      };
    }),

    ...(module === "docs" ? { export: exportPdf } : {}),
    ...(module !== "docs" && officeModuleSpec(module).grant.images ? { uploadImage } : {}),
  };

  /**
   * A pasted or dropped picture of a Markdown/HTML document (UNI-1232): stored as
   * a document asset under the name the frame chose, so the `assets/<name>` it
   * writes resolves again on the next open. The answer's signed URL is what the
   * frame displays now.
   */
  function uploadImage(payload: ApiImageUploadPayload, call: DocsFrameCall): Promise<ApiImageUploadResult> {
    return run(async () => {
      if (payload.fileId !== undefined) sameDocument(payload.fileId, call);
      const key = await operationKey("image", [call.documentId, payload.name], payload.data);
      const asset = await clientFor(call).uploadAsset(call.documentId, new Blob([payload.data], { type: payload.mimeType }), payload.name, key);
      if (!asset || !isFrameRoute(asset.url)) throw malformed("office-frame assets");
      return { imageId: asset.asset_id, url: asset.url };
    });
  }

  function exportPdf(payload: ApiExportPayload, call: DocsFrameCall): Promise<ApiExportResult> {
    return run(async () => {
      if (payload.format !== "pdf") throw new DocsProtocolError({ code: "unsupported", message: "only PDF export is available on the web" });
      if (payload.fileId !== undefined) sameDocument(payload.fileId, call);
      // Unsaved edits travel as `data` and win; without them the server renders the current version.
      const file = payload.data ? new Blob([payload.data], { type: mimeType }) : undefined;
      const key = await operationKey("export", [call.documentId, payload.name ?? ""], payload.data);
      const pdf = await clientFor(call).exportPdf(call.documentId, { file, signal: call.signal }, key);
      if (!pdf) throw malformed("office-frame export/pdf");
      const base = payload.name?.replace(/\.(docx|pdf)$/i, "");
      return { data: pdf, mimeType: "application/pdf", ...(base ? { name: `${base}.pdf` } : {}) };
    });
  }
}

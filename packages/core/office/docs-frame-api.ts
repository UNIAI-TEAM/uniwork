import { ApiError } from "../api/http";
import { createDocumentFile, ensureMyFolder, getDocument } from "../api/endpoints/documents";
import { copyDocument } from "../api/endpoints/office";
import {
  createOfficeFrameClient,
  mintOfficeFrameToken,
  type OfficeFrameClient,
  type OfficeFrameClientOptions,
  type OfficeFrameSource,
  type OfficeFrameDocument,
  type OfficeFrameToken,
} from "../api/endpoints/office-frame";
import {
  ChunkedUploadError,
  chunkedUploadThreshold,
  startChunkedUpload,
  type ChunkedUploadOptions,
  type ChunkedUploadResult,
} from "../documents/chunked-upload";
import { runtimeConfig } from "../runtime-config";
import {
  DocsProtocolError,
  errorFromHttpStatus,
  toProtocolError,
  type ApiAttachmentsAddPayload,
  type ApiAssetsResolvePayload,
  type ApiAssetsResolveResult,
  type ApiAttachmentsAddResult,
  type ApiExportPayload,
  type ApiExportResult,
  type ApiImageUploadPayload,
  type ApiImageUploadResult,
  type ApiOpenPayload,
  type ApiRecentsPayload,
  type ApiRecentsResult,
  type ApiSaveAsPayload,
  type ApiSaveCopyPayload,
  type ApiSavePayload,
  type FileMeta,
  type OfficeModule,
  type OpenPayload,
  type SaveCopyResult,
  type SaveResult,
  type TokenPayload,
} from "./docs-frame-protocol";
import { officeFrameSrc, officeModuleSpec } from "./office-modules";
import { sanitizeUploadFilename } from "./upload-filename";

/** A proxied call carries the frame token and the one document it is scoped to. */
export interface DocsFrameCall {
  workspaceId: string;
  documentId: string;
  token: string;
  signal: AbortSignal;
  /** The host's live edit lock on this document (UNI-1645), acquired with the
   *  session through R2 — never through the frame token. A save commits with
   *  it; absent means the host holds no lock. */
  editLockId?: string;
  /** Bytes above which `save` and `saveAs` route through chunked upload sessions (UNI-1863); null or absent = single-request upload. */
  chunkedUploadThresholdBytes?: number | null;
  /** Filename the save's upload carries instead of the stored one (the name the first-save
   *  dialog wrote, UNI-1847): sanitized the way the server's `files.SanitizeFilename` reads it. */
  filename?: string;
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
  /** A read-only frame (a source file, UNI-1869) has no recents; an absent method answers `unsupported`. */
  recents?(payload: ApiRecentsPayload, call: DocsFrameCall): Promise<ApiRecentsResult>;
  /** Not implemented by `createDocsFrameApi` (see there); an absent method answers `unsupported`. */
  uploadImage?(payload: ApiImageUploadPayload, call: DocsFrameCall): Promise<ApiImageUploadResult>;
  /** Markdown/HTML: fresh URLs and the URLs of paths typed after the open (CONTRACT A1b). */
  resolveAssets?(payload: ApiAssetsResolvePayload, call: DocsFrameCall): Promise<ApiAssetsResolveResult>;
  saveAs?(payload: ApiSaveAsPayload, call: DocsFrameCall): Promise<DocsFrameSavedAs>;
  saveCopy?(payload: ApiSaveCopyPayload, call: DocsFrameCall): Promise<SaveCopyResult>;
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
export function docsFrameToken(token: Pick<OfficeFrameToken, "token" | "expires_at" | "expires_in">, now = Date.now()): TokenPayload {
  const parsed = Date.parse(token.expires_at);
  return { token: token.token, tokenExpiresAt: Number.isFinite(parsed) ? parsed : now + token.expires_in * 1000 };
}

/** An API failure (ApiError, network, thrown shape) as the protocol error the frame understands. */
export function docsFrameError(error: unknown): DocsProtocolError {
  if (error instanceof ChunkedUploadError) {
    if (error.code === "upload_canceled") {
      return new DocsProtocolError({ code: "cancelled", message: error.message });
    }
    return new DocsProtocolError({ code: "internal", message: error.message, retryable: true });
  }
  if (error instanceof ApiError) {
    // 501 or 503 office_not_configured (no PDF renderer here) tells the frame to fall back to its own print;
    // 504 is the server giving up on a slow render. Both are not "internal".
    // 503 office_not_configured is the same fact as 501 for the frame: this deployment has no engine.
    const noRenderer = error.status === 501 || (error.status === 503 && error.code === "office_not_configured");
    // The server words its message in the ACCOUNT language, which is not the page's: the frame
    // gets the stable code (`details.apiCode`, plus this English developer text) and maps it to
    // page-language copy itself. The sentence never travels.
    const message =
      error.status === 423
        ? `${error.code || "document_locked"} (HTTP 423)`
        : error.code
          ? `${error.code} (HTTP ${error.status})`
          : `HTTP ${error.status}`;
    const shape = noRenderer
      ? { code: "unsupported" as const, message, status: error.status }
      : error.status === 504
        ? { code: "timeout" as const, message, status: 504, retryable: true }
        : error.status === 423
          ? { code: "forbidden" as const, message, status: 423 }
          : errorFromHttpStatus(error.status, message).toShape();
    const rawMax = error.fields?.["max_bytes"];
    const maxBytes = typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : undefined;
    return new DocsProtocolError({
      ...shape,
      details: {
        apiCode: error.code,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(maxBytes !== undefined ? { max_bytes: maxBytes } : {}),
      },
    });
  }
  return toProtocolError(error);
}

/** A 200 whose body did not match the contract (parseWithFallback answered null). */
function malformed(endpoint: string): DocsProtocolError {
  return new DocsProtocolError({ code: "internal", message: `${endpoint}: response did not match the contract`, retryable: true });
}

function fileMeta(doc: OfficeFrameDocument | OfficeFrameSource): FileMeta {
  const modifiedAt = doc.updated_at ? Date.parse(doc.updated_at) : Number.NaN;
  return {
    fileId: "source_id" in doc ? doc.source_id : doc.document_id,
    name: doc.file.filename,
    sizeBytes: doc.file.size_bytes,
    mimeType: doc.file.mime_type,
    // The document revision is the concurrency token: it comes back as base_revision. A source
    // has no stored versions, so it has no version id (revision "0" is informational only).
    versionId: "source_id" in doc ? undefined : doc.file.version_id,
    // The document revision is the concurrency token: it comes back as base_revision.
    etag: doc.revision,
    writable: doc.can_edit,
    ...(Number.isFinite(modifiedAt) ? { modifiedAt } : {}),
  };
}

/**
 * A signed byte route of the office-frame API, as the server answers it
 * (origin-relative): exactly `.../documents/{ULID}/(assets|linked)/{ULID}?sig=...`, so a
 * `..` segment or another path under the prefix never reaches the frame.
 */
const FRAME_ROUTE = /^\/api\/v1\/office-frame\/documents\/[0-9A-Z]{26}\/(?:assets|linked)\/[0-9A-Z]{26}\?sig=[A-Za-z0-9._-]+$/;
function isFrameRoute(url: string): boolean {
  return FRAME_ROUTE.test(url);
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

export type DocsFrameApiOptions = Pick<OfficeFrameClientOptions, "apiUrl" | "fetch"> & {
  /** Default byte threshold above which `save` and `saveAs` use chunked upload sessions when the call does not specify one; null or absent = single-request upload. */
  chunkedUploadThresholdBytes?: number | null;
};

function resolveThreshold(call: DocsFrameCall, options: DocsFrameApiOptions): number | null {
  const raw = call.chunkedUploadThresholdBytes !== undefined
    ? call.chunkedUploadThresholdBytes
    : options.chunkedUploadThresholdBytes;
  return chunkedUploadThreshold({ chunked_upload_threshold_bytes: raw });
}

async function runChunkedUpload(opts: ChunkedUploadOptions, signal: AbortSignal): Promise<ChunkedUploadResult> {
  if (signal.aborted) {
    throw new DocsProtocolError({ code: "cancelled", message: "The operation was aborted." });
  }
  const upload = startChunkedUpload(opts);
  let canceling: Promise<void> | null = null;
  const onAbort = () => {
    canceling = upload.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await upload.result;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (canceling) await canceling;
  }
}

/**
 * Where a save-as copy lands without a chosen folder (UNI-1847, D6): beside its
 * source document, or into the caller's My Folder when the source sits at the
 * workspace root (the root itself is not a folder a file can be filed under).
 */
async function saveAsParentId(call: DocsFrameCall): Promise<string> {
  const source = await getDocument(call.documentId, call.signal);
  if (!source) throw malformed("GET /api/v1/documents/{id}");
  if (source.parent_id) return source.parent_id;
  const myFolder = await ensureMyFolder(call.workspaceId, { signal: call.signal });
  if (!myFolder) throw malformed("documents/my-folder");
  return myFolder.id;
}

/**
 * The DocsFrameApi on the UniWork office-frame routes (W6): every call is made
 * with the frame token only (Bearer, `credentials: 'omit'`), never the session.
 * `OfficeModuleFrame` uses one by default, so the web host mounts it inside
 *   `<OfficeModuleOpenSwitch module="docs" organizationId={…} frame={…} />`
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
  const sessionFetch: typeof fetch | undefined = options.fetch
    ? (input, init) => {
        const defaultBase = runtimeConfig().apiUrl;
        const url = typeof input === "string" && options.apiUrl && input.startsWith(`${defaultBase}/`)
          ? `${options.apiUrl}${input.slice(defaultBase.length)}`
          : input;
        return options.fetch!(url, init);
      }
    : undefined;
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
      if (!doc || "source_id" in doc) throw malformed("office-frame open");
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
      // The stored file keeps its own name: the upload is named after what open answered -
      // unless the call carries the name the first-save dialog wrote (UNI-1847, S01-V3), which
      // renames the stored file to the document's name on this save.
      const current = await client.open(payload.fileId);
      if (!current || "source_id" in current) throw malformed("office-frame open");
      const blob = new Blob([payload.data], { type: mimeType });
      const threshold = resolveThreshold(call, options);
      const uploadName = call.filename?.trim() ? sanitizeUploadFilename(call.filename) : current.file.filename;
      const upload = threshold !== null && payload.data.byteLength > threshold
        ? await runChunkedUpload(
            {
              file: blob,
              filename: uploadName,
              target: { kind: "frame", documentId: payload.fileId, frameToken: call.token },
              idempotencyKey: `${key}:upload`,
              fetch: sessionFetch,
            },
            call.signal,
          ).then((out) => (out.kind === "upload" ? out.upload : null))
        : await client.upload(payload.fileId, blob, uploadName, `${key}:upload`);
      if (!upload) throw malformed("office-frame upload");
      try {
        const doc = await client.commit(payload.fileId, { upload_id: upload.upload_id, base_revision: baseRevision, ...(call.editLockId ? { edit_lock_id: call.editLockId } : {}) }, `${key}:commit`);
        if (!doc || "source_id" in doc) throw malformed("office-frame commit");
        return { ok: true, file: fileMeta(doc), versionId: doc.file.version_id };
      } catch (error) {
        // A stale base is an answer, not a failure: the frame offers to reload.
        if (error instanceof ApiError && error.status === 409) return { ok: false, error: docsFrameError(error).toShape() };
        // 423 document_locked (UNI-1645, addendum §11.1; UNI-1890 at session create) is never
        // {ok:false}: the frame would read it as a stale base and offer "Overwrite". docsFrameError
        // maps it to a 423 forbidden refusal so the host turns it into its lost-lock state.
        throw error;
      }
    }),

    saveAs: (payload, call) => run(async () => {
      const name = ext.test(payload.name) ? payload.name : `${payload.name}.${extension}`;
      const title = name.replace(ext, "");
      const file = new File([payload.data], name, { type: mimeType });
      const key = await operationKey("saveas", [call.workspaceId, name, payload.folderId ?? ""], payload.data);
      // UNI-1847 (D6): the copy lands beside its source - never at the workspace root. A
      // folder the frame's picker chose wins; else the source's own parent; a root document's
      // copy goes into the caller's My Folder (the workspace root is not a folder).
      const parentId = payload.folderId ?? (await saveAsParentId(call));
      const threshold = resolveThreshold(call, options);
      const created = threshold !== null && payload.data.byteLength > threshold
        ? await runChunkedUpload(
            {
              file,
              filename: name,
              target: { kind: "workspace", workspaceId: call.workspaceId, parentId, title },
              idempotencyKey: `${key}:upload`,
              fetch: sessionFetch,
            },
            call.signal,
          ).then((out) => (out.kind === "document" ? out.document : null))
        : await createDocumentFile(
            call.workspaceId,
            file,
            { title, parent_id: parentId },
            { idempotencyKey: key, signal: call.signal },
          );
      if (!created) throw malformed("documents/files");
      const token = await mintOfficeFrameToken(created.id, { signal: call.signal });
      if (!token) throw malformed("office frame-token");
      const opened = await createOfficeFrameClient({ ...options, getToken: () => token.token }).open(created.id);
      if (!opened || "source_id" in opened) throw malformed("office-frame open");
      return { save: { ok: true, file: fileMeta(opened), versionId: opened.file.version_id }, rebind: { documentId: created.id, token } };
    }),

    saveCopy: (payload, call) => run(async () => {
      const name = ext.test(payload.name) ? payload.name : `${payload.name}.${extension}`;
      const key = await operationKey("savecopy", [call.documentId, payload.name], payload.data);
      const upload = await clientFor(call).upload(call.documentId, new Blob([payload.data], { type: mimeType }), name, `${key}:upload`);
      if (!upload) throw malformed("office-frame upload");
      const copied = await copyDocument(
        call.documentId,
        { consent: "copy", upload_id: upload.upload_id, title: payload.name },
        { idempotencyKey: key, signal: call.signal },
      );
      if (!copied) throw malformed("documents/copies");
      return { documentId: copied.id, title: copied.title };
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
    ...(module === "markdown" || module === "html" ? { resolveAssets } : {}),
  };

  /**
   * Relative paths of a Markdown/HTML document -> signed frame URLs, by the same server walk
   * as the open answer's `assets` (CONTRACT A1b): fresh URLs before the open's expire, and the
   * URLs of paths the user typed after the open. Only requested paths and frame routes come back.
   */
  function resolveAssets(payload: ApiAssetsResolvePayload, call: DocsFrameCall): Promise<ApiAssetsResolveResult> {
    return run(async () => {
      if (payload.fileId !== undefined) sameDocument(payload.fileId, call);
      const asked = new Set(payload.paths);
      const resolved = await clientFor(call).resolveAssets(call.documentId, payload.paths);
      const assets: Record<string, string> = {};
      for (const item of resolved.items) {
        if (asked.has(item.path) && isFrameRoute(item.url)) assets[item.path] = item.url;
      }
      return { assets };
    });
  }

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

/**
 * The view-only API of a source file (chat/task/meeting/email attachment,
 * UNI-1869): `open` answers the file's meta and bytes from the `/sources/`
 * subtree; everything that writes, lists or renders is absent (the session's
 * proxy answers `unsupported`, the server would refuse `ofs1.` anyway), and
 * `save` itself answers `unsupported` so a frame asking anyway hears it in
 * its own words.
 */
export function createOfficeFrameSourceApi(module: OfficeModule, options: DocsFrameApiOptions = {}): DocsFrameApi {
  const clientFor = (call: DocsFrameCall): OfficeFrameClient => createOfficeFrameClient({ ...options, scope: "sources", getToken: () => call.token });
  return {
    open: async (payload, call) => {
      try {
        sameDocument(payload.fileId, call);
        const client = clientFor(call);
        const src = await client.open(payload.fileId);
        if (!src || !("source_id" in src)) throw malformed("office-frame source open");
        const bytes = await (await client.content(src.download_url, call.signal)).arrayBuffer();
        // A source has no sibling assets namespace: relative paths of md/html resolve to nothing.
        return { file: fileMeta(src), source: { kind: "bytes", data: bytes } };
      } catch (error) {
        throw error instanceof DocsProtocolError ? error : docsFrameError(error);
      }
    },
    save: async () => {
      throw new DocsProtocolError({ code: "unsupported", message: `${module} sources are view-only`, retryable: false });
    },
  };
}

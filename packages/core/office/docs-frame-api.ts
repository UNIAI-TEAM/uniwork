import { ApiError } from "../api/http";
import {
  createOfficeFrameClient,
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
  type OpenPayload,
  type SaveResult,
  type TokenPayload,
} from "./docs-frame-protocol";

/** A proxied call carries the frame token and the one document it is scoped to. */
export interface DocsFrameCall {
  workspaceId: string;
  documentId: string;
  token: string;
  signal: AbortSignal;
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
  uploadImage(payload: ApiImageUploadPayload, call: DocsFrameCall): Promise<ApiImageUploadResult>;
  saveAs?(payload: ApiSaveAsPayload, call: DocsFrameCall): Promise<SaveResult>;
  export?(payload: ApiExportPayload, call: DocsFrameCall): Promise<ApiExportResult>;
  addAttachments?(payload: ApiAttachmentsAddPayload, call: DocsFrameCall): Promise<ApiAttachmentsAddResult>;
}

/** Same-origin URL of a pinned Docs frame build (served by the web app). */
export function docsFrameSrc(version: string): string {
  return `/office-frame/docs/${encodeURIComponent(version)}/index.html`;
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

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** An API failure (ApiError, network, thrown shape) as the protocol error the frame understands. */
export function docsFrameError(error: unknown): DocsProtocolError {
  if (error instanceof ApiError) {
    const mapped = errorFromHttpStatus(error.status, error.message);
    return new DocsProtocolError({ ...mapped.toShape(), details: { apiCode: error.code } });
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

/** The token opens exactly one document; anything else is refused before a round trip. */
function sameDocument(fileId: string, call: DocsFrameCall): void {
  if (fileId !== call.documentId) {
    throw new DocsProtocolError({ code: "forbidden", message: "the frame token is scoped to another document", status: 403 });
  }
}

function newKey(): string {
  return globalThis.crypto.randomUUID();
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
 * Save-as, export and attachments have no route yet and answer `unsupported`.
 */
export function createDocsFrameApi(options: DocsFrameApiOptions = {}): DocsFrameApi {
  const clientFor = (call: DocsFrameCall): OfficeFrameClient => createOfficeFrameClient({ ...options, getToken: () => call.token });
  const absolute = (url: string) => (url.startsWith("/") ? `${options.apiUrl ?? runtimeConfig().apiUrl}${url}` : url);
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
      return { file: fileMeta(doc), source: { kind: "bytes", data: bytes } };
    }),

    save: (payload, call) => run(async () => {
      sameDocument(payload.fileId, call);
      const client = clientFor(call);
      let baseRevision = payload.etag;
      let filename: string | undefined;
      if (!baseRevision) {
        const current = await client.open(payload.fileId);
        if (!current) throw malformed("office-frame open");
        baseRevision = current.revision;
        filename = current.file.filename;
      }
      const key = newKey();
      const upload = await client.upload(payload.fileId, new Blob([payload.data], { type: DOCX_MIME }), filename ?? `${payload.fileId}.docx`, `${key}:upload`);
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

    recents: (payload, call) => run(async () => {
      const recents = await clientFor(call).recents(call.documentId, payload.limit);
      return {
        files: recents.items.map((item) => {
          const modifiedAt = item.updated_at ? Date.parse(item.updated_at) : Number.NaN;
          return { fileId: item.document_id, name: item.title, ...(Number.isFinite(modifiedAt) ? { modifiedAt } : {}) };
        }),
      };
    }),

    uploadImage: (payload, call) => run(async () => {
      const asset = await clientFor(call).uploadAsset(call.documentId, new Blob([payload.data], { type: payload.mimeType }), payload.name, newKey());
      if (!asset) throw malformed("office-frame assets");
      return { imageId: asset.asset_id, url: absolute(asset.url) };
    }),
  };
}

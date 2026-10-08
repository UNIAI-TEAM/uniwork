import { ApiError } from "@uniwork/core/api/http";
import {
  createOfficeFrameClient,
  mintOfficeFrameToken,
  type OfficeFrameClient,
  type OfficeFrameDocument,
} from "@uniwork/core/api/endpoints/office-frame";
import type { DocsFrameApi, DocsFrameCall } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, errorFromHttpStatus, type FileMeta } from "@uniwork/core/office/docs-frame-protocol";

// The web host's DocsFrameApi (UNI-1013): answers the frame's `api.*` requests
// with the document-scoped frame token, through the /api/v1/office-frame client
// in packages/core. Every call carries the token minted for this one document;
// the session token and cookies never reach it. Operations the lane has no
// server endpoint for (save-as, export, attachments) refuse with a typed
// `unsupported` instead of pretending.

const DOCX_FALLBACK_NAME = "document.docx";

function fileMeta(doc: OfficeFrameDocument): FileMeta {
  const modifiedAt = doc.updated_at ? Date.parse(doc.updated_at) : Number.NaN;
  return {
    fileId: doc.file.file_id,
    name: doc.file.filename,
    sizeBytes: doc.file.size_bytes,
    mimeType: doc.file.mime_type,
    versionId: doc.file.version_id,
    // The document revision is the concurrency token: it is what a commit names as its base.
    etag: doc.revision,
    ...(Number.isNaN(modifiedAt) ? {} : { modifiedAt }),
    writable: doc.can_edit,
  };
}

/** An ApiError becomes the typed error the frame receives; a stale base keeps the current revision. */
function asProtocolError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  const mapped = errorFromHttpStatus(error.status, error.message);
  const current = error.fields?.["current_revision"];
  if (current === undefined) return mapped;
  return new DocsProtocolError({ ...mapped.toShape(), details: { currentRevision: current } });
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asProtocolError(error);
  }
}

function unsupported(what: string): DocsProtocolError {
  return new DocsProtocolError({ code: "unsupported", message: `${what} is not available in the web editor yet` });
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new DocsProtocolError({ code: "internal", message: `${what} answered with an unreadable body` });
  return value;
}

export function createDocsFrameApi(): DocsFrameApi {
  const clientFor = (call: DocsFrameCall): OfficeFrameClient => createOfficeFrameClient({ getToken: () => call.token });
  // The save names the stored file; remember what open answered for it.
  const names = new Map<string, string>();

  return {
    mintToken: ({ documentId }) => guarded(async () => {
      const minted = required(await mintOfficeFrameToken(documentId), "frame token");
      return { token: minted.token, tokenExpiresAt: Date.parse(minted.expires_at) };
    }),

    open: (_payload, call) => guarded(async () => {
      const client = clientFor(call);
      const doc = required(await client.open(call.documentId), "open");
      names.set(call.documentId, doc.file.filename);
      const bytes = await (await client.content(doc.download_url, call.signal)).arrayBuffer();
      return { file: fileMeta(doc), source: { kind: "bytes", data: bytes } };
    }),

    save: (payload, call) => guarded(async () => {
      const client = clientFor(call);
      let baseRevision = payload.etag;
      if (!baseRevision) {
        const current = required(await client.open(call.documentId), "open");
        names.set(call.documentId, current.file.filename);
        baseRevision = current.revision;
      }
      // One key per save attempt: a retry of the same bytes finds the same upload and version.
      const key = `docs-frame-${call.documentId}-${baseRevision}-${payload.data.byteLength}`;
      const upload = required(
        await client.upload(call.documentId, new Blob([payload.data]), names.get(call.documentId) ?? DOCX_FALLBACK_NAME, `${key}-upload`),
        "upload",
      );
      const saved = required(await client.commit(call.documentId, { upload_id: upload.upload_id, base_revision: baseRevision }, `${key}-commit`), "commit");
      return { ok: true, file: fileMeta(saved), versionId: saved.file.version_id };
    }),

    saveAs: () => Promise.reject(unsupported("Save as")),

    recents: ({ limit }, call) => guarded(async () => {
      const { items } = await clientFor(call).recents(call.documentId, limit);
      return {
        files: items.map((item): FileMeta => {
          const modifiedAt = item.updated_at ? Date.parse(item.updated_at) : Number.NaN;
          return { fileId: item.document_id, name: item.title, ...(Number.isNaN(modifiedAt) ? {} : { modifiedAt }) };
        }),
      };
    }),

    export: () => Promise.reject(unsupported("Export")),

    addAttachments: ({ files }) => Promise.resolve({ accepted: [], rejected: files.map((file) => `${file.name}: attachments are not available in the web editor yet`) }),

    uploadImage: (payload, call) => guarded(async () => {
      const asset = required(await clientFor(call).uploadAsset(call.documentId, new Blob([payload.data], { type: payload.mimeType }), payload.name), "image upload");
      return { imageId: asset.asset_id, url: asset.url };
    }),
  };
}

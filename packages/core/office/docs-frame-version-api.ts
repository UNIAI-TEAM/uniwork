import { getDocumentVersion } from "../api/endpoints/documents-versions";
import { createOfficeFrameClient } from "../api/endpoints/office-frame";
import { DocsProtocolError, type OfficeModule } from "./docs-frame-protocol";
import { docsFrameError, fileMeta, malformed, sameDocument, type DocsFrameApi, type DocsFrameApiOptions } from "./docs-frame-api";

/**
 * The view-only API of one stored version of a document (UNI-2033): the same document token as a
 * normal open, but `open` answers the bytes of `?version=N` and the meta of that version, and
 * nothing writes, lists or renders (absent methods answer `unsupported`, as for a source).
 * An N the document does not have answers `not_found`, which the page shows as "version not
 * available" with the way back to the current one.
 */
export function createVersionFrameApi(module: OfficeModule, versionNo: number, options: DocsFrameApiOptions = {}): DocsFrameApi {
  return {
    open: async (payload, call) => {
      try {
        sameDocument(payload.fileId, call);
        const client = createOfficeFrameClient({ ...options, getToken: () => call.token });
        // Name and type come from the document; size and id from the version the frame shows.
        const doc = await client.open(payload.fileId);
        if (!doc || "source_id" in doc) throw malformed("office-frame open");
        const version = await getDocumentVersion(payload.fileId, versionNo, call.signal);
        if (!version) throw new DocsProtocolError({ code: "not_found", message: `version ${versionNo} not found`, status: 404 });
        const bytes = await (await client.content(`/api/v1/office-frame/documents/${encodeURIComponent(payload.fileId)}/content?version=${versionNo}`, call.signal)).arrayBuffer();
        return { file: { ...fileMeta(doc), versionId: version.id, sizeBytes: bytes.byteLength, writable: false }, source: { kind: "bytes", data: bytes } };
      } catch (error) {
        throw error instanceof DocsProtocolError ? error : docsFrameError(error);
      }
    },
    save: async () => {
      throw new DocsProtocolError({ code: "unsupported", message: `${module} version view is read-only`, retryable: false });
    },
  };
}

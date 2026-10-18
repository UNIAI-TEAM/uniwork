import { chunkedUploadThreshold } from "@uniwork/core/documents/chunked-upload";
import { docsFrameError, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { ApiHandlers } from "@uniwork/core/office/docs-frame-host";
import { DocsProtocolError, type FrameRequests, type TokenPayload } from "@uniwork/core/office/docs-frame-protocol";
import { readOnly, type DocsFrameSessionOptions } from "./docs-frame-session-model";

/** The session values one proxied `api.*` call reads, live (the session's `latest` ref). */
export interface FrameApiProxyState {
  options: Pick<DocsFrameSessionOptions, "api" | "wsId" | "onSourceWriteRefused">;
  scopeId: string;
  viewOnly: boolean;
  copyRefused: boolean;
  isSource: boolean;
  editLockId: string | undefined;
  documentLimits: Parameters<typeof chunkedUploadThreshold>[0];
  /** The name the first-save dialog wrote for this document (UNI-1847): the next save's upload carries it as filename. */
  renameName?: { id: string; name: string };
}
/**
 * Builds the `api.*` proxy of one frame endpoint: a write refuses a read-only viewer, the
 * call runs on the page's `DocsFrameApi` with the minted frame token, and any failure
 * reaches the frame as a protocol error.
 */
export function createFrameApiProxy(latest: { current: FrameApiProxyState }, currentToken: () => Promise<TokenPayload>) {
  return <K extends keyof ApiHandlers>(type: K, write: boolean, pick: (api: DocsFrameApi) => ((payload: never, call: never) => Promise<unknown>) | undefined) =>
    async (payload: FrameRequests[K]["payload"], { signal }: { signal: AbortSignal }) => {
      const { options: current, scopeId: doc, viewOnly: refused, copyRefused: noCopy, isSource: source, editLockId: lockId, documentLimits: limits, renameName } = latest.current;
      if ((write || (source && type === "api.export")) && (type === "api.saveCopy" ? noCopy : refused)) {
        if (source) current.onSourceWriteRefused?.(type === "api.export" ? "export" : "write");
        throw readOnly(type);
      }
      const run = pick(current.api);
      if (!run) throw new DocsProtocolError({ code: "unsupported", message: `${type} is not available on the web yet` });
      const { token: frameToken } = await currentToken();
      const threshold = chunkedUploadThreshold(limits);
      try {
        return (await run.call(current.api, payload as never, {
          workspaceId: current.wsId, documentId: doc, token: frameToken, signal,
          ...(lockId && type !== "api.saveCopy" ? { editLockId: lockId } : {}),
          // A document the first-save dialog named uploads under that name (S01-V3).
          ...(renameName?.id === doc && type === "api.save" ? { filename: renameName.name } : {}),
          ...(threshold !== null ? { chunkedUploadThresholdBytes: threshold } : {}),
        } as never)) as FrameRequests[K]["result"];
      } catch (error) {
        throw error instanceof DocsProtocolError ? error : docsFrameError(error);
      }
    };
}

import { useQuery } from "@tanstack/react-query";
import { runtimeConfig } from "../runtime-config";
import type {
  ApiAttachmentsAddPayload,
  ApiAttachmentsAddResult,
  ApiExportPayload,
  ApiExportResult,
  ApiImageUploadPayload,
  ApiImageUploadResult,
  ApiOpenPayload,
  ApiRecentsPayload,
  ApiRecentsResult,
  ApiSaveAsPayload,
  ApiSavePayload,
  OpenPayload,
  SaveResult,
  TokenPayload,
} from "./docs-frame-protocol";

/** The document a frame token is scoped to (server-minted, never a cookie). */
export interface DocsFrameScope {
  workspaceId: string;
  documentId: string;
}

/** A proxied call carries the frame token it was made under. */
export interface DocsFrameCall extends DocsFrameScope {
  token: string;
  signal: AbortSignal;
}

/**
 * What the Docs frame host needs from the UniWork API (W6, lane GO-B2+B3).
 * The host injects an implementation built on the `api/endpoints` functions
 * and hooks; this module never talks to the transport itself. Each method
 * answers one `api.*` frame request and may throw a `DocsProtocolError`
 * (e.g. `errorFromHttpStatus`) that the frame receives as a typed error.
 */
export interface DocsFrameApi {
  mintToken(scope: DocsFrameScope): Promise<TokenPayload>;
  open(payload: ApiOpenPayload, call: DocsFrameCall): Promise<OpenPayload>;
  save(payload: ApiSavePayload, call: DocsFrameCall): Promise<SaveResult>;
  saveAs(payload: ApiSaveAsPayload, call: DocsFrameCall): Promise<SaveResult>;
  recents(payload: ApiRecentsPayload, call: DocsFrameCall): Promise<ApiRecentsResult>;
  export(payload: ApiExportPayload, call: DocsFrameCall): Promise<ApiExportResult>;
  addAttachments(payload: ApiAttachmentsAddPayload, call: DocsFrameCall): Promise<ApiAttachmentsAddResult>;
  uploadImage(payload: ApiImageUploadPayload, call: DocsFrameCall): Promise<ApiImageUploadResult>;
}

export const officeDocsFrameKeys = {
  all: ["office-docs-frame"] as const,
  token: (wsId: string, documentId: string) => [...officeDocsFrameKeys.all, wsId, "token", documentId] as const,
};

/** Same-origin URL of a pinned Docs frame build (served by the web app). */
export function docsFrameSrc(version: string): string {
  return `/office-frame/docs/${encodeURIComponent(version)}/index.html`;
}

/** `apiBase` of the init message; informational while the frame uses host-proxy mode. */
export function docsFrameApiBase(): string {
  return `${runtimeConfig().apiUrl}/api/v1`;
}

const MIN_REFRESH_MS = 5_000;
const MAX_LEAD_MS = 60_000;

/**
 * When to mint the next token: a minute before expiry, or half the remaining
 * life for a token that lives less than two minutes, never sooner than 5s.
 */
export function docsFrameTokenRefreshIn(tokenExpiresAt: number, now: number): number {
  const remaining = tokenExpiresAt - now;
  return Math.max(MIN_REFRESH_MS, remaining - Math.min(MAX_LEAD_MS, remaining / 2));
}

/**
 * The frame token for one document, minted through the injected API and
 * re-minted before it expires. Tokens are never kept after the frame unmounts.
 */
export function useDocsFrameToken(api: DocsFrameApi, wsId: string, documentId: string) {
  return useQuery({
    queryKey: officeDocsFrameKeys.token(wsId, documentId),
    queryFn: () => api.mintToken({ workspaceId: wsId, documentId }),
    gcTime: 0,
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data ? docsFrameTokenRefreshIn(data.tokenExpiresAt, Date.now()) : false;
    },
  });
}

"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { documentKeys } from "@uniwork/core/documents/keys";
import { officeFrameKeys, useOfficeFrameToken } from "@uniwork/core/documents/office-frame-hooks";
import type { OfficeFrameToken } from "@uniwork/core/api/endpoints/office-frame";
import { docsFrameApiBase, docsFrameError, docsFrameToken, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { createDocsFrameHost, type ApiHandlers, type DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import {
  DocsProtocolError,
  type Capabilities,
  type FrameRequests,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
  type TokenPayload,
} from "@uniwork/core/office/docs-frame-protocol";

export type DocsFrameStatus = "booting" | "ready" | "failed";

export interface DocsFrameSessionOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Exact origin of the frame document. */
  frameOrigin: string;
  api: DocsFrameApi;
  wsId: string;
  documentId: string;
  readonly: boolean;
  locale: string;
  theme: Theme;
  onTitle?: (title: string) => void;
  onSaved?: (saved: SavedPayload) => void;
  /** Non-fatal frame or proxy errors the user should hear about. */
  onError: (error: ProtocolErrorShape) => void;
}

export interface DocsFrameSession {
  status: DocsFrameStatus;
  /** Why the session failed: a token that could not be minted, or a fatal frame error. */
  failure: ProtocolErrorShape | null;
  dirty: boolean;
  /** Content height the frame last reported, in CSS px. */
  height: number | null;
  /** Ask the frame to save (leave dialog). Resolves true once the bytes are a new version. */
  save: (reason: "user" | "navigate") => Promise<boolean>;
  print: () => Promise<boolean>;
  /** Changes on every retry; key the iframe with it so the frame reloads. */
  attempt: number;
  /** Re-mint a token that failed and reload the frame. */
  retry: () => void;
}

/** Capabilities this host grants. AI stays off on the web (GO-D2); routes that do not exist yet stay off too. */
export function docsFrameCapabilities(readonly: boolean, api: DocsFrameApi): Capabilities {
  return {
    save: !readonly, saveAs: !readonly && Boolean(api.saveAs), recents: true, print: true,
    exportPdf: Boolean(api.export), exportHtml: Boolean(api.export),
    attachments: !readonly && Boolean(api.addAttachments), images: !readonly, ai: false,
  };
}

const unauthorized = () => new DocsProtocolError({ code: "unauthorized", message: "frame token unavailable" });
const readOnly = (type: string) => new DocsProtocolError({ code: "forbidden", message: `${type} is not allowed for a read-only viewer`, status: 403 });

const shapeOf = (error: unknown): ProtocolErrorShape => docsFrameError(error).toShape();

/**
 * The host half of one Docs frame on the vendored protocol host: the token
 * handoff (`init`, `token.update` before expiry, `token.refresh`), the
 * `api.*` proxy, and the dirty / title / theme / language / resize wiring.
 */
export function useDocsFrameSession(options: DocsFrameSessionOptions): DocsFrameSession {
  const { iframeRef, frameOrigin, wsId, documentId, locale, theme } = options;
  const [attempt, setAttempt] = useState(0);
  const queryClient = useQueryClient();
  const tokenQuery = useOfficeFrameToken(wsId, documentId);
  const token = tokenQuery.data ? docsFrameToken(tokenQuery.data) : null;
  const [status, setStatus] = useState<DocsFrameStatus>("booting");
  const [fatal, setFatal] = useState<ProtocolErrorShape | null>(null);
  const [dirty, setDirty] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [host, setHost] = useState<DocsFrameHost | null>(null);

  // Latest values for callbacks that live as long as the endpoint.
  const latest = useRef({ options, token, refetch: tokenQuery.refetch });
  latest.current = { options, token, refetch: tokenQuery.refetch };
  const sentToken = useRef<string | null>(null);

  useEffect(() => {
    setStatus("booting");
    setFatal(null);
    setDirty(false);
    sentToken.current = null;

    const currentToken = async (): Promise<TokenPayload> => {
      const { wsId: ws, documentId: doc } = latest.current.options;
      // The cache may hold a token this render has not seen yet.
      const cached = queryClient.getQueryData<OfficeFrameToken | null>(officeFrameKeys.token(ws, doc));
      if (cached) return docsFrameToken(cached);
      // The first mint may still be in flight: join it rather than mint twice.
      const { data } = await latest.current.refetch({ cancelRefetch: false });
      if (!data) throw unauthorized();
      return docsFrameToken(data);
    };
    const proxy = <K extends keyof ApiHandlers>(type: K, write: boolean, pick: (api: DocsFrameApi) => ((payload: never, call: never) => Promise<unknown>) | undefined) =>
      async (payload: FrameRequests[K]["payload"], { signal }: { signal: AbortSignal }) => {
        const { options: current } = latest.current;
        if (write && current.readonly) throw readOnly(type);
        const run = pick(current.api);
        if (!run) throw new DocsProtocolError({ code: "unsupported", message: `${type} is not available on the web yet` });
        const { token: frameToken } = await currentToken();
        return run.call(current.api, payload as never, { workspaceId: current.wsId, documentId: current.documentId, token: frameToken, signal } as never) as Promise<FrameRequests[K]["result"]>;
      };

    const endpoint = createDocsFrameHost({
      self: window,
      frame: () => iframeRef.current?.contentWindow ?? null,
      allowedOrigins: [frameOrigin],
      getInit: async () => {
        const frameToken = await currentToken();
        sentToken.current = frameToken.token;
        const { options: current } = latest.current;
        return {
          ...frameToken,
          documentId: current.documentId, workspaceId: current.wsId,
          apiBase: docsFrameApiBase(), apiMode: "host-proxy",
          locale: current.locale, theme: current.theme,
          capabilities: docsFrameCapabilities(current.readonly, current.api),
        };
      },
      refreshToken: async () => {
        const { data } = await latest.current.refetch();
        if (!data) throw unauthorized();
        const fresh = docsFrameToken(data);
        sentToken.current = fresh.token;
        return fresh;
      },
      api: {
        "api.open": proxy("api.open", false, (api) => api.open),
        "api.save": proxy("api.save", true, (api) => api.save),
        "api.saveAs": proxy("api.saveAs", true, (api) => api.saveAs),
        "api.recents": proxy("api.recents", false, (api) => api.recents),
        "api.export": proxy("api.export", false, (api) => api.export),
        "api.attachments.add": proxy("api.attachments.add", true, (api) => api.addAttachments),
        "api.images.upload": proxy("api.images.upload", true, (api) => api.uploadImage),
      },
      onInitialized: () => { setStatus((now) => (now === "failed" ? now : "ready")); },
      onHandshakeError: (error) => {
        if (error.code === "cancelled") return;
        setFatal(error.toShape());
        setStatus("failed");
      },
    });

    endpoint.on("dirty", ({ dirty: next }) => { setDirty(next); });
    endpoint.on("title", ({ title }) => { latest.current.options.onTitle?.(title); });
    endpoint.on("resize", ({ height: next }) => { setHeight(next); });
    endpoint.on("saved", (saved) => {
      const { wsId: ws, documentId: doc, onSaved } = latest.current.options;
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, doc) });
      onSaved?.(saved);
    });
    endpoint.on("error", ({ error, fatal: isFatal }) => {
      if (isFatal) { setFatal(error); setStatus("failed"); }
      latest.current.options.onError(error);
    });
    setHost(endpoint);
    return () => { endpoint.dispose(); setHost(null); };
  }, [attempt, documentId, frameOrigin, iframeRef, queryClient, wsId]);

  // Proactive rotation: a re-minted token reaches the frame before the old one expires.
  const tokenValue = token?.token;
  useEffect(() => {
    const current = latest.current.token;
    if (!host || !current || sentToken.current === null || sentToken.current === current.token) return;
    sentToken.current = current.token;
    host.pushToken(current);
  }, [host, tokenValue]);

  // No-ops until the handshake; `getInit` reads the values current at that moment.
  useEffect(() => { host?.setTheme(theme); }, [host, theme]);
  useEffect(() => { host?.setLanguage(locale); }, [host, locale]);

  const save = useCallback(async (reason: "user" | "navigate") => {
    if (!host) return false;
    try {
      const result = await host.save({ reason });
      if (result.ok) return true;
      latest.current.options.onError(result.error);
      return false;
    } catch (error) {
      latest.current.options.onError(shapeOf(error));
      return false;
    }
  }, [host]);

  const print = useCallback(async () => {
    if (!host) return false;
    try {
      return (await host.print({ mode: "dialog" }, { timeoutMs: 10 * 60_000 })).printed;
    } catch (error) {
      latest.current.options.onError(shapeOf(error));
      return false;
    }
  }, [host]);

  const tokenFailure = !token && (tokenQuery.isError || (tokenQuery.isSuccess && tokenQuery.data === null))
    ? shapeOf(tokenQuery.error ?? unauthorized())
    : null;
  const failure = fatal ?? tokenFailure;
  const refetchToken = tokenQuery.refetch;
  const retry = useCallback(() => {
    if (tokenFailure) void refetchToken();
    setAttempt((n) => n + 1);
  }, [refetchToken, tokenFailure]);
  return { status: failure ? "failed" : status, failure, dirty, height, save, print, attempt, retry };
}

"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { documentKeys } from "@uniwork/core/documents/keys";
import { docsFrameApiBase, useDocsFrameToken, type DocsFrameApi, type DocsFrameCall } from "@uniwork/core/office/docs-frame-api";
import { createDocsFrameHost, type DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import {
  DocsProtocolError,
  PROTOCOL_VERSION,
  type Capabilities,
  type ErrorEventPayload,
  type FrameRequestType,
  type InitAck,
  type InitPayload,
  type PrintPayload,
  type ProtocolErrorShape,
  type SavedPayload,
  type SaveResult,
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
  /** Bumped by a retry: tears the endpoint down and waits for a new `ready`. */
  attempt: number;
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
}

/** Capabilities this host grants. AI stays off on the web (GO-D2). */
export function docsFrameCapabilities(readonly: boolean): Capabilities {
  return {
    save: !readonly, saveAs: !readonly, recents: true, print: true,
    exportPdf: true, exportHtml: true, attachments: !readonly, images: !readonly, ai: false,
  };
}

/** Frame requests that write; refused here for a read-only viewer whatever the frame asks. */
const WRITE_REQUESTS = new Set<FrameRequestType>(["api.save", "api.saveAs", "api.attachments.add", "api.images.upload"]);

type ApiHandler = (api: DocsFrameApi, payload: never, call: DocsFrameCall) => Promise<unknown>;
const API_HANDLERS: Record<Exclude<FrameRequestType, "token.refresh">, ApiHandler> = {
  "api.open": (api, payload, call) => api.open(payload, call),
  "api.save": (api, payload, call) => api.save(payload, call),
  "api.saveAs": (api, payload, call) => api.saveAs(payload, call),
  "api.recents": (api, payload, call) => api.recents(payload, call),
  "api.export": (api, payload, call) => api.export(payload, call),
  "api.attachments.add": (api, payload, call) => api.addAttachments(payload, call),
  "api.images.upload": (api, payload, call) => api.uploadImage(payload, call),
};

function shapeOf(error: unknown): ProtocolErrorShape {
  if (error instanceof DocsProtocolError) return error.toShape();
  return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}

/**
 * The host half of one Docs frame: the postMessage endpoint, the token handoff
 * (`init`, then `token.update` before expiry and on `token.refresh`), the
 * `api.*` proxy and the dirty / title / theme / language / resize wiring.
 */
export function useDocsFrameSession(options: DocsFrameSessionOptions): DocsFrameSession {
  const { iframeRef, frameOrigin, wsId, documentId, readonly, locale, theme, attempt } = options;
  const queryClient = useQueryClient();
  const tokenQuery = useDocsFrameToken(options.api, wsId, documentId);
  const [frameReady, setFrameReady] = useState(false);
  const [status, setStatus] = useState<DocsFrameStatus>("booting");
  const [fatal, setFatal] = useState<ProtocolErrorShape | null>(null);
  const [dirty, setDirty] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [host, setHost] = useState<DocsFrameHost | null>(null);

  // Latest values for handlers that live as long as the endpoint.
  const latest = useRef({ options, token: tokenQuery.data, refetch: tokenQuery.refetch });
  latest.current = { options, token: tokenQuery.data, refetch: tokenQuery.refetch };
  const sentToken = useRef<string | null>(null);
  const sentLook = useRef<{ locale: string; theme: Theme } | null>(null);

  useEffect(() => {
    setFrameReady(false);
    setStatus("booting");
    setFatal(null);
    setDirty(false);
    sentToken.current = null;
    sentLook.current = null;
    const endpoint = createDocsFrameHost({
      self: window,
      peer: () => iframeRef.current?.contentWindow ?? null,
      allowedOrigins: [frameOrigin],
    });

    endpoint.handle("token.refresh", async () => {
      const { data, error } = await latest.current.refetch();
      if (!data) throw error ?? new DocsProtocolError({ code: "unauthorized", message: "frame token unavailable" });
      sentToken.current = data.token;
      return data satisfies TokenPayload;
    });
    for (const [type, run] of Object.entries(API_HANDLERS) as [FrameRequestType, ApiHandler][]) {
      endpoint.handle(type, async (payload, { signal }) => {
        const { options: current, token } = latest.current;
        if (current.readonly && WRITE_REQUESTS.has(type)) {
          throw new DocsProtocolError({ code: "forbidden", message: `${type} is not allowed for a read-only viewer` });
        }
        if (!token) throw new DocsProtocolError({ code: "unauthorized", message: "frame token unavailable" });
        return run(current.api, payload as never, { workspaceId: current.wsId, documentId: current.documentId, token: token.token, signal });
      });
    }

    endpoint.on("ready", () => { setFrameReady(true); });
    endpoint.on("dirty", (payload) => { setDirty((payload as { dirty: boolean }).dirty); });
    endpoint.on("title", (payload) => { latest.current.options.onTitle?.((payload as { title: string }).title); });
    endpoint.on("resize", (payload) => { setHeight((payload as { height: number }).height); });
    endpoint.on("saved", (payload) => {
      const { wsId: ws, documentId: doc, onSaved } = latest.current.options;
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, doc) });
      onSaved?.(payload as SavedPayload);
    });
    endpoint.on("error", (payload) => {
      const { error, fatal: isFatal } = payload as ErrorEventPayload;
      if (isFatal) { setFatal(error); setStatus("failed"); }
      latest.current.options.onError(error);
    });
    setHost(endpoint);
    return () => { endpoint.dispose(); setHost(null); };
  }, [attempt, documentId, frameOrigin, iframeRef, queryClient, wsId]);

  // Handshake: once the frame is listening and a token exists, `init` once.
  const token = tokenQuery.data;
  useEffect(() => {
    if (!host || !frameReady || !token || sentToken.current !== null) return;
    const { options: current } = latest.current;
    const init: InitPayload = {
      protocolVersion: PROTOCOL_VERSION,
      token: token.token, tokenExpiresAt: token.tokenExpiresAt,
      documentId: current.documentId, workspaceId: current.wsId,
      apiBase: docsFrameApiBase(), apiMode: "host-proxy",
      locale: current.locale, theme: current.theme,
      capabilities: docsFrameCapabilities(current.readonly),
    };
    sentToken.current = token.token;
    sentLook.current = { locale: current.locale, theme: current.theme };
    host.request<InitAck>("init", init).then(
      () => { setStatus((now) => (now === "failed" ? now : "ready")); },
      (error: unknown) => {
        if (shapeOf(error).code === "cancelled") return;
        setFatal(shapeOf(error));
        setStatus("failed");
      },
    );
  }, [host, frameReady, token]);

  // Proactive rotation: a re-minted token reaches the frame before the old one expires.
  useEffect(() => {
    if (!host || !token || sentToken.current === null || sentToken.current === token.token) return;
    sentToken.current = token.token;
    host.emit("token.update", { token: token.token, tokenExpiresAt: token.tokenExpiresAt } satisfies TokenPayload);
  }, [host, token]);

  useEffect(() => {
    const sent = sentLook.current;
    if (!host || !sent) return;
    if (sent.theme !== theme) host.emit("theme", { theme });
    if (sent.locale !== locale) host.emit("language", { locale });
    sentLook.current = { locale, theme };
  }, [host, locale, theme, status]);

  const save = useCallback(async (reason: "user" | "navigate") => {
    if (!host) return false;
    try {
      const result = await host.request<SaveResult>("save", { reason });
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
      const result = await host.request<{ printed: boolean }>("print", { mode: "dialog" } satisfies PrintPayload, { timeoutMs: 10 * 60_000 });
      return result.printed;
    } catch (error) {
      latest.current.options.onError(shapeOf(error));
      return false;
    }
  }, [host]);

  const tokenFailure = tokenQuery.isError && !token ? shapeOf(tokenQuery.error) : null;
  const failure = fatal ?? tokenFailure;
  return { status: failure ? "failed" : status, failure, dirty, height, save, print };
}

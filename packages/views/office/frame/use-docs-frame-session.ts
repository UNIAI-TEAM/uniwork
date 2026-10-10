"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { documentKeys } from "@uniwork/core/documents/keys";
import { officeFrameKeys, useOfficeFrameToken } from "@uniwork/core/documents/office-frame-hooks";
import type { OfficeFrameAIGrant, OfficeFrameToken } from "@uniwork/core/api/endpoints/office-frame";
import { docsFrameApiBase, docsFrameError, docsFrameToken, type DocsFrameApi, type DocsFrameSavedAs } from "@uniwork/core/office/docs-frame-api";
import { createDocsFrameHost, type ApiHandlers, type DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import {
  DocsProtocolError,
  type AppOpenResult,
  type Capabilities,
  type FrameRequests,
  type OfficeModule,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
  type TokenPayload,
} from "@uniwork/core/office/docs-frame-protocol";
import { getOfficeDraftKey, officeDraftScope } from "@uniwork/core/office/draft-session-key";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";

/**
 * No handshake within this long = the bundle never loaded, and the page falls back to the G3
 * editor. A frame that hangs is far more common than one that needs longer (a normal open
 * completes in a few seconds), and a minute of bare skeleton reads as a dead page; 25 s keeps
 * room for a cold start on a slow link while the slow state below explains the wait from 8 s on.
 */
const BOOT_TIMEOUT_MS = 25_000;

/** No handshake yet after this long: the page says the editor is taking longer than usual. */
const SLOW_AFTER_MS = 8_000;

/**
 * `details.frameBundle` on a session failure: the frame document itself could not be loaded
 * (`missing`: 404/5xx on index.html), one of its scripts did not load (`script`), or it never
 * completed the handshake in time (`timeout`).
 */
export type DocsFrameBundleFailure = "missing" | "script" | "timeout";

export type DocsFrameStatus = "booting" | "ready" | "failed";

/** What the page header says about the frame's edits: driven by its dirty / saved events and the save proxy. */
export type DocsFrameSaveState = "ready" | "dirty" | "saving" | "saved" | "error";

export interface DocsFrameSessionOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Exact origin of the frame document. */
  frameOrigin: string;
  /** URL of the frame document; probed once per attempt so a missing bundle (404/5xx) fails fast. */
  frameSrc?: string;
  /** How long the frame may take to complete its handshake before the open counts as failed. */
  bootTimeoutMs?: number;
  /** How long before an open that has not completed its handshake counts as slow (`slow`). */
  slowAfterMs?: number;
  api: DocsFrameApi;
  /**
   * The document's genoffice module (default docs). The host refuses a frame
   * whose `ready.module` differs (`malformed`) and grants this module's
   * capabilities.
   */
  module?: OfficeModule;
  wsId: string;
  documentId: string;
  readonly: boolean;
  locale: string;
  theme: Theme;
  onTitle?: (title: string) => void;
  onSaved?: (saved: SavedPayload) => void;
  /** The frame saved a copy: it now edits that new document (the page may follow it). */
  onSavedAs?: (documentId: string, name: string) => void;
  /** Names a save-as copy before it is created (the frame asks with the source's own name). */
  copyName?: (name: string) => string;
  /** Non-fatal frame or proxy errors the user should hear about. */
  onError: (error: ProtocolErrorShape) => void;
  /**
   * The page's "Open in desktop app" flow, answering the frame's `app.open`. Present = the host grants
   * `desktopOpen` (to a user who may edit); absent = the frame shows its "use the app" message alone.
   */
  onAppOpen?: () => Promise<AppOpenResult["outcome"]>;
}

export interface DocsFrameSession {
  status: DocsFrameStatus;
  /** Still booting after `slowAfterMs`: the page explains the wait instead of showing a bare skeleton. */
  slow: boolean;
  /**
   * The page's readonly, or (a module other than Docs) a minted token that
   * cannot edit: writes are refused in the host and desktop-open is hidden.
   */
  viewOnly: boolean;
  /** Why the session failed: a token that could not be minted, or a fatal frame error. */
  failure: ProtocolErrorShape | null;
  dirty: boolean;
  saveState: DocsFrameSaveState;
  /** The frame shows one of its own dialogs (its `modal` event); the page dims its chrome meanwhile. */
  modal: boolean;
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

/**
 * Capabilities this host grants. Routes that do not exist yet stay off.
 * `exportPdf` follows the API alone: nothing tells the host whether this
 * deployment has a PDF renderer, so it is offered and a 501 answers
 * `unsupported`, on which the frame prints in place instead. Each module
 * starts from its grant (`officeModuleSpec(module).grant`, one table the
 * module workers fill in), narrowed by readonly and by what the API
 * implements. A key the grant leaves out is off. AI (CONTRACT C16) is on only
 * for a module with AI panels (`officeModuleSpec(module).ai`) and only as far
 * as the minted token's `ai` grant says (the organization's entitlement, read
 * by the server at mint); each cloud tool needs `ai` too. The frame then calls
 * the frame-token AI routes itself; a viewer keeps AI (it never saves).
 */
export function officeModuleCapabilities(module: OfficeModule, readonly: boolean, api: DocsFrameApi, aiGrant?: OfficeFrameAIGrant, desktopOpen = false): Capabilities {
  const spec = officeModuleSpec(module);
  const grant = spec.grant;
  const on = (key: keyof Capabilities) => grant[key] === true;
  const ai = spec.ai === true && aiGrant?.ai === true;
  return {
    ...grant,
    save: on("save") && !readonly, saveAs: on("saveAs") && !readonly && Boolean(api.saveAs), recents: on("recents"), print: on("print"),
    exportPdf: on("exportPdf") && Boolean(api.export), exportHtml: on("exportHtml"),
    attachments: on("attachments") && !readonly && Boolean(api.addAttachments), images: on("images") && !readonly,
    ai, webSearch: ai && aiGrant?.web_search === true, imageSearch: ai && aiGrant?.image_search === true,
    imageGeneration: ai && aiGrant?.image_generation === true,
    // The host's own "Open in desktop app" is only for a user who may edit (the G3 rule).
    desktopOpen: desktopOpen && !readonly,
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
  const module = options.module ?? "docs";
  // Display data for the editors (comment and note authors), never an identity the frame authorises with.
  const displayName = useAuthStore((s) => s.user?.display_name ?? "");
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [attempt, setAttempt] = useState(0);
  const queryClient = useQueryClient();
  // The document the frame edits: the page's, until a save-as moves it to the copy.
  const [savedAs, setSavedAs] = useState<{ from: string; to: string } | null>(null);
  const scopeId = savedAs?.from === documentId ? savedAs.to : documentId;
  const tokenQuery = useOfficeFrameToken(wsId, scopeId);
  const token = tokenQuery.data ? docsFrameToken(tokenQuery.data) : null;
  // A module other than Docs also honours the minted token's can_edit, so a view-only user is
  // treated as readonly even when the page did not say so (Docs keeps the page's readonly).
  const viewOnly = options.readonly || (module !== "docs" && tokenQuery.data?.can_edit === false);
  const [status, setStatus] = useState<DocsFrameStatus>("booting");
  const [slow, setSlow] = useState(false);
  const [fatal, setFatal] = useState<ProtocolErrorShape | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<DocsFrameSaveState>("ready");
  const [modal, setModal] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [host, setHost] = useState<DocsFrameHost | null>(null);

  // Latest values for callbacks that live as long as the endpoint.
  const latest = useRef({ options, scopeId, token, refetch: tokenQuery.refetch, displayName, userId, viewOnly });
  latest.current = { options, scopeId, token, refetch: tokenQuery.refetch, displayName, userId, viewOnly };
  const sentToken = useRef<string | null>(null);

  useEffect(() => {
    setStatus("booting");
    setSlow(false);
    setFatal(null);
    setDirty(false);
    setSaveState("ready");
    setModal(false);
    sentToken.current = null;
    // A clean frame after a save reads "saved"; one never saved reads "ready".
    let savedOnce = false;
    // The frame document may never answer (404/5xx on index.html loads a dead page, and an iframe
    // fires no error event for that): until the handshake completes, a probe and a timer decide.
    let booted = false;
    const failBoot = (frameBundle: DocsFrameBundleFailure) => {
      if (booted) return;
      booted = true;
      setFatal({
        code: frameBundle === "timeout" ? "timeout" : "internal",
        message: frameBundle === "timeout" ? "frame did not start in time" : "frame bundle could not be loaded",
        retryable: true,
        details: { frameBundle },
      });
      setStatus("failed");
    };

    const currentToken = async (): Promise<TokenPayload> => {
      const { options: { wsId: ws }, scopeId: doc } = latest.current;
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
        const { options: current, scopeId: doc, viewOnly: refused } = latest.current;
        if (write && refused) throw readOnly(type);
        const run = pick(current.api);
        if (!run) throw new DocsProtocolError({ code: "unsupported", message: `${type} is not available on the web yet` });
        const { token: frameToken } = await currentToken();
        return run.call(current.api, payload as never, { workspaceId: current.wsId, documentId: doc, token: frameToken, signal } as never) as Promise<FrameRequests[K]["result"]>;
      };

    const saveAs = proxy("api.saveAs", true, (api) => api.saveAs);
    const save = proxy("api.save", true, (api) => api.save);
    // A save the frame starts (its button, Ctrl+S, the leave dialog) passes through here.
    const tracked = <T,>(run: () => Promise<T>, settled: (result: T) => DocsFrameSaveState) => {
      setSaveState("saving");
      return run().then(
        (result) => { setSaveState(settled(result)); return result; },
        // A save the user cancelled leaves the edits unsaved, not failed.
        (error: unknown) => { setSaveState(shapeOf(error).code === "cancelled" ? "dirty" : "error"); throw error; },
      );
    };
    const endpoint = createDocsFrameHost({
      self: window,
      frame: () => iframeRef.current?.contentWindow ?? null,
      allowedOrigins: [frameOrigin],
      module,
      getInit: async () => {
        const frameToken = await currentToken();
        sentToken.current = frameToken.token;
        const { options: current, scopeId: doc, displayName: name, userId: uid } = latest.current;
        const minted = queryClient.getQueryData<OfficeFrameToken | null>(officeFrameKeys.token(current.wsId, doc));
        // The server derives the module from the stored file; a frame mounted for another
        // module would edit bytes of a format it does not own (older servers send none).
        if (minted?.module && minted.module !== module) {
          throw new DocsProtocolError({
            code: "malformed", message: `token is for module ${minted.module}, frame is ${module}`,
            details: { tokenModule: minted.module, expectedModule: module },
          });
        }
        // Same rule as the hook's viewOnly, read from the token this init carries.
        const viewOnly = current.readonly || (module !== "docs" && minted?.can_edit === false);
        // Draft recovery (CONTRACT C18): the session's key, again on every init so a reloaded
        // frame reads the drafts it wrote. A viewer has nothing unsaved to recover.
        const recovery = officeModuleSpec(module).recovery === true && uid && !viewOnly
          ? { key: await getOfficeDraftKey(uid), scope: officeDraftScope(uid, doc) }
          : null;
        return {
          ...frameToken,
          documentId: doc, workspaceId: current.wsId,
          apiBase: docsFrameApiBase(), apiMode: "host-proxy",
          locale: current.locale, theme: current.theme,
          capabilities: officeModuleCapabilities(module, viewOnly, current.api, minted?.ai, Boolean(current.onAppOpen)),
          ...(name ? { user: { displayName: name } } : {}),
          ...(recovery ? { recovery } : {}),
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
        "api.save": (payload, context) => tracked(() => save(payload, context), (result) => {
          if (!result.ok) return "dirty";
          savedOnce = true;
          return "saved";
        }),
        "api.saveAs": async (payload, context) => {
          const name = latest.current.options.copyName?.(payload.name) ?? payload.name;
          const { save: saved, rebind } = (await tracked(() => saveAs({ ...payload, name }, context), () => "saved")) as unknown as DocsFrameSavedAs;
          savedOnce = true;
          // Switch the frame to the copy before it hears the answer: token first, then scope.
          const { options: current } = latest.current;
          queryClient.setQueryData(officeFrameKeys.token(current.wsId, rebind.documentId), rebind.token);
          latest.current.scopeId = rebind.documentId;
          setSavedAs({ from: current.documentId, to: rebind.documentId });
          const frameToken = docsFrameToken(rebind.token);
          sentToken.current = frameToken.token;
          endpoint.pushToken(frameToken);
          // The copy now holds every byte the frame had: nothing is unsaved, so the page's own
          // navigation to the copy must not meet the leave dialog (the frame's dirty:false
          // event only arrives after this answer).
          setDirty(false);
          current.onSavedAs?.(rebind.documentId, name);
          return saved;
        },
        "api.recents": proxy("api.recents", false, (api) => api.recents),
        "api.export": proxy("api.export", false, (api) => api.export),
        "api.attachments.add": proxy("api.attachments.add", true, (api) => api.addAttachments),
        "api.images.upload": proxy("api.images.upload", true, (api) => api.uploadImage),
        "app.open": async () => {
          const { options: current, viewOnly: refused } = latest.current;
          return { outcome: refused || !current.onAppOpen ? "unavailable" : await current.onAppOpen() };
        },
      },
      onInitialized: () => { booted = true; setSlow(false); setStatus((now) => (now === "failed" ? now : "ready")); },
      onHandshakeError: (error) => {
        if (error.code === "cancelled") return;
        setFatal(error.toShape());
        setStatus("failed");
      },
    });

    endpoint.on("dirty", ({ dirty: next }) => {
      setDirty(next);
      // A failed save keeps "could not be confirmed" until the user edits again; the frame then
      // reports dirty, and the unsaved edits (not the old failure) are what the header must say.
      if (next) setSaveState((now) => (now === "error" ? "dirty" : now));
      else setSaveState((now) => (now === "dirty" ? (savedOnce ? "saved" : "ready") : now));
    });
    endpoint.on("modal", ({ open }) => { setModal(open); });
    endpoint.on("title", ({ title }) => { latest.current.options.onTitle?.(title); });
    endpoint.on("resize", ({ height: next }) => { setHeight(next); });
    endpoint.on("saved", (saved) => {
      savedOnce = true;
      setSaveState("saved");
      const { options: { wsId: ws, onSaved }, scopeId: doc } = latest.current;
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, doc) });
      onSaved?.(saved);
    });
    endpoint.on("error", ({ error, fatal: isFatal }) => {
      if (isFatal) { setFatal(error); setStatus("failed"); }
      // A save conflict is answered inside the frame (its own Cancel / Reload / Overwrite dialog) and
      // reaches the host only as this event: a toast here would say it twice.
      if (error.code === "conflict" && !isFatal) return;
      latest.current.options.onError(error);
    });
    const probe = new AbortController();
    const bootTimer = setTimeout(() => failBoot("timeout"), latest.current.options.bootTimeoutMs ?? BOOT_TIMEOUT_MS);
    const slowTimer = setTimeout(() => { if (!booted) setSlow(true); }, latest.current.options.slowAfterMs ?? SLOW_AFTER_MS);
    const frameSrc = latest.current.options.frameSrc;
    if (frameSrc) {
      // Only an HTTP answer >= 400 counts: a probe that cannot run (offline, blocked) leaves the
      // verdict to the timer and the handshake.
      void fetch(frameSrc, { credentials: "same-origin", signal: probe.signal }).then(
        (response) => { if (response.status >= 400) failBoot("missing"); },
        () => undefined,
      );
    }
    // A module script that failed to load (404/5xx, a blocked or dropped request) leaves a frame that
    // loads fine and then never starts: its script error does not reach the page, and the load event
    // still fires. Once the frame document has loaded, probe its scripts (served from the HTTP cache
    // when they did load) and fall back at once instead of waiting out the boot timer.
    const iframe = iframeRef.current;
    const onFrameLoad = () => {
      if (booted) return;
      let sources: string[] = [];
      try {
        sources = Array.from(iframe?.contentDocument?.querySelectorAll("script[src]") ?? []).map((el) => (el as HTMLScriptElement).src);
      } catch { return; /* a frame that is not same-origin cannot be inspected; the timer decides */ }
      for (const source of sources) {
        void fetch(source, { credentials: "same-origin", cache: "force-cache", signal: probe.signal }).then(
          (response) => { if (response.status >= 400) failBoot("script"); },
          (error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) failBoot("script"); },
        );
      }
    };
    iframe?.addEventListener("load", onFrameLoad);
    setHost(endpoint);
    return () => { clearTimeout(bootTimer); clearTimeout(slowTimer); iframe?.removeEventListener("load", onFrameLoad); probe.abort(); booted = true; endpoint.dispose(); setHost(null); };
  }, [attempt, documentId, frameOrigin, iframeRef, module, queryClient, wsId]);

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
  return { status: failure ? "failed" : status, slow: slow && status === "booting" && !failure, viewOnly, failure, dirty,
    // Edits made after the last save (or during it) read as unsaved until the frame reports clean.
    saveState: dirty && saveState !== "saving" && saveState !== "error" ? "dirty" : saveState,
    modal: modal && status === "ready" && !failure,
    height, save, print, attempt, retry };
}

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
  type InitPayload,
  type OfficeModule,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
  type TokenPayload,
} from "@uniwork/core/office/docs-frame-protocol";
import { getOfficeDraftKey, officeDraftScope } from "@uniwork/core/office/draft-session-key";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { OFFICE_FRAME_DOWNLOAD_MAX_BYTES, deliverFrameDownload } from "./frame-download";
import type { FrameCommentsBinding } from "./use-frame-comments";

/**
 * No handshake within this long = the bundle never loaded, and the page shows the load failure
 * (Retry, open in UniWork Office, Download). A frame that hangs is far more common than one that needs longer (a normal open
 * completes in a few seconds), and a minute of bare skeleton reads as a dead page; 25 s keeps
 * room for a cold start on a slow link while the slow state below explains the wait from 8 s on.
 */
const BOOT_TIMEOUT_MS = 25_000;

/** No handshake yet after this long: the page says the editor is taking longer than usual. */
const SLOW_AFTER_MS = 8_000;

/**
 * A Save the page sends waits without the protocol's 30 s request timeout, because the frame's
 * conflict dialog may stay open for as long as the user reads it. This watchdog bounds the rest:
 * no answer and no `modal {open:true}` within this long cancels the request as a timeout. It is
 * stopped while the frame runs `api.save` or shows a dialog, and starts over when either ends
 * without an answer (EXPERIENCE.md › Conflict dialog (S5)).
 */
export const SAVE_WATCHDOG_MS = 30_000;

/** How a Save the page asked for ended: a new version, the newest version reloaded, the user's Cancel, or a failure. */
export type DocsFrameSaveOutcome = "saved" | "reloaded" | "cancelled" | "failed";

/**
 * One frame endpoint's life. `failed`: the frame hit a fatal error or failed its handshake, and
 * nothing of it is usable any more. `disposed`: retry or unmount retired it; its late callbacks
 * must not touch the session that replaced it.
 */
interface FrameLife {
  state: "live" | "failed" | "disposed";
}

/** The Save the page has in flight, as the watchdog sees it. */
interface HostSaveWatch {
  /** The endpoint this Save went to. */
  life: FrameLife;
  abort: AbortController;
  /**
   * Set when the host itself gave up: the frame stayed silent, its document went away, or the
   * frame failed for good (`fatal`, already reported on its own).
   */
  cause: "watchdog" | "unload" | "fatal" | null;
  /** The Save resolved: nothing may arm its watchdog again. */
  settled: boolean;
  /** `api.save` requests of the frame in flight. */
  busy: number;
  modal: boolean;
  /** The frame stored a new version while this Save was open. */
  stored: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function armWatchdog(watch: HostSaveWatch) {
  if (watch.timer !== null) clearTimeout(watch.timer);
  watch.timer = null;
  if (watch.busy > 0 || watch.modal || watch.cause || watch.settled || watch.life.state !== "live") return;
  watch.timer = setTimeout(() => { watch.cause = "watchdog"; watch.abort.abort(); }, SAVE_WATCHDOG_MS);
}

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
  /**
   * The name of a download of the open bytes (the conflict dialog's "download my version"),
   * without its extension: the host adds the module's own.
   */
  downloadName?: () => string;
  /** Non-fatal frame or proxy errors the user should hear about. */
  onError: (error: ProtocolErrorShape) => void;
  /**
   * The page's "Open in desktop app" flow, answering the frame's `app.open`. Present = the host grants
   * `desktopOpen` (to a user who may edit); absent = the frame shows its "use the app" message alone.
   */
  onAppOpen?: () => Promise<AppOpenResult["outcome"]>;
  /** The editor's server comments (G8-08, `useFrameComments`): its four seams into this handshake. */
  comments?: FrameCommentsBinding;
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
  /**
   * Ask the frame to save (header Save, leave dialog). A conflict is the frame's to resolve in its
   * own dialog; the answer says how the user resolved it.
   */
  save: (reason: "user" | "navigate") => Promise<DocsFrameSaveOutcome>;
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
export function officeModuleCapabilities(module: OfficeModule, readonly: boolean, api: DocsFrameApi, aiGrant?: OfficeFrameAIGrant, desktopOpen = false, download = false): Capabilities {
  const spec = officeModuleSpec(module);
  const grant = spec.grant;
  const on = (key: keyof Capabilities) => grant[key] === true;
  const ai = spec.ai === true && aiGrant?.ai === true;
  return {
    ...grant,
    save: on("save") && !readonly, saveAs: on("saveAs") && !readonly && Boolean(api.saveAs), recents: on("recents"), print: on("print"),
    exportPdf: on("exportPdf") && Boolean(api.export), exportHtml: on("exportHtml"),
    attachments: on("attachments") && !readonly && Boolean(api.addAttachments), images: on("images") && !readonly && (module === "docs" || Boolean(api.uploadImage)),
    ai, webSearch: ai && aiGrant?.web_search === true, imageSearch: ai && aiGrant?.image_search === true,
    imageGeneration: ai && aiGrant?.image_generation === true,
    // The host's own "Open in desktop app" is only for a user who may edit.
    desktopOpen: desktopOpen && !readonly,
    // The host delivers the frame's bytes itself (api.download), only to a user who may edit.
    download: download && !readonly,
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
  // The Save the page has in flight, and whether the frame shows a dialog right now.
  const hostSave = useRef<HostSaveWatch | null>(null);
  const modalOpen = useRef(false);
  // The life of the endpoint the current effect created.
  const frameLife = useRef<FrameLife>({ state: "disposed" });
  // A clean frame after a save reads "saved"; one never saved reads "ready".
  const savedOnce = useRef(false);

  useEffect(() => {
    setStatus("booting");
    setSlow(false);
    setFatal(null);
    setDirty(false);
    setSaveState("ready");
    setModal(false);
    modalOpen.current = false;
    sentToken.current = null;
    savedOnce.current = false;
    const life: FrameLife = { state: "live" };
    frameLife.current = life;
    const iframe = iframeRef.current;
    // The frame failed for good (fatal error, failed handshake, a bundle that never started): show
    // the failure, and end a Save in flight with it, since nothing is left to answer it.
    const failSession = (failure: ProtocolErrorShape) => {
      setFatal(failure);
      setStatus("failed");
      if (life.state !== "live") return;
      life.state = "failed";
      modalOpen.current = false;
      setModal(false);
      const watch = hostSave.current;
      if (watch?.life === life && !watch.cause) { watch.cause = "fatal"; watch.abort.abort(); }
    };
    // The frame document may never answer (404/5xx on index.html loads a dead page, and an iframe
    // fires no error event for that): until the handshake completes, a probe and a timer decide.
    let booted = false;
    const failBoot = (frameBundle: DocsFrameBundleFailure) => {
      if (booted) return;
      booted = true;
      failSession({
        code: frameBundle === "timeout" ? "timeout" : "internal",
        message: frameBundle === "timeout" ? "frame did not start in time" : "frame bundle could not be loaded",
        retryable: true,
        details: { frameBundle },
      });
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
    // Once retry or unmount retired this endpoint, a late answer belongs to nobody: the session
    // that replaced it keeps its own state.
    const tracked = <T,>(run: () => Promise<T>, settled: (result: T) => DocsFrameSaveState) => {
      setSaveState("saving");
      return run().then(
        (result) => { if (life.state !== "disposed") setSaveState(settled(result)); return result; },
        (error: unknown) => {
          if (life.state === "disposed") throw error;
          // While the page's own Save is open its answer decides the header: a 409 here is the
          // frame's conflict dialog opening, not the end of that Save.
          if (hostSave.current) setSaveState("saving");
          // A save the user cancelled leaves the edits unsaved, not failed.
          else setSaveState(shapeOf(error).code === "cancelled" ? "dirty" : "error");
          throw error;
        },
      );
    };
    // The frame's document went away (a reload or a crash): a Save sent to it can never be
    // answered, and a dialog it reported is gone with it.
    // Its edits are gone too (Markdown and HTML reload themselves after Reload latest): the next
    // document reports its own dirty state.
    const frameGone = () => {
      if (life.state !== "live") return;
      modalOpen.current = false;
      setModal(false);
      setDirty(false);
      const watch = hostSave.current;
      if (watch?.life === life && !watch.cause) { watch.cause = "unload"; watch.abort.abort(); }
    };
    // The same-origin frame document that completed the handshake. Its window's pagehide is the
    // moment it goes away (navigation, reload, the iframe leaving the page), whether or not a
    // replacement ever loads. A frame that cannot be inspected falls back to loads and handshakes.
    let frameDoc: Document | null = null;
    let frameDocGone = false;
    let unbindFrameDoc: (() => void) | null = null;
    const docGone = () => {
      if (frameDocGone) return;
      frameDocGone = true;
      frameGone();
    };
    const bindFrameDocument = () => {
      unbindFrameDoc?.();
      unbindFrameDoc = null;
      frameDoc = null;
      frameDocGone = false;
      let win: Window | null = null;
      try {
        win = iframe?.contentWindow ?? null;
        frameDoc = win?.document ?? null;
      } catch { frameDoc = null; return; /* not same-origin: loads and handshakes decide */ }
      if (!win || !frameDoc) return;
      const target = win;
      const doc = frameDoc;
      const onHide = () => { if (frameDoc === doc) docGone(); };
      target.addEventListener("pagehide", onHide);
      unbindFrameDoc = () => target.removeEventListener("pagehide", onHide);
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
        const capabilities = officeModuleCapabilities(module, viewOnly, current.api, minted?.ai, Boolean(current.onAppOpen), minted?.can_edit === true);
        const init: Omit<InitPayload, "protocolVersion"> = {
          ...frameToken,
          documentId: doc, workspaceId: current.wsId,
          apiBase: docsFrameApiBase(), apiMode: "host-proxy",
          locale: current.locale, theme: current.theme,
          capabilities,
          // The cap api.download enforces, told up front so the conflict dialog can disable its
          // download choice before a 413; only with the capability (the frame ignores it otherwise).
          ...(capabilities.download ? { downloadMaxBytes: OFFICE_FRAME_DOWNLOAD_MAX_BYTES } : {}),
          ...(name ? { user: { displayName: name } } : {}),
          ...(recovery ? { recovery } : {}),
        };
        return current.comments ? current.comments.augmentInit(init, { canEdit: minted?.can_edit, readonly: viewOnly }) : init;
      },
      refreshToken: async () => {
        const { data } = await latest.current.refetch();
        if (!data) throw unauthorized();
        const fresh = docsFrameToken(data);
        sentToken.current = fresh.token;
        return fresh;
      },
      api: {
        ...latest.current.options.comments?.api,
        "api.open": proxy("api.open", false, (api) => api.open),
        "api.save": async (payload, context) => {
          // This upload belongs to the page's Save in flight: the watchdog waits for it.
          const watch = hostSave.current?.life === life ? hostSave.current : null;
          if (watch) { watch.busy += 1; armWatchdog(watch); }
          try {
            return await tracked(() => save(payload, context), (result) => {
              if (!result.ok) return "dirty";
              savedOnce.current = true;
              if (watch) watch.stored = true;
              return "saved";
            });
          } finally {
            // Only the Save still open may wait again; one that already ended stays ended.
            if (watch) { watch.busy -= 1; if (hostSave.current === watch) armWatchdog(watch); }
          }
        },
        "api.saveAs": async (payload, context) => {
          const name = latest.current.options.copyName?.(payload.name) ?? payload.name;
          const { save: saved, rebind } = (await tracked(() => saveAs({ ...payload, name }, context), () => "saved")) as unknown as DocsFrameSavedAs;
          savedOnce.current = true;
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
        // A read of the user's own document, so a viewer may ask too.
        "api.assets.resolve": proxy("api.assets.resolve", false, (api) => api.resolveAssets),
        // The conflict dialog's "download my version": bytes only; name, type and size are the host's.
        "api.download": async (payload) => {
          const { options: current, scopeId: doc, viewOnly: refused } = latest.current;
          const minted = queryClient.getQueryData<OfficeFrameToken | null>(officeFrameKeys.token(current.wsId, doc));
          if (refused || minted?.can_edit !== true) throw readOnly("api.download");
          return deliverFrameDownload(payload, module, current.downloadName?.() ?? doc);
        },
        "app.open": async () => {
          const { options: current, viewOnly: refused } = latest.current;
          return { outcome: refused || !current.onAppOpen ? "unavailable" : await current.onAppOpen() };
        },
      },
      // A new frame instance after the first: the old document and anything it had open are gone
      // (unless its pagehide said so already).
      onInitialized: (ack) => {
        if (booted && !frameDocGone) frameGone();
        booted = true;
        latest.current.options.comments?.attach(endpoint, ack, () => latest.current.scopeId);
        bindFrameDocument();
        // A new document starts with no dialog open: it reports its own from here on.
        modalOpen.current = false;
        setModal(false);
        setSlow(false);
        setStatus((now) => (now === "failed" ? now : "ready"));
      },
      onHandshakeError: (error) => {
        if (error.code === "cancelled") return;
        failSession(error.toShape());
      },
    });

    endpoint.on("dirty", ({ dirty: next }) => {
      setDirty(next);
      // A failed save keeps "could not be confirmed" until the user edits again; the frame then
      // reports dirty, and the unsaved edits (not the old failure) are what the header must say.
      if (next) setSaveState((now) => (now === "error" ? "dirty" : now));
      else setSaveState((now) => (now === "dirty" ? (savedOnce.current ? "saved" : "ready") : now));
    });
    endpoint.on("modal", ({ open }) => {
      // A frame that failed, or whose document is known gone, has no dialog left to report: a
      // message queued before its teardown must not make the page inert with nothing to lift it.
      if (life.state !== "live" || frameDocGone) return;
      modalOpen.current = open;
      setModal(open);
      // A dialog the user reads stops the watchdog; one that closes without an answer restarts it.
      const watch = hostSave.current;
      if (watch) { watch.modal = open; armWatchdog(watch); }
    });
    endpoint.on("title", ({ title }) => { latest.current.options.onTitle?.(title); });
    endpoint.on("resize", ({ height: next }) => { setHeight(next); });
    endpoint.on("saved", (saved) => {
      savedOnce.current = true;
      setSaveState("saved");
      const { options: { wsId: ws, onSaved }, scopeId: doc } = latest.current;
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, doc) });
      onSaved?.(saved);
    });
    endpoint.on("error", ({ error, fatal: isFatal }) => {
      if (isFatal) failSession(error);
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
    // The first load is the frame document itself; any later one replaced it. A load of a document
    // other than the one that shook hands replaced it too, even when its first load was never seen.
    let loads = 0;
    const onFrameLoad = () => {
      loads += 1;
      let current: Document | null = null;
      try { current = iframe?.contentDocument ?? null; } catch { /* not same-origin: the count decides */ }
      if (loads > 1 || (frameDoc !== null && current !== frameDoc)) docGone();
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
    return () => {
      clearTimeout(bootTimer);
      clearTimeout(slowTimer);
      iframe?.removeEventListener("load", onFrameLoad);
      unbindFrameDoc?.();
      probe.abort();
      booted = true;
      // Retired at once: a Save still open here is cancelled by the dispose below, and nothing of
      // this endpoint may arm a timer or write state after this line.
      life.state = "disposed";
      latest.current.options.comments?.detach();
      const watch = hostSave.current;
      if (watch?.life === life && watch.timer !== null) { clearTimeout(watch.timer); watch.timer = null; }
      endpoint.dispose();
      setHost(null);
    };
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

  const save = useCallback(async (reason: "user" | "navigate"): Promise<DocsFrameSaveOutcome> => {
    // One Save at a time: a second one (the page is inert while the frame's dialog is open) is refused, unsent.
    const life = frameLife.current;
    if (!host || hostSave.current || life.state !== "live") return "failed";
    const watch: HostSaveWatch = { life, abort: new AbortController(), cause: null, settled: false, busy: 0, modal: modalOpen.current, stored: false, timer: null };
    hostSave.current = watch;
    armWatchdog(watch);
    setSaveState("saving");
    const fail = (error: ProtocolErrorShape): DocsFrameSaveOutcome => {
      setSaveState("error");
      latest.current.options.onError(error);
      return "failed";
    };
    try {
      // No request timeout: the frame's conflict dialog may stay open as long as the user reads it.
      const result = await host.save({ reason }, { timeoutMs: 0, signal: watch.abort.signal });
      if (result.ok) {
        // A new version (Overwrite, or a plain save) reads "saved"; Reload latest stores nothing and reads "ready".
        const stored = Boolean(result.versionId) || watch.stored;
        if (stored) savedOnce.current = true;
        setSaveState(stored ? "saved" : "ready");
        return stored ? "saved" : "reloaded";
      }
      // Only the frame's own Cancel is silent: the edits stay, unsaved.
      if (result.error.code === "cancelled") { setSaveState("dirty"); return "cancelled"; }
      return fail(result.error);
    } catch (error) {
      // The frame failed for good: its failure is already on screen (and reported once), and this Save ends with it.
      if (watch.cause === "fatal") { setSaveState("error"); return "failed"; }
      if (watch.cause === "watchdog") {
        return fail({ code: "timeout", message: "the editor did not answer the save in time", retryable: true });
      }
      if (watch.cause === "unload") {
        return fail({ code: "internal", message: "the editor closed before it answered the save", retryable: true, details: { reason: "frame_unloaded" } });
      }
      const shape = shapeOf(error);
      // The session itself went away (retry, unmount): nobody is left to tell, and the session
      // that replaced it keeps its own header.
      if (shape.code === "cancelled") { if (watch.life.state !== "disposed") setSaveState("dirty"); return "cancelled"; }
      return fail(shape);
    } finally {
      watch.settled = true;
      if (watch.timer !== null) clearTimeout(watch.timer);
      watch.timer = null;
      if (hostSave.current === watch) hostSave.current = null;
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

import type { RefObject } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DocumentLimits } from "@uniwork/core/api/endpoints/config";
import type { OfficeFrameAIGrant, OfficeFrameToken } from "@uniwork/core/api/endpoints/office-frame";
import { documentKeys } from "@uniwork/core/documents/keys";
import { officeFrameKeys } from "@uniwork/core/documents/office-frame-hooks";
import { docsFrameError, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { ApiHandlers, DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  parseEnvelope,
  type AppOpenResult,
  type Capabilities,
  type FrameEvents,
  type DocumentSizeLimits,
  type OfficeModule,
  type ProtocolErrorShape,
  type SaveResult,
  type FileMeta,
  type SaveBlockedPayload,
  type SavedPayload,
  type SizeWarningPayload,
  type Theme,
} from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { frameBlockError, type FrameBlock, type FrameRemoteVersion } from "./frame-remote-version";
import type { FrameEditLock } from "./frame-edit-lock";
import type { FrameCommentsBinding } from "./use-frame-comments";

// The model of one Docs frame session: its public options and state, the timings, the page's
// Save watchdog and the capability grant. The hook that runs it is `use-docs-frame-session.ts`.

/**
 * No handshake within this long = the bundle never loaded, and the page shows the load failure
 * (Retry, open in UniWork Office, Download). A frame that hangs is far more common than one that needs longer (a normal open
 * completes in a few seconds), and a minute of bare skeleton reads as a dead page; 25 s keeps
 * room for a cold start on a slow link while the slow state below explains the wait from 8 s on.
 */
export const BOOT_TIMEOUT_MS = 25_000;

/** No handshake yet after this long: the page says the editor is taking longer than usual. */
export const SLOW_AFTER_MS = 8_000;

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
export interface FrameLife {
  state: "live" | "failed" | "disposed";
}

/** The Save the page has in flight, as the watchdog sees it. */
export interface HostSaveWatch {
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

export function armWatchdog(watch: HostSaveWatch) {
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

/** What the frame session opens: a saved document, or a file from another module (UNI-1869), opened view-only. */
export interface OfficeFrameFileRef {
  kind: "document" | "source";
  id: string;
}

export interface DocsFrameSizeWarning {
  bytes: number;
  maxBytes: number;
  warnRatio: number;
}

export interface DocsFrameSaveBlocked {
  maxBytes: number;
}

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
  /** The file the session opens; `kind: "source"` forces view-only and mints on the source route. */
  fileRef: OfficeFrameFileRef;
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
  /** Frame or proxy errors the user should hear about (`fatal` when the frame's error event ended the session). */
  onError: (error: ProtocolErrorShape, options: { fatal: boolean }) => void;
  /** Called when a view-only source frame asks to save, export, upload, or download. */
  onSourceWriteRefused?: (kind: "write" | "export") => void;
  /**
   * A write answered `document_shelved` (ARCHIVE-01 U-8): the document went to "Lưu trữ" under the open
   * frame. Called once per session; the session is read-only from then on and the page says so.
   */
  onShelved?: () => void;
  /**
   * The page's "Open in desktop app" flow, answering the frame's `app.open`. Present = the host grants
   * `desktopOpen` (to a user who may edit); absent = the frame shows its "use the app" message alone.
   */
  onAppOpen?: () => Promise<AppOpenResult["outcome"]>;
  /** The editor's server comments (G8-08, `useFrameComments`): its four seams into this handshake. */
  comments?: FrameCommentsBinding;
  /**
   * The page's edit lock (UNI-1645, `frame-edit-lock.ts`): not holding it is view-only, the held id
   * rides on the commit, a 423 on Save goes back through `onLocked`. Absent = no lock management.
   */
  editLock?: FrameEditLock | null;
  /**
   * The document's effective level for the user (`my_level`). Only `comment`
   * keeps a `can_edit === false` token out of the readOnly profile (RFH-1: a
   * commenter may not save but still comments); any other or absent level is a
   * true viewer. The comments binding reads the same prop off the page.
   */
  myLevel?: string | null;
  /** Called when the frame sends `close_requested {reason: 'escape'}` and the session is live, idle (not saving), and has no modal open. */
  onCloseRequested?: () => void;
  /**
   * UNI-1847 (SAVE-01): the first save of a never-saved blank Office document asks for its
   * name before the upload. `needsName` is the page's detection (`untitled.<ext>` at version 1,
   * the user may edit); `ask` opens the page's naming dialog and resolves `true` once the title
   * is written (the save then proceeds). The session adds "nothing saved this session yet".
   */
  firstSave?: FirstSaveNamer;
}

export interface DocsFrameSession {
  status: DocsFrameStatus;
  /** Still booting after `slowAfterMs`: the page explains the wait instead of showing a bare skeleton. */
  slow: boolean;
  /**
   * The page's readonly, a source file, a minted token that cannot edit (can_edit=false:
   * every module, a shelved document included), not holding the edit lock, or a write the
   * server refused with document_shelved: writes are refused in the host and desktop-open
   * is hidden.
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
   * An AI turn runs in the frame (its `aiRun` events). Held per frame: a frame that unloads or
   * loses its endpoint mid-turn reads idle, since it can no longer say so itself.
   */
  aiRunning: boolean;
  /** The document was deleted or this user lost access: every Save is refused (EXPERIENCE.md › S6). */
  blocked: FrameBlock | null;
  /** Latched once per document session when the frame emits `size_warning`. */
  sizeWarning: DocsFrameSizeWarning | null;
  /** Open when the frame emits `save_blocked` or a save fails with 413 `file_too_large`. */
  saveBlocked: DocsFrameSaveBlocked | null;
  /** Dismiss the save-blocked dialog without closing or reloading the frame. */
  dismissSaveBlocked: () => void;
  /** Ask the frame to download the user's current copy (`doc.download`). */
  downloadCopy: () => void;
  /**
   * Ask the frame to save (header Save, leave dialog). A conflict is the frame's to resolve in its
   * own dialog; the answer says how the user resolved it.
   */
  save: (reason: "user" | "navigate") => Promise<DocsFrameSaveOutcome>;
  print: () => Promise<boolean>;
  /** Tell the frame the document's display name changed (UNI-1847, after the first-save rename). */
  notifyRenamed: (file: FileMeta) => void;
  /** Changes on every retry; key the iframe with it so the frame reloads. */
  attempt: number;
  /** Re-mint a token that failed and reload the frame. */
  retry: () => void;
}

/** The page's "name this document" prompt of a first save (UNI-1847). */
export interface FirstSaveNamer {
  /** The open document still needs naming: untitled.<ext>, file version 1, the user may edit. */
  needsName: () => boolean;
  /** Opens the naming dialog; resolves true after the title is written, false on Cancel/Esc. */
  ask: () => Promise<boolean>;
}

/**
 * The `api.save` answer the host gives while the naming dialog asks instead (UNI-1847):
 * a declined save reads as the user's own Cancel in the protocol - the frame keeps its
 * edits unsaved and never waits on its api.save timeout (the pinned bundle's
 * No.transfer, 120 s; the frame prints its own generic failure line, S01-V2).
 */
export const FIRST_SAVE_DECLINED: SaveResult = {
  ok: false,
  error: { code: "cancelled", message: "name the document before it saves", retryable: false },
};

/** What the Save the page has open fails with when the host itself gave up on it (never `fatal`: that one is already on screen). */
export function hostSaveCauseError(cause: HostSaveWatch["cause"]): ProtocolErrorShape | null {
  if (cause === "watchdog") return { code: "timeout", message: "the editor did not answer the save in time", retryable: true };
  if (cause === "unload") return { code: "internal", message: "the editor closed before it answered the save", retryable: true, details: { reason: "frame_unloaded" } };
  return null;
}

/**
 * Capabilities this host grants. Routes that do not exist yet stay off.
 * `exportPdf` is `module !== "docs" || api.export`: the grant decides alone
 * outside Docs (Slides renders the PDF in the frame), while Docs goes through
 * `api.export` — nothing tells the host whether this deployment has a PDF
 * renderer, so it is offered when the API exists and a 501 answers
 * `unsupported`, on which the frame prints in place instead. Each module
 * starts from its grant (`officeModuleSpec(module).grant`, one table the
 * module workers fill in), narrowed by readonly and by what the API
 * implements. A key the grant leaves out is off. AI (CONTRACT C16) is on only
 * for a module with AI panels (`officeModuleSpec(module).ai`) and only as far
 * as the minted token's `ai` grant says (the organization's entitlement, read
 * by the server at mint); `uniworkAi` follows `ai.uniwork_ai` the same way, and
 * each cloud tool needs `ai` or `uniworkAi` plus its own grant. The frame then calls
 * the frame-token AI routes itself; a viewer keeps AI (it never saves).
 */
export function officeModuleCapabilities(module: OfficeModule, readonly: boolean, api: DocsFrameApi, aiGrant?: OfficeFrameAIGrant, desktopOpen = false, download = false, copyRefused = readonly || !download): Capabilities {
  const spec = officeModuleSpec(module);
  const { saveCopy: _saveCopy, ...grant } = spec.grant;
  const on = (key: keyof Capabilities) => spec.grant[key] === true;
  const ai = spec.ai === true && aiGrant?.ai === true;
  // UniWork AI (G6-05) is its own grant, independent of BYOK `ai`.
  const uniworkAi = spec.ai === true && aiGrant?.uniwork_ai === true;
  // The cloud tools serve either AI, so an organization with only UniWork AI still gets the ones it is granted.
  const cloud = ai || uniworkAi;
  const saveCopy = module === "docs" && on("saveCopy") && !copyRefused && download && Boolean(api.saveCopy);
  return {
    ...grant,
    save: on("save") && !readonly, saveAs: on("saveAs") && !readonly && Boolean(api.saveAs), recents: on("recents") && Boolean(api.recents), print: on("print"),
    ...(saveCopy ? { saveCopy: true } : {}),
    exportPdf: on("exportPdf") && (module !== "docs" || Boolean(api.export)), exportHtml: on("exportHtml"),
    attachments: on("attachments") && !readonly && Boolean(api.addAttachments), images: on("images") && !readonly && (module === "docs" || Boolean(api.uploadImage)),
    ai, uniworkAi, webSearch: cloud && aiGrant?.web_search === true, imageSearch: cloud && aiGrant?.image_search === true,
    imageGeneration: cloud && aiGrant?.image_generation === true,
    // The host's own "Open in desktop app" is only for a user who may edit.
    desktopOpen: desktopOpen && !readonly,
    // The host delivers the frame's bytes itself (api.download), only to a user who may edit.
    download: download && !readonly,
    // The host renders the size-warning chip and save-blocked dialog (SIZE-W1b).
    sizeUi: true,
  };
}

/**
 * A file from another module (UNI-1869) opens to look at and print, nothing
 * else: read-only grant, no token AI grant, and no recents, export or
 * download whatever the API object carries.
 */
export function officeSourceCapabilities(module: OfficeModule, api: DocsFrameApi): Capabilities {
  return { ...officeModuleCapabilities(module, true, api), recents: false, exportPdf: false, exportHtml: false };
}

export const unauthorized = () => new DocsProtocolError({ code: "unauthorized", message: "frame token unavailable" });
export const readOnly = (type: string) => new DocsProtocolError({ code: "forbidden", message: `${type} is not allowed for a read-only viewer`, status: 403 });

export const shapeOf = (error: unknown): ProtocolErrorShape => docsFrameError(error).toShape();

/**
 * The refusal of a write on a shelved document (ARCHIVE-01 §3), as `docsFrameError` shapes the 409:
 * a `conflict` that carries the stable code. The frame must not read it as a stale base.
 */
export const isShelvedShape = (shape: ProtocolErrorShape | undefined): boolean => shape?.details?.["apiCode"] === "document_shelved";

/** What the frame hears instead: a read-only refusal, like any write a viewer attempts. */
export const shelvedRefusal = () => new DocsProtocolError({ code: "forbidden", message: "document is archived and read-only", status: 403 });

/**
 * Runs a write of the frame's api and turns `document_shelved` — thrown by an upload step or returned
 * as a failed save — into one read-only refusal, after telling the session once (`onShelved`).
 */
export function shelvedGuard<P, C, R>(run: (payload: P, context: C) => Promise<R>, onShelved: () => void): (payload: P, context: C) => Promise<R> {
  return async (payload, context) => {
    let result: R;
    try {
      result = await run(payload, context);
    } catch (error) {
      if (!isShelvedShape(shapeOf(error))) throw error;
      onShelved();
      throw shelvedRefusal();
    }
    const failed = typeof result === "object" && result !== null && "ok" in result && result.ok === false && "error" in result;
    if (failed && isShelvedShape((result as { error: ProtocolErrorShape }).error)) {
      onShelved();
      throw shelvedRefusal();
    }
    return result;
  };
}

/**
 * The one-shot "went to Lưu trữ" latch of a live endpoint (ARCHIVE-01 §3): flips the session
 * read-only, tells the page once, and re-reads the document. Every write path wraps itself in
 * `shelvedGuard` with the lock this builds; a disposed endpoint answers nothing.
 */
export function createShelvedLock(deps: {
  /** The endpoint's own life object: dead once it is retired or fails. */
  life: { state: string };
  shelvedRef: RefObject<boolean>;
  setShelved: (value: boolean) => void;
  latest: RefObject<{ options: DocsFrameSessionOptions; viewOnly: boolean }>;
  queryClient: QueryClient;
}): () => void {
  return () => {
    if (deps.life.state === "disposed" || deps.shelvedRef.current) return;
    deps.shelvedRef.current = true;
    deps.latest.current.viewOnly = true;
    deps.setShelved(true);
    const { wsId: ws, fileRef: pageFile, onShelved } = deps.latest.current.options;
    void deps.queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, pageFile.id) });
    onShelved?.();
  };
}

export function toFrameLimits(limits: Pick<DocumentLimits, "upload_max_bytes" | "save_warn_ratio">): DocumentSizeLimits {
  return { max_bytes: limits.upload_max_bytes, warn_ratio: limits.save_warn_ratio };
}

export function saveBlockedMaxBytes(error: unknown, fallbackMaxBytes: number): number | null {
  const shape = shapeOf(error);
  const isTooLarge = shape.code === "too_large" || shape.status === 413 || shape.details?.["apiCode"] === "file_too_large";
  if (!isTooLarge) return null;
  const rawMax = shape.details?.["max_bytes"];
  return typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : fallbackMaxBytes;
}

export function onSizeEvents(
  endpoint: DocsFrameHost,
  handlers: { onSizeWarning: (payload: SizeWarningPayload) => void; onSaveBlocked: (payload: SaveBlockedPayload) => void },
): void {
  const subscribe = endpoint.on as <K extends "size_warning" | "save_blocked">(
    type: K,
    listener: (payload: FrameEvents[K]) => void,
  ) => () => void;
  subscribe("size_warning", handlers.onSizeWarning);
  subscribe("save_blocked", handlers.onSaveBlocked);
}

export const DOC_DOWNLOAD_TIMEOUT_MS = 30_000;

let downloadSeq = 0;
export function postDocDownload(target: Window | null, origin: string, timeoutMs = DOC_DOWNLOAD_TIMEOUT_MS): Promise<void> {
  if (!target || !origin) {
    return Promise.reject(new DocsProtocolError({ code: "not_ready", message: "frame window not available" }));
  }
  downloadSeq += 1;
  const id = `h-dl-${downloadSeq}`;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new DocsProtocolError({ code: "timeout", message: `doc.download timed out after ${timeoutMs} ms`, retryable: true }));
    }, timeoutMs);
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== origin || ev.source !== target) return;
      const parsed = parseEnvelope(ev.data);
      if (!parsed.ok) {
        if (parsed.reason === "malformed" && parsed.partial?.id === id && parsed.partial.kind === "response") {
          cleanup();
          reject(new DocsProtocolError({ code: "malformed", message: parsed.detail }));
        }
        return;
      }
      const msg = parsed.message;
      if (msg.kind !== "response" || msg.id !== id) return;
      cleanup();
      if (msg.error) reject(new DocsProtocolError(msg.error));
      else resolve();
    };
    window.addEventListener("message", onMessage);
    try {
      target.postMessage(
        { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind: "request", type: "doc.download", payload: {} },
        origin,
      );
    } catch (error) {
      cleanup();
      reject(docsFrameError(error));
    }
  });
}

export function attachFrameBundleProbe(options: {
  iframe: HTMLIFrameElement | null;
  frameSrc?: string;
  bootTimeoutMs?: number;
  slowAfterMs?: number;
  isBooted: () => boolean;
  getFrameDoc: () => Document | null;
  onSlow: () => void;
  onDocGone: () => void;
  onFailBoot: (reason: DocsFrameBundleFailure) => void;
}): () => void {
  const { iframe, frameSrc, bootTimeoutMs, slowAfterMs, isBooted, getFrameDoc, onSlow, onDocGone, onFailBoot } = options;
  const probe = new AbortController();
  const bootTimer = setTimeout(() => onFailBoot("timeout"), bootTimeoutMs ?? BOOT_TIMEOUT_MS);
  const slowTimer = setTimeout(() => { if (!isBooted()) onSlow(); }, slowAfterMs ?? SLOW_AFTER_MS);
  if (frameSrc) {
    // Only an HTTP answer >= 400 counts: a probe that cannot run (offline, blocked) leaves the
    // verdict to the timer and the handshake.
    void fetch(frameSrc, { credentials: "same-origin", signal: probe.signal }).then(
      (response) => { if (response.status >= 400) onFailBoot("missing"); },
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
    const frameDoc = getFrameDoc();
    if (loads > 1 || (frameDoc !== null && current !== frameDoc)) onDocGone();
    if (isBooted()) return;
    let sources: string[] = [];
    try {
      sources = Array.from(iframe?.contentDocument?.querySelectorAll("script[src]") ?? []).map((el) => (el as HTMLScriptElement).src);
    } catch { return; /* a frame that is not same-origin cannot be inspected; the timer decides */ }
    for (const source of sources) {
      void fetch(source, { credentials: "same-origin", cache: "force-cache", signal: probe.signal }).then(
        (response) => { if (response.status >= 400) onFailBoot("script"); },
        (error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) onFailBoot("script"); },
      );
    }
  };
  iframe?.addEventListener("load", onFrameLoad);
  return () => {
    clearTimeout(bootTimer);
    clearTimeout(slowTimer);
    iframe?.removeEventListener("load", onFrameLoad);
    probe.abort();
  };
}


/**
 * A 423 document_locked (addendum §11.1) is never {ok:false}: the page ends its hold (banner,
 * read-only) via `onLocked`, which stays the one explanation. The frame hears `internal`
 * (UNI-1907, L-3): `forbidden` with no org apiCode would lock it as 'revoked' and draw the red
 * lost-access bar, `conflict` would open the overwrite dialog — both wrong while only the edit
 * lock is gone. `internal` shows nothing but the frame's localized save-failed line; the edits
 * stay dirty. `apiCode` stays so the host-side save bookkeeping can still name the refusal.
 * Sending doc.editLock first waits for the protocol change (card c, Q4).
 */
export function lockAwareSave<F extends (...args: never[]) => Promise<unknown>>(
  upload: F,
  onLocked: (fields: Record<string, unknown> | undefined) => void,
  held: () => boolean = () => true,
): F {
  // Set by a 423, cleared the moment the page holds the lock again. While set and the lock is not
  // held, a save is refused here with the same shape and no upload: it would only be refused again.
  let lost = false;
  const refusal = (apiCode: unknown) => new DocsProtocolError({
    code: "internal",
    message: "api.save refused: the edit lock was lost",
    status: 423,
    details: { apiCode: apiCode ?? "document_locked" },
  });
  return (async (...args: Parameters<F>) => {
    if (lost) {
      if (!held()) throw refusal(undefined);
      lost = false;
    }
    try {
      return await upload(...args);
    } catch (error) {
      const shape = shapeOf(error);
      if (shape.status !== 423) throw error;
      lost = true;
      const fields = shape.details?.fields;
      onLocked(fields && typeof fields === "object" ? fields as Record<string, unknown> : undefined);
      throw refusal(shape.details?.apiCode);
    }
  }) as F;
}

/**
 * The frame's `api.saveCopy` (UNI-1872, UNI-1892): a copy stays on the document it opened, so the
 * minted token's `can_edit` answers for it; refused only for source sessions (SRC-02b),
 * `options.readonly`, or a viewer (`can_edit === false`), never merely because `lockedOut` is set.
 */
export function saveCopyHandler(deps: {
  remote: FrameRemoteVersion;
  latest: RefObject<{ options: DocsFrameSessionOptions; scopeId: string; copyRefused: boolean }>;
  queryClient: QueryClient;
  run: NonNullable<ApiHandlers["api.saveCopy"]>;
}): ApiHandlers["api.saveCopy"] {
  return async (payload, ctx) => {
    if (deps.remote.blocked) throw frameBlockError(deps.remote.blocked);
    const { options: current, scopeId: doc, copyRefused } = deps.latest.current;
    const minted = deps.queryClient.getQueryData<OfficeFrameToken | null>(officeFrameKeys.token(current.wsId, doc));
    if (copyRefused || minted?.can_edit === false) throw readOnly("api.saveCopy");
    const result = await deps.run(payload, ctx);
    void deps.queryClient.invalidateQueries({ queryKey: documentKeys.listRoot(current.wsId) });
    return result;
  };
}

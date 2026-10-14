import type { RefObject } from "react";
import type { OfficeFrameAIGrant } from "@uniwork/core/api/endpoints/office-frame";
import { docsFrameError, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import {
  DocsProtocolError,
  type AppOpenResult,
  type Capabilities,
  type OfficeModule,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
} from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import type { FrameBlock } from "./frame-remote-version";
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
   * An AI turn runs in the frame (its `aiRun` events). Held per frame: a frame that unloads or
   * loses its endpoint mid-turn reads idle, since it can no longer say so itself.
   */
  aiRunning: boolean;
  /** The document was deleted or this user lost access: every Save is refused (EXPERIENCE.md › S6). */
  blocked: FrameBlock | null;
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
 * by the server at mint); `uniworkAi` follows `ai.uniwork_ai` the same way, and
 * each cloud tool needs `ai` or `uniworkAi` plus its own grant. The frame then calls
 * the frame-token AI routes itself; a viewer keeps AI (it never saves).
 */
export function officeModuleCapabilities(module: OfficeModule, readonly: boolean, api: DocsFrameApi, aiGrant?: OfficeFrameAIGrant, desktopOpen = false, download = false): Capabilities {
  const spec = officeModuleSpec(module);
  const grant = spec.grant;
  const on = (key: keyof Capabilities) => grant[key] === true;
  const ai = spec.ai === true && aiGrant?.ai === true;
  // UniWork AI (G6-05) is its own grant, independent of BYOK `ai`.
  const uniworkAi = spec.ai === true && aiGrant?.uniwork_ai === true;
  // The cloud tools serve either AI, so an organization with only UniWork AI still gets the ones it is granted.
  const cloud = ai || uniworkAi;
  return {
    ...grant,
    save: on("save") && !readonly, saveAs: on("saveAs") && !readonly && Boolean(api.saveAs), recents: on("recents"), print: on("print"),
    exportPdf: on("exportPdf") && Boolean(api.export), exportHtml: on("exportHtml"),
    attachments: on("attachments") && !readonly && Boolean(api.addAttachments), images: on("images") && !readonly && (module === "docs" || Boolean(api.uploadImage)),
    ai, uniworkAi, webSearch: cloud && aiGrant?.web_search === true, imageSearch: cloud && aiGrant?.image_search === true,
    imageGeneration: cloud && aiGrant?.image_generation === true,
    // The host's own "Open in desktop app" is only for a user who may edit.
    desktopOpen: desktopOpen && !readonly,
    // The host delivers the frame's bytes itself (api.download), only to a user who may edit.
    download: download && !readonly,
  };
}

export const unauthorized = () => new DocsProtocolError({ code: "unauthorized", message: "frame token unavailable" });
export const readOnly = (type: string) => new DocsProtocolError({ code: "forbidden", message: `${type} is not allowed for a read-only viewer`, status: 403 });

export const shapeOf = (error: unknown): ProtocolErrorShape => docsFrameError(error).toShape();

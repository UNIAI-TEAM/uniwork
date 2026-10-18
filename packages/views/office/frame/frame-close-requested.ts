import type { RefObject } from "react";
import type { DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import type { CloseRequestedPayload, ProtocolErrorShape } from "@uniwork/core/office/docs-frame-protocol";
import { leaveGuardAllows } from "../../navigation/leave-guard";
import type { NavigationAdapter } from "../../navigation/types";
import {
  armWatchdog,
  saveBlockedMaxBytes,
  shapeOf,
  type DocsFrameSaveBlocked,
  type DocsFrameSaveOutcome,
  type DocsFrameSaveState,
  type DocsFrameSessionOptions,
  type FrameLife,
  type HostSaveWatch,
} from "./docs-frame-session-model";

const HOST_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/**
 * Whether any host dialog sits on top of `surfaceRoot` (or on the page at all
 * when `surfaceRoot` is not itself inside a dialog). Used by the frame's
 * `close_requested` handler so an Esc forwarded from the iframe never closes
 * the underlying document view or source viewer while a host dialog is open.
 */
export function hasHostDialogAbove(surfaceRoot: Element | null): boolean {
  if (typeof document === "undefined") return false;
  const ownDialog = surfaceRoot?.closest(HOST_DIALOG_SELECTOR) ?? null;
  for (const dialog of Array.from(document.querySelectorAll(HOST_DIALOG_SELECTOR))) {
    if (dialog === ownDialog) continue;
    if (ownDialog && ownDialog.contains(dialog)) return true;
    if (!ownDialog || !dialog.contains(ownDialog)) return true;
  }
  return false;
}

/**
 * Subscribe to the frame's `close_requested` event (UNI-1876, UNI-1901) and
 * forward it to `onCloseRequested` only while the session is live, has
 * completed its handshake, has no save in flight (`save`, `saveAs`, `saveCopy`,
 * or page `host.save`), and has neither a frame modal nor the save-blocked
 * dialog open.
 */
export function onCloseRequestedEvent(
  endpoint: DocsFrameHost,
  deps: {
    isLiveAndReady: () => boolean;
    isSaving: () => boolean;
    isModalOrBlocked: () => boolean;
    onCloseRequested: (payload: CloseRequestedPayload) => void;
  },
): void {
  endpoint.on("close_requested", (payload) => {
    if (payload.reason !== "escape") return;
    if (!deps.isLiveAndReady() || deps.isSaving() || deps.isModalOrBlocked()) return;
    deps.onCloseRequested(payload);
  });
}

/**
 * Leave the full document view on `close_requested` the same way the host's
 * own Back / Esc path does: through `leaveGuardAllows(libraryHref)` (which
 * opens the in-app leave dialog when dirty) and then `navigation.push`.
 * Ignores the event while a host dialog sits on top or while a leave is in
 * flight; an allowed leave whose push did not unmount the frame arms again.
 */
export function requestDocumentFrameLeave(deps: {
  container: HTMLElement | null;
  libraryHref: string | undefined;
  navigation: NavigationAdapter | null;
  leaveOpen: boolean;
  leavingRef: { current: boolean };
}): void {
  const { container, libraryHref, navigation, leaveOpen, leavingRef } = deps;
  if (!libraryHref || !navigation || leaveOpen || leavingRef.current) return;
  if (hasHostDialogAbove(container)) return;
  leavingRef.current = true;
  void leaveGuardAllows(libraryHref).then((allowed) => {
    // An allowed leave usually unmounts this frame with the view; when it does not
    // (same href, an adapter that refused), later Esc presses must still leave.
    if (allowed) {
      navigation.push(libraryHref);
    }
    leavingRef.current = false;
  });
}

/**
 * Send a page-initiated `host.save` request to the live frame, guarded by the
 * session's `HostSaveWatch` watchdog and size-blocked dialog handling.
 */
export async function runHostSave(deps: {
  reason: "user" | "navigate";
  host: DocsFrameHost | null;
  frameLife: RefObject<FrameLife>;
  hostSave: RefObject<HostSaveWatch | null>;
  modalOpen: RefObject<boolean>;
  savedOnce: RefObject<boolean>;
  saveBlockedOpen: RefObject<boolean>;
  latest: RefObject<{ options: DocsFrameSessionOptions; documentLimits: { upload_max_bytes: number } }>;
  setSaveState: (state: DocsFrameSaveState) => void;
  setSaveBlocked: (blocked: DocsFrameSaveBlocked | null) => void;
}): Promise<DocsFrameSaveOutcome> {
  const { reason, host, frameLife, hostSave, modalOpen, savedOnce, saveBlockedOpen, latest, setSaveState, setSaveBlocked } = deps;
  // One Save at a time: a second one (the page is inert while the frame's dialog is open) is refused, unsent.
  const life = frameLife.current;
  if (!host || hostSave.current || life.state !== "live") return "failed";
  const watch: HostSaveWatch = { life, abort: new AbortController(), cause: null, settled: false, busy: 0, modal: modalOpen.current, stored: false, timer: null };
  hostSave.current = watch;
  armWatchdog(watch);
  setSaveState("saving");
  const fail = (error: ProtocolErrorShape): DocsFrameSaveOutcome => {
    const blockedMax = saveBlockedMaxBytes(error, latest.current.documentLimits.upload_max_bytes);
    // The size dialog already explains a blocked save: the header says unsaved, not "could not be confirmed".
    setSaveState(blockedMax !== null ? "dirty" : "error");
    if (blockedMax !== null) {
      saveBlockedOpen.current = true;
      setSaveBlocked({ maxBytes: blockedMax });
      return "failed";
    }
    if (error.code === "too_large" && saveBlockedOpen.current) return "failed";
    latest.current.options.onError(error, { fatal: false });
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
    clearTimeout(watch.timer ?? undefined);
    watch.timer = null;
    if (hostSave.current === watch) hostSave.current = null;
  }
}

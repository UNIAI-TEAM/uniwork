"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createOfficeFrameApi, createOfficeFrameSourceApi, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { FileMeta, OfficeModule, ProtocolErrorShape, SavedPayload, Theme } from "@uniwork/core/office/docs-frame-protocol";
import { officeFrameSrc, officeModuleSpec } from "@uniwork/core/office/office-modules";
import type { Document } from "@uniwork/core/types/document";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { HeaderActionsFill, useHeaderActionsSlotAvailable } from "../../layout/header-actions-slot";
import { useOptionalNavigation } from "../../navigation";
import { registerLeaveGuard } from "../../navigation/leave-guard";
import type { DesktopOpenOutcome } from "../desktop-open-action";
import { LeaveDialog } from "../leave-dialog";
import { SaveStatus } from "../save-status";
import { OfficeFileActions, OfficeTooLargeNotice } from "../too-large-notice";
import { FrameLagBanner, useFrameLagBanner } from "./frame-lag-banner";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { DocsFrameFailure } from "./docs-frame-failure";
import { useFrameFocus } from "./frame-focus";
import { useDocsFrameRefusal } from "./docs-frame-refusal";
import { dimChromeAround } from "./frame-modal-chrome";
import { FrameDesktopOpenAction, type FrameDesktopOpenProps } from "./frame-desktop-open";
import { FrameSaveBlockedDialog, FrameSizeWarningChip } from "./frame-size-ui";
import { useDocsFrameSession } from "./use-docs-frame-session";
import type { OfficeFrameFileRef } from "./docs-frame-session-model";
import { useFrameEditLock } from "./frame-edit-lock";
import { useFrameComments } from "./use-frame-comments";
import { hasHostDialogAbove, requestDocumentFrameLeave } from "./frame-close-requested";
import { useFirstSaveNaming } from "./first-save-naming";

export interface OfficeModuleFrameControls {
  save: () => Promise<boolean>;
  print: () => Promise<boolean>;
}

export interface OfficeModuleFrameProps {
  /** The genoffice web module; must be the module the server derives for the document. */
  module: OfficeModule;
  wsId: string;
  /** The file the frame opens; `kind: "source"` is a file from another module, always read-only (UNI-1869). */
  fileRef: OfficeFrameFileRef;
  /** Document title, for the frame's accessible name until the editor reports its own. */
  title: string;
  /** Pinned frame build (the web app's sync pin); the frame is served same-origin. */
  frameVersion: string;
  /** Where the frame's `api.*` requests go; defaults to the UniWork office-frame routes. */
  api?: DocsFrameApi;
  readonly?: boolean;
  /** Size the iframe to the height the frame reports instead of filling the parent. */
  fitContent?: boolean;
  onTitleChange?: (title: string) => void;
  onSaved?: (saved: SavedPayload) => void;
  /** The user saved a copy; the frame now edits that new document. */
  onSavedAs?: (documentId: string, name: string) => void;
  /** Header actions (save, print) for the page that hosts the frame. */
  controlsRef?: MutableRefObject<OfficeModuleFrameControls | null>;
  /**
   * "Open in desktop app" wiring (apps/web/platform/office-frame/desktop-open-props.ts).
   * Shown once the frame is ready and only for a user who may edit; absent = no action.
   */
  desktopOpen?: FrameDesktopOpenProps;
  /** The workspace's document list: a reader who is refused the document is offered the way back there. */
  libraryHref?: string;
  /** The user's effective level on the document (`my_level`); the editor's comments panel shows only what it allows. */
  myLevel?: string | null;
  /** The comment a deep link names (`?comment=`): the editor's panel scrolls to it when it has comments. */
  revealCommentId?: string | null;
  /** The editor says whether its own panel is the page's comments panel (a frame that predates comments says no). */
  onFrameCommentsChange?: (framePanel: boolean) => void;
  /** The session failed for good (mint refused, bundle missing, handshake timeout): the host may close the frame's host surface. */
  onSessionFailure?: (failure: ProtocolErrorShape) => void;
  /** Called when the frame sends `close_requested {reason: 'escape'}`; defaults on a document route to leaving to `libraryHref` through the leave guard. */
  onCloseRequested?: () => void;
  /** Stored document size in bytes, for the size-based lag banner fallback when the browser lacks a lag PerformanceObserver. */
  fileSizeBytes?: number | null;
  /** The open document row (UNI-1847): an unnamed blank's first save asks for its name. */
  documentDetail?: Document;
  /** Injectable feature-detection seam for `PerformanceObserver` `longtask`/`event` support. */
  hasLagObserver?: () => boolean;
  /** Injectable StorageAdapter seam for per-document lag banner dismissal (`office.lagBanner.dismissed:<documentId>`). */
  lagStorage?: Pick<StorageAdapter, "getItem" | "setItem">;
  className?: string;
}

// One stateless API per module, shared by every frame of it.
const defaultApis = new Map<OfficeModule, DocsFrameApi>();
const defaultSourceApis = new Map<OfficeModule, DocsFrameApi>();
function defaultFrameApi(module: OfficeModule, isSource: boolean): DocsFrameApi {
  const map = isSource ? defaultSourceApis : defaultApis;
  let api = map.get(module);
  if (!api) {
    api = isSource ? createOfficeFrameSourceApi(module) : createOfficeFrameApi(module);
    map.set(module, api);
  }
  return api;
}

const KNOWN_ERRORS = new Set(["unauthorized", "forbidden", "not_found", "conflict", "too_large", "rate_limited", "network", "unsupported", "timeout", "busy", "feature_disabled"]);

/** A document name without its file extension (".docx", ".pdf", ...), for naming a copy. */
const stripExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

/** next-themes answers the resolved theme; without its provider the root class does. */
function useFrameTheme(): Theme {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme === "dark" || resolvedTheme === "light") return resolvedTheme;
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * A genoffice editor in a same-origin iframe: Docs (GO-D2, UNI-1013) and the
 * other web modules (UNI-1014/1015/1016), one host for all. The page never
 * shares cookies with the frame: it mints a short-lived token for this one
 * document and hands it over in `init`; every API call the frame needs
 * travels back over postMessage and is made here.
 */
export function OfficeModuleFrame({
  module, wsId, fileRef, title, frameVersion, api, readonly = false, fitContent = false,
  onTitleChange, onSaved, onSavedAs, controlsRef, desktopOpen, libraryHref, myLevel, revealCommentId,
  onFrameCommentsChange, onSessionFailure, onCloseRequested, fileSizeBytes, documentDetail, hasLagObserver, lagStorage, className,
}: OfficeModuleFrameProps) {
  const isSource = fileRef.kind === "source";
  const frameApi = api ?? defaultFrameApi(module, isSource);
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const { t: tRoot } = useTranslation();
  const headerSlot = useHeaderActionsSlotAvailable();
  const theme = useFrameTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameTitle, setFrameTitle] = useState<string | null>(null);
  const src = officeFrameSrc(module, frameVersion);
  const frameOrigin = useMemo(() => (typeof window === "undefined" ? "" : new URL(src, document.baseURI).origin), [src]);
  const tRef = useRef(t);
  tRef.current = t;
  const tRootRef = useRef(tRoot);
  tRootRef.current = tRoot;
  const frameTitleRef = useRef(frameTitle);
  frameTitleRef.current = frameTitle;
  // The header action's flow, which the frame's `app.open` ("use the app" message) runs too.
  const appOpenRef = useRef<(() => Promise<DesktopOpenOutcome>) | null>(null);

  const navigation = useOptionalNavigation();
  const leavingByEscRef = useRef(false);
  const lag = useFrameLagBanner({
    iframeRef, frameOrigin, module, documentId: fileRef.id,
    fileSizeBytes, hasLagObserver, lagStorage,
  });
  const frameComments = useFrameComments({ wsId, documentId: fileRef.id, myLevel, revealCommentId });
  const { framePanel } = frameComments;
  const onFrameCommentsChangeRef = useRef(onFrameCommentsChange);
  onFrameCommentsChangeRef.current = onFrameCommentsChange;
  // The document page's edit lock, when this frame is its editor (UNI-1645). A source has no
  // lock: it never reads the page's, whatever provider it sits under.
  const pageEditLock = useFrameEditLock();
  const editLock = isSource ? null : pageEditLock;
  // UNI-1847 (SAVE-01): the first save of a never-saved blank asks for its name before the
  // upload; every save entry point (header, leave, the frame's own Save) goes through it.
  // `onNamed` reaches the session's notifyRenamed through a ref: the session is created below.
  const notifyRenamedRef = useRef<((file: FileMeta) => void) | null>(null);
  const naming = useFirstSaveNaming({
    document: isSource ? null : (documentDetail ?? null),
    module,
    wsId,
    onNamed: (file) => notifyRenamedRef.current?.(file),
  });
  const session = useDocsFrameSession({
    iframeRef, frameOrigin, frameSrc: src, api: frameApi, module, wsId, fileRef, editLock,
    // A source is read-only by construction; its `ofs1.` token writes nowhere.
    readonly: readonly || isSource,
    // Only a stored document has the comments the binding serves.
    comments: isSource ? undefined : frameComments.binding,
    // The same my_level the binding reads: a `comment` level keeps a can_edit === false
    // token out of the readOnly profile, so the commenter still comments (RFH-1).
    myLevel,
    locale: i18n.language, theme,
    onTitle: (next) => { setFrameTitle(next); onTitleChange?.(next); },
    onSaved,
    onAppOpen: desktopOpen ? async () => (await appOpenRef.current?.()) ?? "unavailable" : undefined,
    onSavedAs: (copyId, name) => {
      lag.rebindDocument(copyId);
      // Say a copy was made: the copy opens in place and otherwise looks like the source.
      toast.success(tRootRef.current("documents.copy.done", { title: stripExtension(name) }));
      onSavedAs?.(copyId, name);
    },
    // The first save of a never-saved blank asks for its name before the upload (SAVE-01).
    firstSave: isSource ? undefined : naming,
    // The frame asks to save a copy under the source's own name: name it the way UniWork names a copy.
    copyName: (name) => {
      const base = stripExtension(name);
      const source = stripExtension(frameTitleRef.current ?? title);
      if (base.trim().toLocaleLowerCase() !== source.trim().toLocaleLowerCase()) return name;
      return `${tRootRef.current("documents.copy.title_placeholder", { title: base })}${name.slice(base.length)}`;
    },
    // "Download my version" in the frame's conflict dialog: "<title> (my version)", the host adds the extension.
    downloadName: () => tRootRef.current("office.docsFrame.mine_file_name", { title: stripExtension(frameTitleRef.current ?? title) }),
    onSourceWriteRefused: (kind) => {
      toast.error(tRef.current(kind === "export" ? "errors.read_only_source_export" : "errors.read_only_source"));
    },
    onError: (error: ProtocolErrorShape, { fatal }) => {
      if (error.code === "cancelled" || (fatal && onSessionFailureRef.current)) return;
      const key = KNOWN_ERRORS.has(error.code) ? error.code : "internal";
      toast.error(tRef.current(`errors.${key}`));
    },
    onCloseRequested: () => {
      if (onCloseRequested) {
        if (!hasHostDialogAbove(containerRef.current)) onCloseRequested();
        return;
      }
      requestDocumentFrameLeave({ container: containerRef.current, libraryHref, navigation, leaveOpen, leavingRef: leavingByEscRef });
    },
  });
  notifyRenamedRef.current = session.notifyRenamed;
  // A session that failed for good (mint refused, bundle missing, timeout) still renders its own
  // failure view; the host embedding it (the source-file viewer) may close its surface instead.
  const onSessionFailureRef = useRef(onSessionFailure);
  onSessionFailureRef.current = onSessionFailure;
  // Once per failure: the session's failure object is rebuilt on every render, so only the edge fires.
  const sessionFailed = session.status === "failed";
  const failureRef = useRef(session.failure);
  failureRef.current = session.failure;
  useEffect(() => {
    if (sessionFailed && failureRef.current) onSessionFailureRef.current?.(failureRef.current);
  }, [sessionFailed]);
  const { dirty, saveState, print } = session;
  // The page's own panel is hidden only while a frame serves comments. A re-key keeps the claim
  // (use-frame-comments holds it until the next ack); a failed frame no longer serves anything, and
  // an unmount (module fallback, error view, another document) takes it back in the cleanup.
  const claimsComments = framePanel && session.status !== "failed";
  useEffect(() => {
    onFrameCommentsChangeRef.current?.(claimsComments);
    return () => onFrameCommentsChangeRef.current?.(false);
  }, [claimsComments]);
  const saveSession = session.save;
  // Header Save and the desktop handoff only need to know whether the edits are now on the server
  // (a new version, or the newest one reloaded over them).
  const save = useCallback(async () => {
    const outcome = await saveSession("user");
    return outcome === "saved" || outcome === "reloaded";
  }, [saveSession]);

  // A dialog inside the frame is modal for the whole page: dim and inert the chrome around the frame.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!session.modal || !container) return undefined;
    return dimChromeAround(container);
  }, [session.modal]);

  useEffect(() => {
    if (!controlsRef) return undefined;
    controlsRef.current = { save, print };
    return () => { controlsRef.current = null; };
  }, [controlsRef, print, save]);

  // Ctrl/Cmd+P while focus sits in the page (not the frame) prints the document, not the page.
  useEffect(() => {
    // The frame's own dialog is modal for the page: the page's shortcuts wait until it closes.
    if (session.status !== "ready" || session.modal) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [print, session.modal, session.status]);

  // Unsaved edits: the in-app leave dialog, and the browser's own prompt on unload.
  const [leaveOpen, setLeaveOpen] = useState(false);
  // A leave the frame's dialog cancelled closes this one with its save still "failed": a fresh
  // instance (mounted while closed) keeps that failure line from showing on the next leave.
  const [leaveRound, setLeaveRound] = useState(0);
  const leaveResolve = useRef<((allowed: boolean) => void) | null>(null);
  // A leave's Save that the frame's dialog took over: the leave dialog stays closed until that Save
  // answers, even once the frame's dialog has closed, and comes back only if it failed.
  const leaveSaving = useRef(false);
  const [leaveHeld, setLeaveHeld] = useState(false);
  useEffect(() => { if (session.modal && leaveSaving.current) setLeaveHeld(true); }, [session.modal]);
  const finishLeave = (allowed: boolean) => {
    const resolve = leaveResolve.current;
    leaveResolve.current = null;
    setLeaveOpen(false);
    setLeaveHeld(false);
    resolve?.(allowed);
  };
  // The editor failed for good and its failure screen replaced the leave dialog: the leave that
  // was pending (a Save in flight, or the dialog being read) ends as refused, since nothing is
  // left to answer it. Later leaves have no editor to save, so the guard below is not registered.
  const failed = session.status === "failed";
  useEffect(() => { if (failed) finishLeave(false); }, [failed]);
  useEffect(() => {
    if (!dirty || failed) return undefined;
    const unregister = registerLeaveGuard(() => new Promise<boolean>((resolve) => {
      leaveResolve.current?.(false);
      leaveResolve.current = resolve;
      setLeaveOpen(true);
    }));
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { unregister(); window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [dirty, failed]);
  useEffect(() => () => { leaveResolve.current?.(false); }, []);
  // Closing a page dialog (leave, save blocked) hands keyboard focus back to the editor in the
  // frame, so Ctrl+S works without a click, not to the page element that had it before.
  const { focusFrame, finalFocus } = useFrameFocus(iframeRef);

  // "Continue on web" removes the button that has focus: the frame takes focus only once the
  // banner is gone, or the browser drops focus to the body when it unmounts the button.
  const lagOpen = lag.shouldShow(session.status === "ready");
  const refocusAfterLag = useRef(false);
  useEffect(() => {
    if (lagOpen || !refocusAfterLag.current) return;
    refocusAfterLag.current = false;
    focusFrame();
  }, [lagOpen, focusFrame]);

  // When the frame's dialog closes, the keyboard goes back into the frame, not to the page's body.
  const wasModal = useRef(false);
  useEffect(() => {
    if (wasModal.current && !session.modal) focusFrame();
    wasModal.current = session.modal;
  }, [session.modal, focusFrame]);

  // Save stays reachable in the page header at every width (an icon on a phone, labelled from `sm`).
  // It is quiet while nothing is unsaved and stays in the tab order when it is.
  const saveLabel = tRoot("office.shell.save_to_cloud");
  const saveQuiet = saveState === "ready" || saveState === "saved";
  const saving = saveState === "saving";
  const headerStatus = useMemo(
    // Idle ("No changes") yields to the title on a phone; anything the user must know about
    // (unsaved, saving, saved, failed) stays visible at every width.
    () => (
      <>
        <SaveStatus status={saveState} compact className={cn("mr-2 whitespace-nowrap", saveState === "ready" ? "hidden sm:flex" : "flex")} />
        <Button
          type="button"
          size="sm"
          variant={saveQuiet ? "outline" : "default"}
          aria-disabled={saveQuiet || saving || undefined}
          aria-label={saveLabel}
          title={saveLabel}
          onClick={() => { if (!saveQuiet && !saving) void save(); }}
          data-office-frame-save
        >
          <Save aria-hidden />
          <span className="sr-only sm:not-sr-only">{tRoot("office.shell.save")}</span>
        </Button>
      </>
    ),
    [saveState, saveQuiet, saving, saveLabel, save, tRoot],
  );

  // The server refused the token mint because the module's flag is off for this organization.
  const featureDisabled = session.failure?.details?.["apiCode"] === "feature_disabled";
  // `open_refused` from the frame (or Sheets `too_large` error) replaces the frame with the refusal notice.
  const refusalReason = lag.openRefused?.reason
    ?? (module === "sheets" && session.failure?.code === "too_large" ? "too_large_to_open" : null);
  const refuse = useDocsFrameRefusal();
  const resetLagAttempt = lag.resetAttempt;
  useEffect(() => { if (session.attempt > 0) resetLagAttempt(); }, [resetLagAttempt, session.attempt]);
  useEffect(() => { if (refusalReason) refuse?.(refusalReason); }, [refusalReason, refuse]);

  if (refusalReason) {
    return <OfficeTooLargeNotice format={officeModuleSpec(module).format} reason={refusalReason} />;
  }

  if (session.status === "failed") {
    const code = featureDisabled ? "feature_disabled" : session.failure?.code ?? "internal";
    return (
      <DocsFrameFailure
        className={className}
        failure={session.failure}
        code={KNOWN_ERRORS.has(code) ? code : "internal"}
        module={module}
        onRetry={session.retry}
        libraryHref={libraryHref}
      />
    );
  }

  const booting = session.status !== "ready";
  return (
    <div
      ref={containerRef}
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}
      data-office-docs-frame
      data-office-module={module}
      data-state={session.status}
      data-dirty={dirty || undefined}
      data-save-state={saveState}
      data-frame-modal={session.modal || undefined}
    >
      {headerSlot && !session.viewOnly && session.status === "ready" ? (
        // The page header around the frame says whether the frame's edits are saved.
        <HeaderActionsFill actions={headerStatus} />
      ) : null}
      <FrameLagBanner
        open={lagOpen}
        onOpenApp={desktopOpen && !session.viewOnly ? () => { void appOpenRef.current?.(); } : undefined}
        onContinue={() => { refocusAfterLag.current = true; lag.dismiss(); }}
      />
      {desktopOpen && !booting && !session.viewOnly ? (
        <FrameDesktopOpenAction desktopOpen={desktopOpen} documentId={fileRef.id} dirty={dirty} save={save} requestRef={appOpenRef} />
      ) : null}
      <FrameSizeWarningChip warning={session.sizeWarning} />
      <iframe
        key={session.attempt}
        ref={iframeRef}
        src={src}
        title={t("frame_label", { title: frameTitle ?? title })}
        className={cn("w-full min-w-0 border-0 bg-background", fitContent ? "shrink-0" : "min-h-0 flex-1", booting && "invisible")}
        style={fitContent && session.height !== null ? { height: session.height } : undefined}
        allow="clipboard-read; clipboard-write"
        referrerPolicy="same-origin"
        data-testid="office-docs-frame-iframe"
      />
      {booting && session.slow ? (
        <div className="absolute inset-0 flex items-center justify-center p-6" data-testid="office-docs-frame-slow" role="status" aria-live="polite">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <Spinner className="size-6 text-muted-foreground motion-reduce:animate-none" />
            <div className="space-y-1">
              <p className="text-body font-semibold">{t("slow.title")}</p>
              <p className="text-caption text-muted-foreground text-pretty">{t("slow.description")}</p>
            </div>
            {/* A slow boot already offers the ways on that its failure would: the app and the download. */}
            <OfficeFileActions
              leading={(
                <Button type="button" variant="outline" size="sm" onClick={session.retry}>
                  {t("retry")}
                </Button>
              )}
            />
          </div>
        </div>
      ) : booting ? (
        <div className="absolute inset-0 space-y-3 p-4" role="status" aria-live="polite" data-testid="office-docs-frame-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="mx-auto h-[min(55vh,32rem)] min-h-48 w-full max-w-3xl" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : null}
      <FrameSaveBlockedDialog
        saveBlocked={session.saveBlocked}
        onDownload={session.downloadCopy}
        onDismiss={session.dismissSaveBlocked}
        finalFocus={finalFocus}
      />
      {/*
        A Save from here may meet a newer version: the frame then shows its own conflict dialog,
        which owns the page meanwhile, so this one steps aside until the frame answers. The leave
        waits for that answer; Cancel in the frame's dialog means stay.
      */}
      <LeaveDialog
        key={`leave-${leaveRound}`}
        open={leaveOpen && !session.modal && !leaveHeld}
        dirty
        onOpenChange={(open) => { if (!open) finishLeave(false); }}
        onSave={async () => {
          leaveSaving.current = true;
          const outcome = await saveSession("navigate").finally(() => { leaveSaving.current = false; });
          if (outcome === "cancelled") { finishLeave(false); setLeaveRound((n) => n + 1); }
          // Failed: the leave dialog comes back with its failure line. Saved or reloaded: the
          // leave goes ahead and finishLeave closes it, so it never reopens in between.
          if (outcome === "failed") setLeaveHeld(false);
          return outcome === "saved" || outcome === "reloaded";
        }}
        onDiscard={async () => true}
        onChoice={(choice) => { if (choice !== "stay") finishLeave(true); }}
        finalFocus={finalFocus}
      />
      {/* The first save of a never-saved blank names it first (UNI-1847, SAVE-01). */}
      {naming.dialog}
    </div>
  );
}

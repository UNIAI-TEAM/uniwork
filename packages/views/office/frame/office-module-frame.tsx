"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createOfficeFrameApi, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { OfficeModule, ProtocolErrorShape, SavedPayload, Theme } from "@uniwork/core/office/docs-frame-protocol";
import { officeFrameSrc, officeModuleSpec } from "@uniwork/core/office/office-modules";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { HeaderActionsFill, useHeaderActionsSlotAvailable } from "../../layout/header-actions-slot";
import { registerLeaveGuard } from "../../navigation/leave-guard";
import type { DesktopOpenOutcome } from "../desktop-open-action";
import { LeaveDialog } from "../leave-dialog";
import { SaveStatus } from "../save-status";
import { DocsFrameFailure } from "./docs-frame-failure";
import { useDocsFrameRefusal } from "./docs-frame-refusal";
import { dimChromeAround } from "./frame-modal-chrome";
import { FrameDesktopOpenAction, type FrameDesktopOpenProps } from "./frame-desktop-open";
import { useDocsFrameSession } from "./use-docs-frame-session";

export interface OfficeModuleFrameControls {
  save: () => Promise<boolean>;
  print: () => Promise<boolean>;
}

export interface OfficeModuleFrameProps {
  /** The genoffice web module; must be the module the server derives for the document. */
  module: OfficeModule;
  wsId: string;
  documentId: string;
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
   * "Open in desktop app" wiring (the G3 host's, apps/web/platform/office/desktop-open-props.ts).
   * Shown once the frame is ready and only for a user who may edit, the G3 rule; absent = no action.
   */
  desktopOpen?: FrameDesktopOpenProps;
  className?: string;
}

// One stateless API per module, shared by every frame of it.
const defaultApis = new Map<OfficeModule, DocsFrameApi>();
function defaultFrameApi(module: OfficeModule): DocsFrameApi {
  let api = defaultApis.get(module);
  if (!api) {
    api = createOfficeFrameApi(module);
    defaultApis.set(module, api);
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
  module, wsId, documentId, title, frameVersion, api, readonly = false, fitContent = false,
  onTitleChange, onSaved, onSavedAs, controlsRef, desktopOpen, className,
}: OfficeModuleFrameProps) {
  const frameApi = api ?? defaultFrameApi(module);
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

  const session = useDocsFrameSession({
    iframeRef, frameOrigin, frameSrc: src, api: frameApi, module, wsId, documentId, readonly,
    locale: i18n.language, theme,
    onTitle: (next) => { setFrameTitle(next); onTitleChange?.(next); },
    onSaved,
    onAppOpen: desktopOpen ? async () => (await appOpenRef.current?.()) ?? "unavailable" : undefined,
    onSavedAs: (copyId, name) => {
      // Say a copy was made: the copy opens in place and otherwise looks like the source.
      toast.success(tRootRef.current("documents.copy.done", { title: stripExtension(name) }));
      onSavedAs?.(copyId, name);
    },
    // The frame asks to save a copy under the source's own name: name it the way UniWork names a copy.
    copyName: (name) => {
      const base = stripExtension(name);
      const source = stripExtension(frameTitleRef.current ?? title);
      if (base.trim().toLocaleLowerCase() !== source.trim().toLocaleLowerCase()) return name;
      return `${tRootRef.current("documents.copy.title_placeholder", { title: base })}${name.slice(base.length)}`;
    },
    onError: (error: ProtocolErrorShape) => {
      if (error.code === "cancelled") return;
      const key = KNOWN_ERRORS.has(error.code) ? error.code : "internal";
      toast.error(tRef.current(`errors.${key}`));
    },
  });
  const { dirty, saveState, save, print } = session;

  // A dialog inside the frame is modal for the whole page: dim and inert the chrome around the frame.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!session.modal || !container) return undefined;
    return dimChromeAround(container);
  }, [session.modal]);

  useEffect(() => {
    if (!controlsRef) return undefined;
    controlsRef.current = { save: () => save("user"), print };
    return () => { controlsRef.current = null; };
  }, [controlsRef, print, save]);

  // Ctrl/Cmd+P while focus sits in the page (not the frame) prints the document, not the page.
  useEffect(() => {
    if (session.status !== "ready") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [print, session.status]);

  // Unsaved edits: the in-app leave dialog, and the browser's own prompt on unload.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((allowed: boolean) => void) | null>(null);
  const finishLeave = (allowed: boolean) => {
    const resolve = leaveResolve.current;
    leaveResolve.current = null;
    setLeaveOpen(false);
    resolve?.(allowed);
  };
  useEffect(() => {
    if (!dirty) return undefined;
    const unregister = registerLeaveGuard(() => new Promise<boolean>((resolve) => {
      leaveResolve.current?.(false);
      leaveResolve.current = resolve;
      setLeaveOpen(true);
    }));
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { unregister(); window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [dirty]);
  useEffect(() => () => { leaveResolve.current?.(false); }, []);
  // Closing the leave dialog (Stay, Escape, the close button) hands keyboard focus back to the
  // editor in the frame, so Ctrl+S works without a click. Returning false keeps Base UI from
  // putting it on the page element that had it before; the frame document keeps its own
  // active element, so focusing its window lands in the editor.
  const unmounting = useRef(false);
  // A layout cleanup runs before the dialog's own on unmount: a leave that navigates away has no frame to refocus.
  useLayoutEffect(() => () => { unmounting.current = true; }, []);
  const focusFrame = () => {
    const iframe = iframeRef.current;
    if (unmounting.current || !iframe?.isConnected) return true;
    iframe.focus();
    try { iframe.contentWindow?.focus(); } catch { /* a frame that is not same-origin keeps the iframe focus */ }
    return false;
  };

  const headerStatus = useMemo(
    // Idle ("No changes") yields to the title on a phone; anything the user must know about
    // (unsaved, saving, saved, failed) stays visible at every width.
    () => <SaveStatus status={saveState} compact className={cn("mr-2 whitespace-nowrap", saveState === "ready" ? "hidden sm:flex" : "flex")} />,
    [saveState],
  );

  // The server refused the token mint because the module's flag is off for this organization.
  const featureDisabled = session.failure?.details?.["apiCode"] === "feature_disabled";
  // A module with a size cap (Sheets, GO-D3): a mint refused with 413 or a frame that answers its
  // open with too_large hands the document to the G3 editor the same way.
  const tooLarge = officeModuleSpec(module).maxBytes !== undefined && session.failure?.code === "too_large";
  // The server derived another module than the page mounted (odd mime/name pairs): the G3 host,
  // which judges the stored file itself, takes over.
  const moduleMismatch = session.failure?.code === "malformed" && session.failure.details?.["tokenModule"] !== undefined;
  // The frame bundle itself never loaded (404/5xx, or no handshake in time): not a document problem,
  // so the G3 editor takes over where the page has one, and the failure panel explains it where not.
  const bundleFailed = session.failure?.details?.["frameBundle"] !== undefined;
  const refuse = useDocsFrameRefusal();
  // A frame that did not load is the one switch the G3 host explains to the reader.
  useEffect(() => { if (featureDisabled || tooLarge || moduleMismatch || bundleFailed) refuse?.(bundleFailed ? "load" : undefined); }, [featureDisabled, tooLarge, moduleMismatch, bundleFailed, refuse]);

  if (session.status === "failed") {
    const code = featureDisabled ? "feature_disabled" : session.failure?.code ?? "internal";
    return (
      <DocsFrameFailure
        className={className}
        failure={session.failure}
        code={KNOWN_ERRORS.has(code) ? code : "internal"}
        module={module}
        onRetry={session.retry}
        onUseStandardEditor={refuse ? () => refuse() : null}
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
        // The page header around the frame says whether the frame's edits are saved, like the G3 header does.
        <HeaderActionsFill actions={headerStatus} />
      ) : null}
      {desktopOpen && !booting && !session.viewOnly ? (
        <FrameDesktopOpenAction desktopOpen={desktopOpen} documentId={documentId} workspaceId={wsId} dirty={dirty} save={() => save("user")} requestRef={appOpenRef} />
      ) : null}
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
            {/* Where the page has a G3 editor, switching now beats waiting; otherwise the reader can only retry. */}
            <Button type="button" variant="outline" size="sm" onClick={refuse ? () => refuse() : session.retry}>
              {refuse ? t("slow.use_standard") : t("retry")}
            </Button>
          </div>
        </div>
      ) : booting ? (
        <div className="absolute inset-0 space-y-3 p-4" role="status" aria-live="polite" data-testid="office-docs-frame-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="mx-auto h-[min(55vh,32rem)] min-h-48 w-full max-w-3xl" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : null}
      <LeaveDialog
        open={leaveOpen}
        dirty
        onOpenChange={(open) => { if (!open) finishLeave(false); }}
        onSave={() => save("navigate")}
        onDiscard={async () => true}
        onChoice={(choice) => { if (choice !== "stay") finishLeave(true); }}
        finalFocus={focusFrame}
      />
    </div>
  );
}

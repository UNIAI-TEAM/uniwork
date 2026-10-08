"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createDocsFrameApi, docsFrameSrc, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { ProtocolErrorShape, SavedPayload, Theme } from "@uniwork/core/office/docs-frame-protocol";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { registerLeaveGuard } from "../../navigation/leave-guard";
import { LeaveDialog } from "../leave-dialog";
import { useDocsFrameSession } from "./use-docs-frame-session";

export interface OfficeDocsFrameControls {
  save: () => Promise<boolean>;
  print: () => Promise<boolean>;
}

export interface OfficeDocsFrameProps {
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
  onSavedAs?: (documentId: string) => void;
  /** Header actions (save, print) for the page that hosts the frame. */
  controlsRef?: MutableRefObject<OfficeDocsFrameControls | null>;
  className?: string;
}

const defaultDocsFrameApi = createDocsFrameApi();

const KNOWN_ERRORS = new Set(["unauthorized", "forbidden", "not_found", "conflict", "too_large", "rate_limited", "network", "unsupported", "timeout", "busy"]);

/** next-themes answers the resolved theme; without its provider the root class does. */
function useFrameTheme(): Theme {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme === "dark" || resolvedTheme === "light") return resolvedTheme;
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The genoffice Docs editor in a same-origin iframe (GO-D2, UNI-1013). The
 * page never shares cookies with the frame: it mints a short-lived token for
 * this one document and hands it over in `init`; every API call the frame
 * needs travels back over postMessage and is made here.
 */
export function OfficeDocsFrame({
  wsId, documentId, title, frameVersion, api = defaultDocsFrameApi, readonly = false, fitContent = false,
  onTitleChange, onSaved, onSavedAs, controlsRef, className,
}: OfficeDocsFrameProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const theme = useFrameTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameTitle, setFrameTitle] = useState<string | null>(null);
  const src = docsFrameSrc(frameVersion);
  const frameOrigin = useMemo(() => (typeof window === "undefined" ? "" : new URL(src, document.baseURI).origin), [src]);
  const tRef = useRef(t);
  tRef.current = t;

  const session = useDocsFrameSession({
    iframeRef, frameOrigin, api, wsId, documentId, readonly,
    locale: i18n.language, theme,
    onTitle: (next) => { setFrameTitle(next); onTitleChange?.(next); },
    onSaved,
    onSavedAs,
    onError: (error: ProtocolErrorShape) => {
      if (error.code === "cancelled") return;
      const key = KNOWN_ERRORS.has(error.code) ? error.code : "internal";
      toast.error(tRef.current(`errors.${key}`));
    },
  });
  const { dirty, save, print } = session;

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

  if (session.status === "failed") {
    const code = session.failure?.code ?? "internal";
    return (
      <div className={cn("p-4", className)} data-office-docs-frame data-state="failed">
        <Alert variant="destructive" role="alert" data-testid="office-docs-frame-failed">
          <AlertTitle>{t("failed_title")}</AlertTitle>
          <AlertDescription>{t(`errors.${KNOWN_ERRORS.has(code) ? code : "internal"}`)}</AlertDescription>
          <Button className="mt-2" size="sm" variant="outline" onClick={session.retry}>
            {t("retry")}
          </Button>
        </Alert>
      </div>
    );
  }

  const booting = session.status !== "ready";
  return (
    <div
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}
      data-office-docs-frame
      data-state={session.status}
      data-dirty={dirty || undefined}
    >
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
      {booting ? (
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
      />
    </div>
  );
}

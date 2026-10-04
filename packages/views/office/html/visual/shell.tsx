"use client";

/**
 * HtmlVisualShell — the HTML editor's view shell.
 *
 * It owns the four view modes (source / split / preview / present), the zoom
 * ladder for the preview pane, and the H3-H8 mount points. It owns NO chrome:
 * the shared UNI-931 ribbon (task RB) renders the tab row, the command body and
 * the trailing Source | Split | Preview | Present control; the shared save
 * cluster (UNI-930) owns Save. This module is the canvas between them.
 *
 * The preview pane mounts ONLY through the injected `IsolatedPreviewPort`. No
 * iframe policy, sandbox, CSP or asset rule is built or weakened here; the
 * host's port stays the single place those decisions live. Present mode is the
 * same isolated preview, fullscreen - it never runs document scripts and never
 * asks the port for the ADR 0026 visual-edit capability (that is H5-H8's mode).
 *
 * Slots for later tasks (documented here, none implemented):
 *   H3 ops / H4 insert ribbon -> the caller passes `HtmlRibbonCommands` to
 *     `<HtmlRibbon>` and applies each intent through H3's pure ops; the shell
 *     only renders the canvas the ribbon sits above.
 *   H5 selection bridge -> `onPreviewSession` (the live port session) and
 *     `onPreviewEvent` (forwarded preview events).
 *   H6 float toolbar / H7 style panel / H8 inline edit -> the `overlay` slot,
 *     rendered above the canvas in every mode.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { HtmlSourceEditor } from "../source";
import type { AssetManifestLike } from "../../asset-manifest";
import type { IsolatedPreviewPort, PreviewSession } from "../../source-editor-types";
import {
  clampZoom,
  HTML_ZOOM_DEFAULT,
  HTML_ZOOM_MAX,
  HTML_ZOOM_MIN,
  htmlStatusFigures,
  previewVisibleIn,
  sourceVisibleIn,
  stepZoom,
  type HtmlViewMode,
} from "./shell-model";

export interface HtmlVisualShellProps {
  documentKey: string;
  /** Raw source text. The shell is controlled: the caller owns the text. */
  text: string;
  /** The mode the shell shows. Owned by the caller so the ribbon can drive it. */
  viewMode: HtmlViewMode;
  onViewModeChange: (mode: HtmlViewMode) => void;
  readOnly?: boolean;
  /** Fired on a source edit, never mid-IME composition (H1 owns that gate). */
  onChange?(next: string): void;
  onCheckpoint?(): void;
  /** The ONLY preview runtime. Absent -> the pane shows "preview unavailable". */
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  /** Called with the live preview session, or null on dispose (H5-H8 mount here). */
  onPreviewSession?(session: PreviewSession | null): void;
  /** Forwarded preview events (selection bridge / inspector, H5-H8). */
  onPreviewEvent?(event: { type: string }): void;
  /** Zoom ladder value in percent; owned by the caller for the status bar. */
  zoom: number;
  onZoomChange: (percent: number) => void;
  /** Selection in source offsets, or null; owned by the caller (H5-H8). */
  selection?: { from: number; to: number } | null;
  /** Overlay slot above the canvas: H6 float toolbar, H7 style panel, H8 inline edit. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * ZoomControls — − / value / + with a reset. It lives in the shell's own
 * toolbar strip, not floating over the canvas (brief C9).
 */
function ZoomControls({ zoom, onZoomChange, disabled }: { zoom: number; onZoomChange: (percent: number) => void; disabled: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.zoom" });
  return (
    <div className="flex items-center gap-0.5" data-testid="html-zoom">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("out")} disabled={disabled || zoom <= HTML_ZOOM_MIN} data-testid="html-zoom-out" onClick={() => onZoomChange(stepZoom(zoom, -1))} />
          }
        >
          <Minus aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("out")}</TooltipContent>
      </Tooltip>
      <span className="w-14 select-none text-center text-caption tabular-nums text-muted-foreground" aria-live="polite" data-testid="html-zoom-value">
        {t("level", { percent: zoom })}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("in")} disabled={disabled || zoom >= HTML_ZOOM_MAX} data-testid="html-zoom-in" onClick={() => onZoomChange(stepZoom(zoom, 1))} />
          }
        >
          <Plus aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("in")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("reset")} disabled={disabled || zoom === HTML_ZOOM_DEFAULT} data-testid="html-zoom-reset" onClick={() => onZoomChange(HTML_ZOOM_DEFAULT)} />
          }
        >
          <RotateCcw aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("reset")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The status bar's HTML figures: source length / line count / language on the
 * left; selection info and zoom on the right. Rendered through the shell's
 * status slot, never inside the tab or command row (brief C6/C10).
 */
function HtmlStatusBar({ text, selection = null, zoom }: { text: string; selection?: { from: number; to: number } | null; zoom: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.status" });
  const figures = htmlStatusFigures(text, selection);
  return (
    <>
      <span data-testid="html-status-figures" data-html-length={figures.length} data-html-lines={figures.lines} data-html-language="HTML">
        {t("figures", { length: figures.length, lines: figures.lines, language: "HTML" })}
      </span>
      <span className="flex items-center gap-2">
        <span data-testid="html-status-selection">
          {figures.selection ? t("selection", { from: figures.selection.from, to: figures.selection.to }) : t("selectionNone")}
        </span>
        <span data-testid="html-status-zoom" data-html-zoom={clampZoom(zoom)}>{t("zoom", { percent: clampZoom(zoom) })}</span>
      </span>
    </>
  );
}

/** Mount the injected preview port into a container; dispose on unmount. */
function PreviewPane({
  preview,
  title,
  text,
  manifest,
  onSession,
  onEvent,
}: {
  preview?: IsolatedPreviewPort;
  title: string;
  text: string;
  manifest: AssetManifestLike;
  onSession?: (session: PreviewSession | null) => void;
  onEvent?: (event: { type: string }) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<PreviewSession | null>(null);
  const [state, setState] = useState<"idle" | "ready" | "unavailable">("idle");
  const onSessionRef = useRef(onSession);
  const onEventRef = useRef(onEvent);
  onSessionRef.current = onSession;
  onEventRef.current = onEvent;
  const latestTextRef = useRef(text);
  latestTextRef.current = text;
  const latestManifestRef = useRef(manifest);
  latestManifestRef.current = manifest;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    if (!preview) {
      setState("unavailable");
      return undefined;
    }
    let active = true;
    setState("idle");
    void (async () => {
      try {
        const session = await preview.mount({
          container,
          format: "html",
          title,
          text: latestTextRef.current,
          manifest: latestManifestRef.current,
          onEvent: (event) => onEventRef.current?.(event),
        });
        if (!active) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
        onSessionRef.current?.(session);
        // Push the latest copy before marking ready so the first visible frame
        // cannot lag an edit that arrived while the mount was opening.
        await session.update?.(latestTextRef.current, latestManifestRef.current);
        if (!active) {
          session.dispose();
          sessionRef.current = null;
          return;
        }
        setState("ready");
      } catch {
        if (active) setState("unavailable");
      }
    })();
    return () => {
      active = false;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      onSessionRef.current?.(null);
    };
  }, [preview, title]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.update) return;
    try {
      const update = session.update(text, manifest);
      if (update && typeof (update as Promise<void>).catch === "function") {
        void (update as Promise<void>).catch(() => setState("unavailable"));
      }
    } catch {
      setState("unavailable");
    }
  }, [manifest, text]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden rounded-md border border-border bg-muted/10" data-testid="html-preview">
      {state === "unavailable" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.unavailable")}</p> : null}
      {state === "idle" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.loading")}</p> : null}
    </div>
  );
}

/**
 * The view shell. It renders exactly the panes the current mode asks for; the
 * ribbon and the save cluster are the caller's chrome.
 */
export function HtmlVisualShell({
  documentKey,
  text,
  viewMode,
  onViewModeChange,
  readOnly = false,
  onChange,
  onCheckpoint,
  preview,
  manifest,
  onPreviewSession,
  onPreviewEvent,
  zoom,
  onZoomChange,
  selection = null,
  overlay,
  className,
}: HtmlVisualShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  const title = t("title");
  const safeManifest = useMemo<AssetManifestLike>(() => manifest ?? { entries: [] }, [manifest]);
  const clampedZoom = clampZoom(zoom);
  const showSource = sourceVisibleIn(viewMode);
  const showPreview = previewVisibleIn(viewMode);
  const presenting = viewMode === "present";

  // Escape leaves present mode. Bound only while presenting.
  const onViewModeChangeRef = useRef(onViewModeChange);
  onViewModeChangeRef.current = onViewModeChange;
  useEffect(() => {
    if (!presenting) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onViewModeChangeRef.current("preview");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  const previewPane = showPreview ? (
    <div
      className="flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto p-1"
      data-testid="html-preview-scroll"
      data-html-zoom={clampedZoom}
    >
      <div className="h-full w-full" style={{ zoom: clampedZoom / 100 }}>
        <PreviewPane
          preview={preview}
          title={title}
          text={text}
          manifest={safeManifest}
          onSession={onPreviewSession}
          onEvent={onPreviewEvent}
        />
      </div>
    </div>
  ) : null;

  const sourcePane = showSource ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-testid="html-source-pane">
      <HtmlSourceEditor
        value={text}
        readOnly={readOnly}
        className="min-h-64 flex-1 overflow-hidden rounded-md border border-border bg-background"
        ariaLabel={t("source.label")}
        onChange={(next) => onChange?.(next)}
        onCheckpoint={onCheckpoint}
      />
    </div>
  ) : null;

  // Present mode is the isolated preview, fullscreen: no source pane, no chrome.
  if (presenting) {
    return (
      <div
        className={cn("fixed inset-0 z-50 flex flex-col bg-background p-3 text-foreground", className)}
        role="dialog"
        aria-modal="true"
        aria-label={t("present.label")}
        data-testid="html-shell"
        data-html-view="present"
        data-document-key={documentKey}
      >
        {previewPane}
        {overlay}
      </div>
    );
  }

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-testid="html-shell"
      data-html-view={viewMode}
      data-document-key={documentKey}
    >
      <div className="flex min-h-9 items-center justify-end gap-1 border-b border-border px-2" data-testid="html-shell-toolbar">
        <ZoomControls zoom={clampedZoom} onZoomChange={onZoomChange} disabled={!showPreview} />
      </div>
      <div className={cn("flex min-h-0 min-w-0 flex-1 gap-3 p-3", showSource && showPreview ? "flex-col lg:flex-row" : "flex-col")}>
        {sourcePane}
        {previewPane}
      </div>
      {overlay}
      <div
        className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-2 text-caption text-muted-foreground"
        role="group"
        aria-label={t("status.label")}
        data-testid="html-status"
      >
        <HtmlStatusBar text={text} selection={selection} zoom={clampedZoom} />
      </div>
    </div>
  );
}

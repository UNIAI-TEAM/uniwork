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
 *   H5 selection bridge -> the shell forwards every validated preview event
 *     into a `PreviewEventSink` (`onPreviewEvent` still sees each one) and
 *     mounts `HtmlSelectionOverlay` in the overlay slot; the committed
 *     selection is published through `onPreviewSelection`. The whole surface
 *     is behind the selection flag and is inert (read-only) when it is on.
 *   H6 float toolbar -> mounted by the shell in the overlay slot, anchored to
 *     the committed selection H5 publishes and gated by the same flag. Every
 *     action is an injected `HtmlFloatToolbarCommands` callback; the shell
 *     never applies an op itself (H3/H8 own the edit paths).
 *   H7 style panel / H8 inline edit -> the `overlay` slot, rendered above the
 *     canvas in every mode.
 *
 * The overlay contract (F5): the canvas is `relative`, so an `absolute` overlay
 * child positions against the canvas and not the viewport, in every mode. The
 * overlay slot renders LAST inside that canvas, so its children must
 * self-position (or be portaled) - it must never be an in-flow block that would
 * claim layout height from the canvas. Present mode is the same canvas
 * fullscreen (one root, a `fixed` class) rather than a second root, so entering
 * and leaving it keeps the isolated preview session mounted (F4).
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
import { createPreviewEventSink, type HtmlSelection, type PreviewEventSink } from "./selection/model";
import { HtmlSelectionOverlay } from "./selection/bridge";
import { HtmlFloatToolbar, type HtmlFloatToolbarCommands } from "./float-toolbar";
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
  /**
   * The H5 selection bridge's published selection: the committed `select`
   * element and its rect (or null when nothing is selected). Hover is
   * deliberately not reported here - it is tracking feedback, not a target
   * for H6-H8. Only ever called while the selection flag is on.
   */
  onPreviewSelection?(selection: HtmlSelection | null): void;
  /** The document title: the isolated preview iframe's accessible name. */
  title?: string;
  /** Zoom ladder value in percent; owned by the caller for the status bar. */
  zoom: number;
  onZoomChange: (percent: number) => void;
  /** Selection in source offsets, or null; owned by the caller (H5-H8). */
  selection?: { from: number; to: number } | null;
  /**
   * H6 float toolbar actions, injected by the caller. Every one is optional:
   * an absent action leaves its control inert - the icon buttons render
   * disabled, while the bold/italic toggles stay enabled and no-op. The shell
   * only forwards them - it never applies an op, so the toolbar stays
   * reviewable without the H3/H8 edit wiring.
   */
  floatCommands?: HtmlFloatToolbarCommands;
  /**
   * Overlay slot rendered last inside the `relative` canvas: H7 style panel,
   * H8 inline edit. Children self-position (absolute) or portal. The H6 float
   * toolbar is mounted by the shell itself, ahead of these children.
   */
  overlay?: ReactNode;
  className?: string;
}

/**
 * ZoomControls — − / value / + with a reset. It lives in the status bar's right
 * cluster beside the selection info (brief C10: "selection info + zoom
 * (− value +)"), never in a chrome row of its own and never floating over the
 * canvas (C9).
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
 * left; selection info and the zoom ladder on the right. Rendered through the
 * shell's status slot, never inside the tab or command row (brief C6/C10).
 */
function HtmlStatusBar({
  text,
  selection = null,
  zoom,
  onZoomChange,
  zoomDisabled,
}: {
  text: string;
  selection?: { from: number; to: number } | null;
  zoom: number;
  onZoomChange: (percent: number) => void;
  zoomDisabled: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.status" });
  const figures = htmlStatusFigures(text, selection);
  return (
    <>
      <span data-testid="html-status-figures" data-html-length={figures.length} data-html-lines={figures.lines} data-html-language="HTML">
        {t("figures", { length: figures.length, lines: figures.lines, language: "HTML" })}
      </span>
      <div className="flex items-center gap-2">
        <span data-testid="html-status-selection">
          {figures.selection ? t("selection", { from: figures.selection.from, to: figures.selection.to }) : t("selectionNone")}
        </span>
        <ZoomControls zoom={clampZoom(zoom)} onZoomChange={onZoomChange} disabled={zoomDisabled} />
      </div>
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
    // `data-html-preview-frame` is the selection bridge's structural hook; it
    // is separate from the `html-preview` testid so a test-only rename cannot
    // move the outline.
    <div ref={containerRef} className="h-full w-full overflow-hidden rounded-md border border-border bg-muted/10" data-testid="html-preview" data-html-preview-frame>
      {state === "unavailable" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.unavailable")}</p> : null}
      {state === "idle" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.loading")}</p> : null}
    </div>
  );
}

/**
 * The view shell. It renders exactly the panes the current mode asks for; the
 * ribbon and the save cluster are the caller's chrome.
 *
 * One root for all four modes (F4): present toggles `fixed inset-0` and the
 * dialog role through `cn`, so the isolated preview session survives entering
 * and leaving present instead of being disposed and re-mounted.
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
  onPreviewSelection,
  title,
  zoom,
  onZoomChange,
  selection = null,
  floatCommands,
  overlay,
  className,
}: HtmlVisualShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  const previewTitle = title ?? t("title");
  const safeManifest = useMemo<AssetManifestLike>(() => manifest ?? { entries: [] }, [manifest]);
  const clampedZoom = clampZoom(zoom);
  const showSource = sourceVisibleIn(viewMode);
  const showPreview = previewVisibleIn(viewMode);
  const presenting = viewMode === "present";
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  // The selection bridge's event stream lives OUTSIDE React state: a
  // hover-frequency event re-renders the overlay alone, never the shell, the
  // preview pane or the source editor. `useState` holds the instance so it
  // survives every render without a ref that could be re-created.
  const [previewEvents] = useState<PreviewEventSink>(createPreviewEventSink);
  // The committed selection, held so the H6 float toolbar re-renders with it.
  // Only a committed `select` reaches this state (never a hover), so it is a
  // low-frequency update - the hover stream stays inside the bridge.
  const [previewSelection, setPreviewSelection] = useState<HtmlSelection | null>(null);
  const onPreviewEventRef = useRef(onPreviewEvent);
  onPreviewEventRef.current = onPreviewEvent;
  const onPreviewSelectionRef = useRef(onPreviewSelection);
  onPreviewSelectionRef.current = onPreviewSelection;
  // Stable identity: the preview port is mounted once and must not be
  // re-mounted because a parent passed a fresh inline callback.
  const handlePreviewEvent = useCallback((event: { type: string }) => {
    previewEvents.emit(event);
    onPreviewEventRef.current?.(event);
  }, [previewEvents]);
  const handlePreviewSelection = useCallback((next: HtmlSelection | null) => {
    setPreviewSelection(next);
    onPreviewSelectionRef.current?.(next);
  }, []);

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

  // Present is a dialog: move focus in on open and restore it on close (N2).
  useEffect(() => {
    if (!presenting) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [presenting]);

  const previewPane = showPreview ? (
    <div
      ref={previewScrollRef}
      className="flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto p-1"
      data-testid="html-preview-scroll"
      data-html-zoom={clampedZoom}
    >
      <div className="h-full w-full" style={{ zoom: clampedZoom / 100 }}>
        <PreviewPane
          preview={preview}
          title={previewTitle}
          text={text}
          manifest={safeManifest}
          onSession={onPreviewSession}
          onEvent={handlePreviewEvent}
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

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        presenting && "fixed inset-0 z-50 bg-background p-3 text-foreground",
        className,
      )}
      role={presenting ? "dialog" : undefined}
      aria-modal={presenting || undefined}
      aria-label={presenting ? t("present.label") : undefined}
      tabIndex={presenting ? -1 : undefined}
      data-testid="html-shell"
      data-html-view={viewMode}
      data-document-key={documentKey}
    >
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 gap-3",
          presenting ? "p-0" : "p-3",
          showSource && showPreview ? "flex-col lg:flex-row" : "flex-col",
        )}
        data-testid="html-canvas"
        ref={canvasRef}
      >
        {sourcePane}
        {previewPane}
        {/*
          H5 selection bridge: inert, flag-gated, and only meaningful when a
          preview is on screen. It renders in the same `overlay` slot H6-H8
          use, ahead of the caller's children so a toolbar draws above it.
        */}
        {showPreview ? (
          <HtmlSelectionOverlay
            sink={previewEvents}
            canvasRef={canvasRef}
            zoom={clampedZoom}
            scrollRef={previewScrollRef}
            onSelectionChange={handlePreviewSelection}
          />
        ) : null}
        {/*
          H6 float toolbar: the first consumer that acts on H5's selection. It
          is flag-gated and renders nothing without a renderable rect, so it is
          inert when the selection surface is off.
        */}
        {showPreview ? (
          <HtmlFloatToolbar
            selection={previewSelection}
            canvasRef={canvasRef}
            scrollRef={previewScrollRef}
            zoom={clampedZoom}
            commands={floatCommands}
          />
        ) : null}
        {overlay}
        {presenting ? (
          // A visible exit (F3): the preview iframe swallows keydown, so Esc
          // alone cannot be relied on once the preview holds focus. It is an
          // overlay child of the `relative` canvas (F5) - the same corner the
          // ribbon's Present toggle uses - so a presenter cannot get stuck.
          <div className="absolute end-3 top-3 z-10">
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              data-testid="html-present-exit"
              onClick={() => onViewModeChange("preview")}
            >
              {t("present.exit")}
            </Button>
          </div>
        ) : null}
      </div>
      {!presenting ? (
        <div
          className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-2 text-caption text-muted-foreground"
          role="group"
          aria-label={t("status.label")}
          data-testid="html-status"
        >
          <HtmlStatusBar text={text} selection={selection} zoom={clampedZoom} onZoomChange={onZoomChange} zoomDisabled={!showPreview} />
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * ZoomCanvas + ZoomControls — the pan/zoom viewport shared by the Mermaid
 * viewer and the image attachment preview.
 *
 * Split into a hook (`useZoomCanvas`, all behaviour) and two presentational
 * pieces because the toolbar and the canvas live in different parents: each
 * surface owns its own header, so it calls the hook, drops `<ZoomControls>`
 * wherever its chrome belongs, and renders `<ZoomCanvas>` as the body. Content
 * comes in as children — this module knows the content's natural size and
 * nothing else about it.
 */

import { useCallback, type ReactNode, type RefObject } from "react";
import { Frame, Maximize, Minus, Plus } from "lucide-react";
import { Slider } from "@uniwork/ui/components/ui/slider";
import { cn } from "@uniwork/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { createShortcutChord, type ShortcutChord } from "@uniwork/core/shortcuts";
import { ShortcutKeycaps } from "./shortcut-keycaps";
import { useTranslation } from "react-i18next";
import type { ZoomCanvasApi } from "./hooks/use-zoom-canvas";
import type { Size } from "./utils/zoom-transform";
import "./styles/zoom-canvas.css";

const ZOOM_IN_SHORTCUT = createShortcutChord("Plus");
const ZOOM_OUT_SHORTCUT = createShortcutChord("Minus");
const FIT_SHORTCUT = createShortcutChord("0");

/** One icon button of the zoom toolbar; a surface adds its own (fullscreen) beside ZoomControls. */
export function ZoomToolbarButton({
  onClick,
  disabled,
  label,
  shortcut,
  compact,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  shortcut?: ShortcutChord;
  /** 24px target for a status bar (the genoffice frames' bar height); coarse pointers still get 44px. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={cn("flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40", compact ? "size-6 pointer-coarse:size-11" : "size-7")}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        {shortcut && <ShortcutKeycaps shortcut={shortcut} className="ml-1.5" />}
      </TooltipContent>
    </Tooltip>
  );
}

export function ZoomControls({
  canvas,
  disabled,
  className,
  compact,
  slider,
  children,
}: {
  canvas: ZoomCanvasApi;
  /** Set while the surface shows something other than the canvas (e.g. source view). */
  disabled?: boolean;
  className?: string;
  /** The status-bar size: 24px buttons and 14px glyphs instead of 28px and 16px. */
  compact?: boolean;
  /** Opt-in PDF-frame style range slider (`[−] [slider] [+] [NN%]`); default false keeps `− NN% +`. */
  slider?: boolean;
  /** Extra toolbar buttons (a ZoomToolbarButton) placed after the zoom group, inside its tooltip provider. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const icon = compact ? "size-3.5" : "size-4";
  const minPercent = Math.round(canvas.minScale * 100);
  const maxPercent = Math.round(canvas.maxScale * 100);
  const percentReadout = (
    <span
      className="w-12 select-none text-center text-caption tabular-nums text-muted-foreground"
      aria-live="polite"
    >
      {canvas.zoomPercent}%
    </span>
  );

  return (
    <TooltipProvider delay={300}>
      <div className={cn("flex items-center gap-0.5", className)}>
        <ZoomToolbarButton
          onClick={canvas.zoomOut}
          compact={compact}
          disabled={!canvas.canZoomOut || disabled}
          label={t("editor.canvas.zoom_out")}
          shortcut={ZOOM_OUT_SHORTCUT}
        >
          <Minus className={icon} />
        </ZoomToolbarButton>
        {slider ? (
          <Slider
            className="mx-1 w-24 shrink-0 [&_[data-slot=slider-control]]:pointer-coarse:min-h-11 [&_[data-slot=slider-thumb]]:pointer-coarse:after:-inset-4"
            min={minPercent}
            max={maxPercent}
            step={5}
            value={[canvas.zoomPercent]}
            disabled={disabled}
            thumbAlignment="center"
            aria-label={t("editor.canvas.zoom_level")}
            onValueChange={(values) => {
              const next = Array.isArray(values) ? values[0] : values;
              if (typeof next === "number" && Number.isFinite(next)) {
                canvas.zoomTo(next / 100);
              }
            }}
          />
        ) : (
          percentReadout
        )}
        <ZoomToolbarButton
          onClick={canvas.zoomIn}
          compact={compact}
          disabled={!canvas.canZoomIn || disabled}
          label={t("editor.canvas.zoom_in")}
          shortcut={ZOOM_IN_SHORTCUT}
        >
          <Plus className={icon} />
        </ZoomToolbarButton>
        {slider ? percentReadout : null}
        <ZoomToolbarButton
          onClick={canvas.fit}
          compact={compact}
          disabled={disabled}
          label={t("editor.canvas.zoom_fit")}
          shortcut={FIT_SHORTCUT}
        >
          <Frame className={icon} />
        </ZoomToolbarButton>
        <ZoomToolbarButton
          onClick={canvas.zoomToActualSize}
          compact={compact}
          disabled={disabled}
          label={t("editor.canvas.zoom_actual")}
        >
          <Maximize className={icon} />
        </ZoomToolbarButton>
        {children}
      </div>
    </TooltipProvider>
  );
}

export function ZoomCanvas({
  canvas,
  content,
  label,
  className,
  canvasRef,
  autoFocus,
  children,
}: {
  canvas: ZoomCanvasApi;
  /** Natural size of the children, or null while it is still unknown. */
  content: Size | null;
  /** Accessible name — surfaces describe their own content. */
  label: string;
  className?: string;
  canvasRef?: RefObject<HTMLDivElement | null>;
  /**
   * Focus the canvas on mount. Needed on surfaces without a focus-managing
   * Dialog: the keyboard controls are canvas-scoped, so without this the
   * +/-/0 and arrow keys do nothing until the user happens to click first.
   */
  autoFocus?: boolean;
  children: ReactNode;
}) {
  // Stable identity: an inline ref callback is a new function every render, so
  // React would detach (setViewportNode(null)) and reattach on each one.
  const setCanvasNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (canvasRef) canvasRef.current = node;
      canvas.setViewportNode(node);
      if (node && autoFocus) node.focus({ preventScroll: true });
    },
    // canvas methods are stable; listing `canvas` would rebind the ref callback every render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setViewportNode identity is the dependency that matters
    [canvasRef, canvas.setViewportNode, autoFocus],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role=application pan/zoom surface
    <div
      ref={setCanvasNode}
      className={cn("zoom-canvas", canvas.isPanning && "is-panning", className)}
      // `application` tells screen readers to pass arrow keys through to the
      // canvas instead of using them for their own navigation.
      role="application"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role=application is interactive for a11y tree
      tabIndex={0}
      onPointerDown={canvas.handlePointerDown}
      onPointerMove={canvas.handlePointerMove}
      onPointerUp={canvas.handlePointerUp}
      onPointerCancel={canvas.handlePointerUp}
      onDoubleClick={canvas.handleDoubleClick}
      onKeyDown={canvas.handleKeyDown}
    >
      <div
        className={cn(
          content ? "zoom-canvas-content" : "zoom-canvas-fit",
          content && canvas.isAnimated && "is-animated",
        )}
        style={
          content
            ? {
                width: `${content.width}px`,
                height: `${content.height}px`,
                transform: `translate(${canvas.transform.x}px, ${canvas.transform.y}px) scale(${canvas.transform.scale})`,
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

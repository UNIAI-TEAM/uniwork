"use client";

/**
 * HtmlFloatToolbar — the H6 contextual toolbar over the H5 selection.
 *
 * H5 publishes a read-only selection (`{sid, rect, nodeName}`) through the
 * shell and paints an inert outline; H6 is the first consumer that ACTS on it:
 * a small toolbar anchored just above the selected element's box, carrying the
 * inline marks (bold / italic), the font-size stepper, a text-colour palette
 * and the element actions (edit text, move up/down, duplicate, delete, open the
 * style panel).
 *
 * It is a PURE PRESENTATIONAL control. Every action is an optional callback on
 * `commands`; this file never calls an H3 op, never sends an inspector command
 * and never touches the document - H8 owns the inline-edit commit path and the
 * caller decides what each callback does. The only values written into `style`
 * are numbers produced by `geometry.ts` (clamped), plus the fixed palette's own
 * swatch fills.
 *
 * The whole surface is behind the SAME flag H5 uses (`HTML_SELECTION_FLAG`,
 * default OFF) and renders nothing when the flag is off or no renderable rect
 * is known, so a flag-off build is behaviourally identical to before H6.
 *
 * Positioning mirrors the H5 outline exactly: the rect is in the frame's
 * INTERNAL viewport px, the shell scales the frame by `clampedZoom/100`, and in
 * split mode the frame is offset from the canvas origin. The toolbar therefore
 * anchors to `offset + zoom * rect` and re-probes that offset on the same
 * signals H5 does (the preview scroll container's `scroll`, a canvas resize and
 * a zoom change), because none of them emits an inspector event.
 */
import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Bold, Copy, Italic, Minus, Palette, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { useFlag } from "@uniwork/core/feature-flags";
import { HTML_SELECTION_FLAG, type HtmlSelection } from "../selection/model";
import { floatAnchor, renderableRect, selectionBox } from "./geometry";

/** The preview frame's structural hook, the same one H5 probes. */
const PREVIEW_FRAME_ATTR = "data-html-preview-frame";

/** Bounds for the size readout; a value outside them is not a real font size. */
const FONT_SIZE_MIN = 1;
const FONT_SIZE_MAX = 512;

/**
 * The text-colour palette. These are DOCUMENT values (what the user paints onto
 * the element), not theme chrome, so they are fixed here the way a document
 * colour picker's swatches are. `null` means "no explicit colour" (inherit).
 */
const TEXT_COLOURS = [
  { id: "default", value: null, labelKey: "colourDefault" },
  { id: "red", value: "#dc2626", labelKey: "colourRed" },
  { id: "orange", value: "#ea580c", labelKey: "colourOrange" },
  { id: "green", value: "#16a34a", labelKey: "colourGreen" },
  { id: "blue", value: "#2563eb", labelKey: "colourBlue" },
  { id: "purple", value: "#9333ea", labelKey: "colourPurple" },
] as const;

type TextColourId = (typeof TEXT_COLOURS)[number]["id"];

/** Every action the toolbar can raise; all optional so a caller wires what it has. */
export interface HtmlFloatToolbarCommands {
  onBold?: () => void;
  onItalic?: () => void;
  onFontSizeIncrease?: () => void;
  onFontSizeDecrease?: () => void;
  /** A palette id, or null for "no explicit colour" (inherit). */
  onColour?: (colour: TextColourId) => void;
  onEditText?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** H7 owns the panel; absent -> the entry renders disabled. */
  onOpenStylePanel?: () => void;
}

/** Which marks/size/colour currently read as "on" for the selection. */
export interface HtmlFloatToolbarState {
  bold?: boolean;
  italic?: boolean;
  /** Current font size in px, or null for a mixed/unknown selection. */
  fontSize?: number | null;
  /** Current palette id, or null when the selection has no explicit colour. */
  colour?: TextColourId | null;
}

export interface HtmlFloatToolbarProps {
  /** The committed selection the shell publishes (never hover). */
  selection: HtmlSelection | null;
  /** The `relative` canvas the toolbar positions against. */
  canvasRef: RefObject<HTMLElement | null>;
  /** The preview pane's scroll container, re-probed on `scroll`. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** The shell's clamped zoom ladder value, in percent. */
  zoom?: number;
  commands?: HtmlFloatToolbarCommands;
  state?: HtmlFloatToolbarState;
}

interface Offset {
  x: number;
  y: number;
}

const ZERO: Offset = { x: 0, y: 0 };

/** Read-only layout probe: how far the preview frame sits from the canvas
 * origin. Returns zero when there is no frame (jsdom, no preview port). */
function frameOffset(canvas: HTMLElement | null): Offset {
  if (!canvas) return ZERO;
  const frame = canvas.querySelector(`[${PREVIEW_FRAME_ATTR}]`);
  if (!(frame instanceof HTMLElement)) return ZERO;
  const canvasRect = canvas.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return { x: frameRect.left - canvasRect.left, y: frameRect.top - canvasRect.top };
}

/** Clamp a displayed font size, or null when there is no honest number. */
function displayFontSize(fontSize: number | null | undefined): number | null {
  if (typeof fontSize !== "number" || !Number.isFinite(fontSize)) return null;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)));
}

/** The icon buttons share one size/ARIA shape so the row reads evenly. */
function ToolbarButton({ label, testId, disabled, onClick, children }: { label: string; testId: string; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="toolbar" size="icon-sm" aria-label={label} disabled={disabled} data-float-action={testId} onClick={onClick}>
      {children}
    </Button>
  );
}

export function HtmlFloatToolbar({ selection, canvasRef, scrollRef, zoom = 100, commands = {}, state = {} }: HtmlFloatToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.float" });
  const enabled = useFlag(HTML_SELECTION_FLAG, false);
  const [offset, setOffset] = useState<Offset>(ZERO);
  const rect = renderableRect(selection);
  const rectKey = rect === null ? null : `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;

  useEffect(() => {
    if (!enabled || rectKey === null) return undefined;
    const probe = () => setOffset(frameOffset(canvasRef.current));
    // A rect can arrive long after the frame was laid out, so probe now, then
    // on every signal that moves the frame without an inspector event.
    probe();
    const scroll = scrollRef?.current;
    scroll?.addEventListener("scroll", probe, { passive: true });
    const canvas = canvasRef.current;
    const observer = canvas !== null && typeof ResizeObserver === "function" ? new ResizeObserver(probe) : null;
    if (observer !== null && canvas !== null) observer.observe(canvas);
    return () => {
      scroll?.removeEventListener("scroll", probe);
      observer?.disconnect();
    };
    // `rectKey` re-probes on new geometry; `zoom` whenever the frame re-scales.
  }, [enabled, rectKey, zoom, canvasRef, scrollRef]);

  // Flag off, or nothing to anchor to: render nothing and change nothing.
  if (!enabled || rect === null) return null;

  const anchor = floatAnchor(selectionBox(rect, offset, zoom));
  const size = displayFontSize(state.fontSize);
  const activeColour: TextColourId | null = state.colour ?? null;
  const style: CSSProperties = {
    left: `${anchor.left}px`,
    top: `${anchor.top}px`,
    transform: "translateX(-50%)",
  };

  return (
    <div
      role="toolbar"
      aria-label={t("label")}
      data-testid="html-float-toolbar"
      data-float-placement={anchor.placement}
      data-selection-sid={selection?.sid ?? undefined}
      style={style}
      className="pointer-events-auto absolute z-20 flex min-h-9 items-center gap-0.5 rounded-lg bg-surface-raised p-1 text-body text-popover-foreground shadow-[var(--menu-shadow)] ring-1 ring-surface-border"
    >
      <Toggle
        variant="toolbar"
        size="sm"
        pressed={state.bold === true}
        aria-label={t("bold")}
        data-float-action="bold"
        onPressedChange={() => commands.onBold?.()}
      >
        <Bold aria-hidden />
      </Toggle>
      <Toggle
        variant="toolbar"
        size="sm"
        pressed={state.italic === true}
        aria-label={t("italic")}
        data-float-action="italic"
        onPressedChange={() => commands.onItalic?.()}
      >
        <Italic aria-hidden />
      </Toggle>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <ToolbarButton label={t("fontSizeDecrease")} testId="font-size-decrease" disabled={!commands.onFontSizeDecrease} onClick={() => commands.onFontSizeDecrease?.()}>
        <Minus aria-hidden />
      </ToolbarButton>
      <span
        className="min-w-7 select-none text-center text-caption tabular-nums text-muted-foreground"
        aria-label={t("fontSize")}
        data-float-action="font-size-value"
        data-float-size={size === null ? "mixed" : String(size)}
      >
        {size === null ? t("fontSizeMixed") : size}
      </span>
      <ToolbarButton label={t("fontSizeIncrease")} testId="font-size-increase" disabled={!commands.onFontSizeIncrease} onClick={() => commands.onFontSizeIncrease?.()}>
        <Plus aria-hidden />
      </ToolbarButton>

      <Popover>
        <PopoverTrigger
          render={
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("colour")} data-float-action="colour" />
          }
        >
          <Palette aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="center" className="w-auto flex-row flex-wrap gap-1" data-float-action="colour-menu">
          {TEXT_COLOURS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              aria-label={t(colour.labelKey)}
              aria-pressed={activeColour === colour.id}
              data-float-colour={colour.id}
              className="size-6 cursor-pointer rounded-full border border-surface-border outline-offset-2 aria-pressed:ring-2 aria-pressed:ring-primary"
              style={colour.value === null ? { backgroundColor: "var(--color-foreground)" } : { backgroundColor: colour.value }}
              onClick={() => commands.onColour?.(colour.id)}
            />
          ))}
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <ToolbarButton label={t("editText")} testId="edit-text" disabled={!commands.onEditText} onClick={() => commands.onEditText?.()}>
        <Pencil aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t("moveUp")} testId="move-up" disabled={!commands.onMoveUp} onClick={() => commands.onMoveUp?.()}>
        <ArrowUp aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t("moveDown")} testId="move-down" disabled={!commands.onMoveDown} onClick={() => commands.onMoveDown?.()}>
        <ArrowDown aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t("duplicate")} testId="duplicate" disabled={!commands.onDuplicate} onClick={() => commands.onDuplicate?.()}>
        <Copy aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t("delete")} testId="delete" disabled={!commands.onDelete} onClick={() => commands.onDelete?.()}>
        <Trash2 aria-hidden />
      </ToolbarButton>
      <ToolbarButton label={t("openStylePanel")} testId="open-style-panel" disabled={!commands.onOpenStylePanel} onClick={() => commands.onOpenStylePanel?.()}>
        <SlidersHorizontal aria-hidden />
      </ToolbarButton>
    </div>
  );
}

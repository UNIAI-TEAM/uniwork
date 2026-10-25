"use client";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CaptionFloatRect, useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";

// Where Thư ký UNI's captions sit in the room (owner, 2026-10-26): docked above the control bar, where the
// footer keeps room for them, or floating where the viewer drags them, so a screen share gets the room's
// whole height. A phone always docks: the screen is too narrow to drag a box around without mis-taps.

/** A floating box still reads a line at its narrowest; it never outgrows the room nor 60% of its height. */
export const FLOAT_MIN = { width: 320, height: 120 };
const FLOAT_MAX_HEIGHT = 0.6;
/** How far a floating box keeps from the room's edges, and how near an edge it snaps flush to it. */
const MARGIN = 12;
const SNAP = 24;
/** Dropped with the pointer this near the room's bottom edge, a floating box docks again. */
const DOCK_ZONE = 120;
/** A press that moves less than this is a click (float or dock), not a drag. */
const DRAG_SLOP = 4;
/** One arrow-key step, for the keyboard way to move and resize (WCAG 2.5.7). */
const KEY_STEP = 16;
/** The strip a floating box keeps clear above the room's bottom edge: the control bar and its margin. */
const BAR_CLEARANCE = 96;

type Size = { width: number; height: number };

/**
 * Keeps a floating box inside the room, at least its minimum size, at most the room's width and 60% of its
 * height, and above the control bar's strip: it floats over the bar's layer, and must never hide the mic
 * or leave buttons.
 */
export function clampFloat(r: CaptionFloatRect, room: Size): CaptionFloatRect {
  const width = Math.min(Math.max(r.width, FLOAT_MIN.width), Math.max(FLOAT_MIN.width, room.width - 2 * MARGIN));
  const height = Math.min(Math.max(r.height, FLOAT_MIN.height), Math.max(FLOAT_MIN.height, room.height * FLOAT_MAX_HEIGHT));
  return {
    x: Math.min(Math.max(r.x, MARGIN), Math.max(MARGIN, room.width - width - MARGIN)),
    y: Math.min(Math.max(r.y, MARGIN), Math.max(MARGIN, room.height - height - BAR_CLEARANCE)),
    width,
    height,
  };
}

/** Dropped near an edge, the box sits flush against it, a margin away (the bottom one: just above the bar). */
export function snapFloat(r: CaptionFloatRect, room: Size): CaptionFloatRect {
  const right = room.width - r.width - MARGIN;
  const bottom = room.height - r.height - BAR_CLEARANCE;
  const x = Math.abs(r.x - MARGIN) < SNAP ? MARGIN : Math.abs(r.x - right) < SNAP ? right : r.x;
  const y = Math.abs(r.y - MARGIN) < SNAP ? MARGIN : Math.abs(r.y - bottom) < SNAP ? bottom : r.y;
  return { ...r, x, y };
}

/** Which edges a resize handle moves: -1 the left or top one, 1 the right or bottom one, 0 neither. */
type Edge = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** The box after its edges `edge` moved by (dx, dy), never smaller than its minimum (the other edges stay). */
export function resizeFloat(r: CaptionFloatRect, edge: Edge, dx: number, dy: number): CaptionFloatRect {
  const width = Math.max(FLOAT_MIN.width, r.width + edge.x * dx);
  const height = Math.max(FLOAT_MIN.height, r.height + edge.y * dy);
  return {
    x: edge.x === -1 ? r.x + r.width - width : r.x,
    y: edge.y === -1 ? r.y + r.height - height : r.y,
    width,
    height,
  };
}

const EDGES: readonly { edge: Edge; className: string }[] = [
  { edge: { x: 0, y: -1 }, className: "inset-x-3 top-0 h-2 cursor-ns-resize" },
  { edge: { x: 0, y: 1 }, className: "inset-x-3 bottom-0 h-2 cursor-ns-resize" },
  { edge: { x: -1, y: 0 }, className: "inset-y-3 left-0 w-2 cursor-ew-resize" },
  { edge: { x: 1, y: 0 }, className: "inset-y-3 right-0 w-2 cursor-ew-resize" },
  { edge: { x: -1, y: -1 }, className: "top-0 left-0 size-3 cursor-nwse-resize" },
  { edge: { x: 1, y: 1 }, className: "right-0 bottom-0 size-3 cursor-nwse-resize" },
  { edge: { x: 1, y: -1 }, className: "top-0 right-0 size-3 cursor-nesw-resize" },
  { edge: { x: -1, y: 1 }, className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
];

/** The room's box on screen, kept fresh as the window, the sidebar or the stage changes it. */
function useRoomBox(room: HTMLElement | null): DOMRect | null {
  const [box, setBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!room) return;
    const read = () => setBox(room.getBoundingClientRect());
    read();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    resized?.observe(room);
    window.addEventListener("resize", read);
    return () => {
      resized?.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [room]);
  return box;
}

/** Follows one pointer from its press until it lets go, on the element that captured it. */
function follow(e: ReactPointerEvent<HTMLElement>, move: (dx: number, dy: number, ev: PointerEvent) => void, end: (moved: boolean, ev: PointerEvent) => void) {
  const el = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  el.setPointerCapture?.(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    moved = true;
    move(dx, dy, ev);
  };
  const onUp = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    end(moved, ev);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

/**
 * Where the caption card sits and how the viewer moves it. `room` is the
 * meeting's stage frame; without it (a host with no stage) the card only docks.
 * The card is never remounted to move: floating, it is `position: fixed` over
 * the room and its docked slot collapses, so its scroll and its lines stay.
 */
export function useCaptionFrame(room: HTMLElement | null) {
  const { t } = useTranslation();
  const placement = useMeetingRoomPreferencesStore((s) => s.captionPlacement);
  const lines = useMeetingRoomPreferencesStore((s) => s.captionLines);
  const saved = useMeetingRoomPreferencesStore((s) => s.captionFloat);
  const setPlacement = useMeetingRoomPreferencesStore((s) => s.setCaptionPlacement);
  const setLines = useMeetingRoomPreferencesStore((s) => s.setCaptionLines);
  const setFloat = useMeetingRoomPreferencesStore((s) => s.setCaptionFloat);
  const phone = useIsMobile();
  const box = useRoomBox(room);
  const card = useRef<HTMLDivElement>(null);
  // The box while a drag or a resize is under way; stored when it ends.
  const [live, setLive] = useState<CaptionFloatRect | null>(null);
  const [dockHint, setDockHint] = useState(false);
  const dragged = useRef(false);
  const canFloat = !phone && box !== null;
  const floating = placement === "floating" && canFloat;
  const size = { width: box?.width ?? 0, height: box?.height ?? 0 };
  const firstFloat = (): CaptionFloatRect => {
    const width = Math.min(560, size.width - 2 * MARGIN);
    return { x: size.width - width - MARGIN, y: size.height - 168 - BAR_CLEARANCE, width, height: 168 };
  };
  const rect = floating ? clampFloat(live ?? saved ?? firstFloat(), size) : null;

  const floatAt = (r: CaptionFloatRect) => {
    setFloat(clampFloat(r, size));
    setPlacement("floating");
  };
  const toggle = () => {
    if (floating) setPlacement("docked");
    else if (canFloat) floatAt(saved ?? firstFloat());
  };

  // The grip moves the card: dragged off its dock it floats under the pointer; dropped near the room's
  // bottom it docks again. A press that does not move is a click, and a click floats or docks it.
  const onGripDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!canFloat || !box || e.button !== 0) return;
    dragged.current = false;
    const cardBox = card.current?.getBoundingClientRect();
    const start: CaptionFloatRect = rect ?? {
      x: (cardBox?.left ?? 0) - box.left,
      y: (cardBox?.top ?? 0) - box.top,
      width: cardBox?.width ?? FLOAT_MIN.width,
      height: cardBox?.height ?? FLOAT_MIN.height,
    };
    follow(
      e,
      (dx, dy, ev) => {
        dragged.current = true;
        if (!floating) setPlacement("floating");
        setLive(clampFloat({ ...start, x: start.x + dx, y: start.y + dy }, size));
        setDockHint(ev.clientY > box.bottom - DOCK_ZONE);
      },
      (moved, ev) => {
        setDockHint(false);
        setLive(null);
        if (!moved) return;
        if (ev.clientY > box.bottom - DOCK_ZONE) setPlacement("docked");
        else setFloat(snapFloat(clampFloat({ ...start, x: start.x + ev.clientX - e.clientX, y: start.y + ev.clientY - e.clientY }, size), size));
      },
    );
  };
  const onGripClick = () => {
    // A drag ends with a click on the grip too; only a press that did not move floats or docks.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    toggle();
  };
  // The keyboard way to do what the pointer drags: arrows move a floating box, Shift + arrows resize it
  // (or, docked, show more or fewer lines).
  const onGripKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const dx = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
    const dy = e.key === "ArrowUp" ? -KEY_STEP : e.key === "ArrowDown" ? KEY_STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (!rect) {
      if (e.shiftKey && dy) setLines(lines - Math.sign(dy));
      return;
    }
    const next = e.shiftKey
      ? resizeFloat(rect, { x: 1, y: 1 }, dx, dy)
      : { ...rect, x: rect.x + dx, y: rect.y + dy };
    setFloat(clampFloat(next, size));
  };

  const onResizeDown = (edge: Edge) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!rect || e.button !== 0) return;
    e.stopPropagation();
    const start = rect;
    let last = start;
    follow(
      e,
      (dx, dy) => {
        last = clampFloat(resizeFloat(start, edge, dx, dy), size);
        setLive(last);
      },
      (moved) => {
        setLive(null);
        if (moved) setFloat(last);
      },
    );
  };
  // Docked, the card's top edge shows more or fewer whole lines, so no line is ever cut.
  const onDockResizeDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = card.current;
    if (!el || e.button !== 0) return;
    const lineHeight = Number.parseFloat(getComputedStyle(el).getPropertyValue("--cap-lh")) || 28;
    const start = lines;
    follow(
      e,
      (_dx, dy) => setLines(start - dy / lineHeight),
      () => {},
    );
  };

  const cardStyle: CSSProperties = rect
    ? { left: (box?.left ?? 0) + rect.x, top: (box?.top ?? 0) + rect.y, width: rect.width, height: rect.height }
    : ({ "--cap-rows": lines + 0.6 } as CSSProperties);

  const grip: ReactNode = canFloat ? (
    <button
      type="button"
      onPointerDown={onGripDown}
      onClick={onGripClick}
      onKeyDown={onGripKey}
      aria-label={t(floating ? "meetings.scribe.captionsDock" : "meetings.scribe.captionsFloat")}
      title={`${t(floating ? "meetings.scribe.captionsDock" : "meetings.scribe.captionsFloat")} · ${t("meetings.scribe.captionsGripHint")}`}
      data-testid="meeting-caption-grip"
      className="pointer-events-auto -ms-1.5 grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-meeting-bar-muted-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground active:cursor-grabbing pointer-coarse:size-11"
    >
      <GripHorizontal aria-hidden className="size-4" />
    </button>
  ) : null;

  const handles: ReactNode = rect ? (
    EDGES.map(({ edge, className }) => (
      <span
        key={`${edge.x}${edge.y}`}
        aria-hidden
        data-testid={`meeting-caption-resize-${edge.x}${edge.y}`}
        onPointerDown={onResizeDown(edge)}
        className={cn("pointer-events-auto absolute z-20 touch-none", className)}
      />
    ))
  ) : canFloat ? (
    <span
      aria-hidden
      data-testid="meeting-caption-resize-lines"
      onPointerDown={onDockResizeDown}
      className="pointer-events-auto absolute inset-x-8 top-0 z-20 h-2 cursor-ns-resize touch-none"
    />
  ) : null;

  return {
    floating,
    /** The docked card's visible lines, with the part-line that fades above them. */
    rows: lines + 0.6,
    card,
    cardStyle,
    dockHint,
    grip,
    handles,
  };
}

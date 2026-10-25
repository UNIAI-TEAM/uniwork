"use client";

import { forwardRef, useEffect, useId, useRef, type CSSProperties } from "react";
import type { LucideProps } from "lucide-react";

import { cn } from "@uniwork/ui/lib/utils";

/**
 * What the scribe is doing, which is all the mark's motion ever says: it moves
 * only while the scribe works (base.css `[data-scribe-state]`), and stands
 * still in lists, settings and every line written after the fact.
 */
export type ScribeMarkState = "idle" | "joining" | "live" | "composing" | "paused" | "failed" | "off";

type ScribeMarkProps = LucideProps & { state?: ScribeMarkState };

// Logo artwork, like mark.generated.ts: the tile's own violet ramp, not a token.
const TILE_FROM = "#5B12EA";
const TILE_TO = "#A23CF2";

/** Three voice bars, then three written lines: the scribe hears the room and writes it down. */
function Strokes({ glyph }: { glyph?: boolean }) {
  return (
    <>
      <path data-part="b1" d="M11 20.5V27.5" />
      <path data-part="b2" d="M17 15V33" />
      <path data-part="b3" d="M23 19V29" />
      <path data-part="l1" pathLength={1} d="M29.5 18H37.5" />
      <path data-part="l2" pathLength={1} strokeOpacity={glyph ? undefined : 0.85} d="M29.5 24H37.5" />
      <path data-part="l3" pathLength={1} strokeOpacity={glyph ? undefined : 0.7} d="M29.5 30H34" />
    </>
  );
}

/**
 * Thư ký UNI's mark: the violet tile, for wherever the scribe itself speaks — a
 * byline it wrote, its chip in the room, its notice. Shaped like a lucide icon
 * (size, className, aria-hidden by default) so it drops into any `icon` slot.
 * `failed` greys the tile and adds the alert dot; `off` leaves the outline.
 */
export const ScribeMark = forwardRef<SVGSVGElement, ScribeMarkProps>(function ScribeMark(
  { state = "idle", size = 24, className, ...rest },
  ref,
) {
  const id = useId();
  const off = state === "off";
  return (
    <svg
      ref={ref}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      focusable={false}
      data-scribe-mark=""
      data-scribe-state={state}
      className={cn("shrink-0 overflow-visible", className)}
      {...rest}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1={0} y1={0} x2={48} y2={48} gradientUnits="userSpaceOnUse">
          <stop stopColor={TILE_FROM} />
          <stop offset={1} stopColor={TILE_TO} />
        </linearGradient>
      </defs>
      {off ? (
        <rect x={1.5} y={1.5} width={45} height={45} rx={12.5} className="stroke-border" strokeWidth={3} />
      ) : (
        <rect width={48} height={48} rx={14} className={state === "failed" ? "fill-faint-foreground" : undefined} fill={state === "failed" ? undefined : `url(#${id}-tile)`} />
      )}
      <g strokeWidth={4.2} strokeLinecap="round" stroke={off ? undefined : "#FFF"} className={off ? "stroke-faint-foreground" : undefined}>
        <Strokes />
      </g>
      {state === "failed" ? <circle cx={43} cy={5} r={7} className="fill-destructive stroke-background" strokeWidth={3} /> : null}
    </svg>
  );
});

/**
 * The same bars and lines in one colour, no tile, for a slot among other line
 * icons (a property row, a form field, a menu): it takes the text colour and a
 * stroke as heavy as lucide's 2/24.
 */
export const ScribeGlyph = forwardRef<SVGSVGElement, LucideProps>(function ScribeGlyph({ size = 24, className, ...rest }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="7 7 34 34"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.9}
      strokeLinecap="round"
      aria-hidden
      focusable={false}
      className={cn("shrink-0", className)}
      {...rest}
    >
      <Strokes glyph />
    </svg>
  );
});

/**
 * Thư ký UNI listening, drawn as one line along the bottom edge of the box
 * it sits in (base.css `[data-scribe-voice]`): it thickens and brightens with
 * `level` (0–1, read every frame), and while `processing` it gathers into a
 * short stretch that travels the edge. The parent is `relative` and clips it
 * with its radius. Reduced motion reads no level: the line rests.
 */
export function ScribeVoiceLine({
  level,
  processing = false,
  className,
}: {
  level: () => number;
  processing?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let shown = 0;
    let written = "";
    let frame = requestAnimationFrame(function tick() {
      const target = Math.min(1, Math.max(0, levelRef.current() || 0));
      // Rises fast, falls slowly: the line follows a voice, not every sample.
      shown += (target - shown) * (target > shown ? 0.3 : 0.07);
      const next = shown.toFixed(3);
      if (next !== written) el.style.setProperty("--voice", (written = next));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      data-scribe-voice=""
      data-processing={processing ? "" : undefined}
      style={{ "--scribe-from": TILE_FROM, "--scribe-to": TILE_TO } as CSSProperties}
      className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-1", className)}
    />
  );
}

"use client";

import { forwardRef, useEffect, useId, useRef } from "react";
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

// The voice line's lobes, left to right: the tile's two stops and the violets
// between them, with a pale core where the lobes meet (artwork, not tokens).
const VOICE_LOBES = ["#5B12EA", "#7C3AED", TILE_TO, "#8B5CF6", "#6D28D9"];
const VOICE_CORE = "#EBDDFF";
// Where each lobe sits along the edge (fraction of the width from the middle) and how much of the voice it takes.
const LOBE_X = [-0.3, -0.15, 0, 0.15, 0.3];
const LOBE_WEIGHT = [0.55, 0.82, 1, 0.82, 0.55];

/**
 * One frame of the level the line shows: it rises fast and falls slowly, so
 * it follows a voice rather than every sample (slower still for reduced motion).
 */
export function followVoice(shown: number, target: number, reduced: boolean): number {
  const level = Math.min(1, Math.max(0, target || 0));
  const rate = level > shown ? (reduced ? 0.1 : 0.32) : reduced ? 0.035 : 0.07;
  return shown + (level - shown) * rate;
}

const rgbOf = new Map<string, string>();
function rgba(hex: string, alpha: number): string {
  let rgb = rgbOf.get(hex);
  if (!rgb) {
    const n = Number.parseInt(hex.slice(1), 16);
    rgb = `${n >> 16} ${(n >> 8) & 255} ${n & 255}`;
    rgbOf.set(hex, rgb);
  }
  return `rgb(${rgb} / ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

/** A soft ellipse centred on (x, y), fading out from its middle. */
function glow(ctx: CanvasRenderingContext2D, dpr: number, x: number, y: number, rx: number, ry: number, hex: string, alpha: number) {
  if (alpha < 0.004 || rx < 1 || ry < 0.4) return;
  ctx.setTransform(dpr * rx, 0, 0, dpr * ry, dpr * x, dpr * y);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, rgba(hex, alpha));
  g.addColorStop(0.45, rgba(hex, alpha * 0.42));
  g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
}

/**
 * Thư ký UNI listening: a line of violet light along the bottom edge of the
 * box it sits in, thicker and brighter as `level` (0–1, read every frame)
 * rises; nothing glows up behind the words. While `processing` (joining,
 * translating) the light gathers into a short beam that travels the edge.
 * Reduced motion: the lobes hold still and the beam waits in the middle.
 * Sits as the first child of a `relative isolate` box that clips it.
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
  const ref = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const processingRef = useRef(processing);
  processingRef.current = processing;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const move = reduced ? 0 : 1;
    const phase = LOBE_X.map(() => Math.random() * Math.PI * 2);
    let shown = 0;
    let gathered = 0;
    let frame = requestAnimationFrame(function draw(ts: number) {
      frame = requestAnimationFrame(draw);
      const t = ts / 1000;
      shown = followVoice(shown, levelRef.current(), reduced);
      gathered += ((processingRef.current ? 1 : 0) - gathered) * 0.07;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!w || !h) return;
      ctx.globalCompositeOperation = "lighter";
      // A quiet room still shows the line, breathing.
      const voice = Math.max(shown, reduced ? 0.16 : 0.14 + 0.05 * Math.sin(t * 1.4));
      const beam = w / 2 + move * Math.sin((t * 2 * Math.PI) / 1.9) * w * 0.36;
      LOBE_X.forEach((at, i) => {
        const weight = LOBE_WEIGHT[i] ?? 1;
        let x = w / 2 + at * w * (0.78 + 0.3 * shown) + move * Math.sin(t * (0.5 + i * 0.17) + (phase[i] ?? 0)) * w * 0.035;
        let rx = w * (0.13 + 0.05 * weight + 0.07 * shown);
        let alpha = 0.3 + 0.7 * voice * weight;
        x += (beam + (i - 2) * w * 0.022 - x) * gathered;
        rx += (w * 0.075 - rx) * gathered;
        alpha += (0.8 - alpha) * gathered;
        // Centred on the edge, so only its upper half shows.
        const thick = (1.6 + 3.2 * voice * weight + gathered * 1.6) * (1 + move * 0.1 * Math.sin(t * 2.3 + (phase[i] ?? 0)));
        glow(ctx, dpr, x, h, rx, thick, VOICE_LOBES[i] ?? TILE_TO, alpha * 1.4);
        glow(ctx, dpr, x, h, rx * 0.7, thick * 0.5, VOICE_CORE, alpha);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-scribe-voice=""
      data-processing={processing ? "" : undefined}
      className={cn("pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-3 w-full", className)}
    />
  );
}

"use client";

import { useId } from "react";

import { cn } from "@uniwork/ui/lib/utils";

import {
  BRAND_GRADIENT,
  COMPACT_MAX_SIZE,
  MARK,
  MARK_COMPACT,
  MARK_SHADE_CLASS,
  type MarkArt,
} from "./mark.generated";
import {
  LOCKUP_HORIZONTAL,
  LOCKUP_STACKED,
  WORDMARK,
  type Lockup,
} from "./wordmark.generated";

export type LogoVariant = "mark" | "wordmark" | "lockup" | "lockup-stacked";

/**
 * How the MARK is filled. The wordmark is type, and type takes the text colour
 * - it is always `currentColor`, in every tone and every variant. A wordmark
 * carrying the mark's gradient reads as decoration, and PRODUCT.md keeps colour
 * for signal.
 *
 * `gradient` is the mark as drawn. `flat` is the single brand hue, for one-ink
 * printing and for surfaces where a gradient would compete. `mono` inherits
 * `currentColor`, which is the only tone that survives being placed inside a
 * button, a disabled row, or a dark rail without being restated.
 */
export type LogoTone = "gradient" | "flat" | "mono";

export type LogoProps = {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Rendered height in px. Width follows the artwork's own ratio. */
  size?: number;
  /**
   * Marks the logo as decoration. Use it when the product name is already in
   * the accessible name of whatever the logo sits inside — a sidebar header
   * that reads "UniWork" should not announce the word twice.
   */
  decorative?: boolean;
  className?: string;
};

const DEFAULT_SIZE: Record<LogoVariant, number> = {
  mark: 24,
  wordmark: 20,
  lockup: 28,
  "lockup-stacked": 48,
};

/**
 * Clear space around the logo, as a fraction of its rendered height. The value
 * is the mark's head radius over its height (14/92) - read off the artwork
 * rather than chosen, so it stays right if the mark is redrawn.
 */
export const LOGO_SAFE_ZONE_RATIO = 14 / 92;

/**
 * Below these heights the artwork stops being itself: the mark loses its head
 * gap, the wordmark's counters fill in, the lockup's wordmark turns to texture.
 * `lockup` at 22px is about 94px wide.
 */
export const LOGO_MIN_SIZE: Record<LogoVariant, number> = {
  mark: 16,
  wordmark: 12,
  lockup: 22,
  "lockup-stacked": 32,
};

function Mark({ art, fill }: { art: MarkArt; fill: string }) {
  const id = useId();
  const shapes = (
    <>
      {art.heads.map((h, i) => (
        <circle key={`h${i}`} cx={h.cx} cy={h.cy} r={h.r} />
      ))}
      {art.bodies.map((b, i) => (
        <rect key={`b${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={b.rx} />
      ))}
      <path d={art.ribbon} />
    </>
  );
  return (
    <>
      {art.depth ? (
        <defs>
          <clipPath id={`${id}-figures`}>
            {art.heads.map((h, i) => (
              <circle key={`c${i}`} cx={h.cx} cy={h.cy} r={h.r} />
            ))}
            {art.bodies.map((b, i) => (
              <rect key={`r${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={b.rx} />
            ))}
          </clipPath>
        </defs>
      ) : null}
      <g fill={fill}>{shapes}</g>
      {art.depth ? (
        // The ribbon crosses in front of both figures. Re-drawing it clipped to
        // the figures is the whole depth treatment; there is no second artwork.
        <g clipPath={`url(#${id}-figures)`}>
          <path d={art.ribbon} opacity={0.45} className={MARK_SHADE_CLASS} />
        </g>
      ) : null}
    </>
  );
}

function Wordmark() {
  return <path d={WORDMARK.path} fill="currentColor" />;
}

function LockupArt({ art, fill, layout }: { art: MarkArt; fill: string; layout: Lockup }) {
  return (
    <>
      <g transform={`translate(${layout.markX} 0)`}>
        <Mark art={art} fill={fill} />
      </g>
      <g transform={`translate(${layout.wordX} ${layout.wordY}) scale(${layout.wordScale})`}>
        <Wordmark />
      </g>
    </>
  );
}

/**
 * The UniWork logo.
 *
 * Rendered as inline SVG rather than an <img>: `tone="mono"` has to inherit
 * `currentColor`, the gradient needs an id unique per instance, and an inline
 * mark costs no extra request. Sizes at or below 24px silently swap in the
 * compact artwork — callers set a size, not a drawing.
 */
export function Logo({
  variant = "mark",
  tone = "gradient",
  size,
  decorative = false,
  className,
}: LogoProps) {
  const gradientId = useId();
  const height = size ?? DEFAULT_SIZE[variant];
  const useCompact = variant === "mark" && height <= COMPACT_MAX_SIZE;
  const art = useCompact ? MARK_COMPACT : MARK;

  const fill =
    tone === "mono"
      ? "currentColor"
      : tone === "flat"
        ? "var(--brand)"
        : `url(#${gradientId})`;

  const needsGradient = tone === "gradient" && variant !== "wordmark";

  let width: number;
  let viewBox: string;
  let content: React.ReactNode;

  if (variant === "wordmark") {
    width = (WORDMARK.width / WORDMARK.height) * height;
    viewBox = WORDMARK.viewBox;
    content = <Wordmark />;
  } else if (variant === "lockup" || variant === "lockup-stacked") {
    const layout = variant === "lockup" ? LOCKUP_HORIZONTAL : LOCKUP_STACKED;
    width = (layout.width / layout.height) * height;
    viewBox = `0 0 ${layout.width} ${layout.height}`;
    content = <LockupArt art={MARK} fill={fill} layout={layout} />;
  } else {
    width = (art.width / art.height) * height;
    viewBox = art.viewBox;
    content = <Mark art={art} fill={fill} />;
  }

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      fill="none"
      className={cn("shrink-0", className)}
      {...(decorative
        ? { "aria-hidden": true, focusable: false }
        : { role: "img", "aria-label": "UniWork" })}
    >
      {needsGradient ? (
        <defs>
          <linearGradient
            id={gradientId}
            x1={0}
            y1={0}
            x2={MARK.width}
            y2={0}
            gradientUnits="userSpaceOnUse"
          >
            {/* The ramp swaps with the theme through the `dark:` variant rather
                than through JS: a theme read in the component would flash the
                light ramp on the server-rendered frame. */}
            {BRAND_GRADIENT.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} className={stop.className} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      {content}
    </svg>
  );
}

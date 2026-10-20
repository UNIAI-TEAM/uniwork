"use client";

import { useId } from "react";

import { cn } from "@uniwork/ui/lib/utils";

import { COMPACT_MAX_SIZE, MARK, MARK_COMPACT } from "./mark.generated";
import { UNICHAT_ICON } from "./unichat.generated";

type UniChatIconProps = {
  /** Rendered width and height in px. */
  size?: number;
  /** aria-hidden, for when "UniChat" is already in the surrounding name. */
  decorative?: boolean;
  className?: string;
};

// The in-product tile's corner, 22.4% like a phone's mask; the store icons are
// full bleed and the OS rounds them itself.
const CORNER = 229;

/**
 * The UniChat app icon as the product shows it: the gradient tile, the speech
 * bubble, the UniWork mark inside. Inline SVG for the reasons Logo gives (an id
 * per instance), and like Logo the mark swaps to its compact artwork by the
 * height it actually renders at.
 */
export function UniChatIcon({ size = 64, decorative = false, className }: UniChatIconProps) {
  const id = useId();
  const { bubble, mark, gradient, tail } = UNICHAT_ICON;
  const art = (size * mark.scale * MARK.height) / 1024 <= COMPACT_MAX_SIZE ? MARK_COMPACT : MARK;
  const stops = gradient.map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />);
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      fill="none"
      className={cn("shrink-0", className)}
      {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": "UniChat" })}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1={0} y1={1024} x2={1024} y2={0} gradientUnits="userSpaceOnUse">
          {stops}
        </linearGradient>
        <linearGradient id={`${id}-mark`} x1={0} y1={0} x2={MARK.width} y2={0} gradientUnits="userSpaceOnUse">
          {stops}
        </linearGradient>
      </defs>
      <rect width={1024} height={1024} rx={CORNER} fill={`url(#${id}-tile)`} />
      <g fill="#fff">
        <rect x={bubble.x} y={bubble.y} width={bubble.width} height={bubble.height} rx={bubble.rx} />
        <path d={tail} />
      </g>
      <g transform={`translate(${mark.x} ${mark.y}) scale(${mark.scale})`} fill={`url(#${id}-mark)`}>
        {art.heads.map((h, i) => (
          <circle key={`h${i}`} cx={h.cx} cy={h.cy} r={h.r} />
        ))}
        {art.bodies.map((b, i) => (
          <rect key={`b${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={b.rx} />
        ))}
        <path d={art.ribbon} />
      </g>
    </svg>
  );
}

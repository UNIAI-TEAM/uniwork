"use client";

import { useId } from "react";
import { MARK, MARK_COMPACT } from "@uniwork/ui/brand/mark.generated";

// The mark's light ramp, as the UniChat tile draws it. A product mark like the
// Office marks beside it: fixed colours, not theme slots.
const RAMP = [
  { offset: "0", color: "#0044E3" },
  { offset: ".52", color: "#00B4FC" },
  { offset: "1", color: "#02DEF5" },
] as const;

// Where the mark sits on the page, on the 240 grid the Office marks share.
const MARK_X = 76;
const MARK_Y = 82;
const MARK_SCALE = 88 / MARK.width;

/**
 * The UniNote tile (Documents design, option J, 2026-10-21): the gradient tile,
 * a folded white page, the UniWork mark and two text lines. It always draws the
 * compact mark: the largest tile in the product is 36px, where the mark is
 * under 10px tall, far below the 24px at which Logo leaves the compact art.
 */
export function UniNoteIcon({ className }: { className?: string }) {
  const id = useId();
  const stops = RAMP.map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />);
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 240 240" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}-tile`} x1={0} y1={240} x2={240} y2={0} gradientUnits="userSpaceOnUse">
          {stops}
        </linearGradient>
        <linearGradient id={`${id}-mark`} x1={0} y1={0} x2={MARK.width} y2={0} gradientUnits="userSpaceOnUse">
          {stops}
        </linearGradient>
      </defs>
      <rect width="240" height="240" rx="48" fill={`url(#${id}-tile)`} />
      <path d="M72 36H144L184 76V188a16 16 0 0 1-16 16H72a16 16 0 0 1-16-16V52a16 16 0 0 1 16-16Z" fill="#fff" />
      <path d="M144 36V64a12 12 0 0 0 12 12H184Z" fill="#A8E4FF" />
      <g transform={`translate(${MARK_X} ${MARK_Y}) scale(${MARK_SCALE})`} fill={`url(#${id}-mark)`}>
        {MARK_COMPACT.heads.map((h, i) => (
          <circle key={`h${i}`} cx={h.cx} cy={h.cy} r={h.r} />
        ))}
        {MARK_COMPACT.bodies.map((b, i) => (
          <rect key={`b${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={b.rx} />
        ))}
        <path d={MARK_COMPACT.ribbon} />
      </g>
      <rect x="76" y="160" width="88" height="12" rx="6" fill="#4FA8FF" opacity={0.7} />
      <rect x="76" y="180" width="58" height="12" rx="6" fill="#2E7CF0" opacity={0.75} />
    </svg>
  );
}

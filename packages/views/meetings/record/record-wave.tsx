"use client";
import { cn } from "@uniwork/ui/lib/utils";

/** Below this the recorder lays out for a phone (fewer, shorter bars; a smaller clock). */
export const NARROW = "(max-width: 599px)";

/**
 * A row of level bars, oldest on the left and fading in toward the newest.
 * Each bar is `min + level * span` px tall; `flat` lays every bar at `min`
 * (a paused recording hears nothing). Decoration: the meter beside it, or the
 * status words, say what the wave shows.
 */
export function RecordWave({
  levels,
  min,
  span,
  flat = false,
  className,
  barClassName,
}: {
  levels: number[];
  min: number;
  span: number;
  flat?: boolean;
  className?: string;
  barClassName?: string;
}) {
  const last = Math.max(1, levels.length - 1);
  return (
    <div aria-hidden className={cn("flex items-center", className)} data-testid="record-wave">
      {levels.map((level, i) => (
        <i
          key={i}
          className={cn("block shrink-0 rounded-full bg-meeting-stage-foreground", barClassName)}
          style={{ height: Math.round(min + (flat ? 0 : level) * span), opacity: 0.3 + (0.7 * i) / last }}
        />
      ))}
    </div>
  );
}

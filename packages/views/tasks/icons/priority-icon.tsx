import type { TaskPriority } from "@uniwork/core/types";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { priorityTone } from "../modes/priority-config";

const filledBars: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 3,
};

export function PriorityIcon({
  priority,
  className,
  inheritColor = false,
}: {
  priority: string;
  className?: string;
  inheritColor?: boolean;
}) {
  const known = priority in filledBars ? (priority as TaskPriority) : "none";
  const color = inheritColor ? undefined : tintForegroundClass[priorityTone(known)];

  if (known === "none") {
    return (
      <svg
        aria-hidden
        data-slot="priority-icon"
        viewBox="0 0 16 16"
        className={cn("size-3.5 shrink-0", color, className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
    );
  }

  if (known === "urgent") {
    return (
      <svg
        aria-hidden
        data-slot="priority-icon"
        viewBox="0 0 16 16"
        className={cn("size-3.5 shrink-0", color, className)}
        fill="none"
      >
        <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" />
        <line
          x1="8"
          y1="5"
          x2="8"
          y2="8.6"
          stroke="var(--background, #fff)"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11" r="0.95" fill="var(--background, #fff)" />
      </svg>
    );
  }

  const heights = [6, 9, 12];
  return (
    <svg
      aria-hidden
      data-slot="priority-icon"
      viewBox="0 0 16 16"
      className={cn("size-3.5 shrink-0", color, className)}
      fill="currentColor"
    >
      {heights.map((height, index) => (
        <rect
          key={height}
          x={2 + index * 4.25}
          y={14 - height}
          width="3.5"
          height={height}
          rx="1"
          opacity={index < filledBars[known] ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}

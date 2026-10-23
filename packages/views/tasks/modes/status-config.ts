import type { TaskStatus } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";

/**
 * Colour of the seven catalog categories. `tone` is the category's tint
 * (identity, not state — see PRODUCT.md › Design Principles) and the only
 * source of its hue: the glyph, the list pill, the swimlane dot and the column
 * wash all read it, so a category never wears one colour on the board and
 * another in the list. The wash is the tint's pale fill, not an alpha of a
 * text-safe colour — a dark hue at 5% turns muddy. Status glyph geometry lives
 * in `icons/status-icon.tsx`.
 */
export const STATUS_CONFIG: Record<
  TaskStatus,
  { tone: Tint; iconColor: string; columnBg: string }
> = {
  backlog: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray/60 dark:bg-tint-gray/35" },
  todo: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray/60 dark:bg-tint-gray/35" },
  in_progress: { tone: "yellow", iconColor: tintForegroundClass.yellow, columnBg: "bg-tint-yellow/60 dark:bg-tint-yellow/35" },
  in_review: { tone: "green", iconColor: tintForegroundClass.green, columnBg: "bg-tint-green/60 dark:bg-tint-green/35" },
  done: { tone: "blue", iconColor: tintForegroundClass.blue, columnBg: "bg-tint-blue/60 dark:bg-tint-blue/35" },
  blocked: { tone: "red", iconColor: tintForegroundClass.red, columnBg: "bg-tint-red/60 dark:bg-tint-red/35" },
  cancelled: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray/60 dark:bg-tint-gray/35" },
};

/** Columns that are not a status (assignee, project) sit on the neutral plane. */
const NEUTRAL_COLUMN_BG = "bg-muted/50 dark:bg-muted/20";

export function statusColumnBg(status: string): string {
  return STATUS_CONFIG[status as TaskStatus]?.columnBg ?? NEUTRAL_COLUMN_BG;
}

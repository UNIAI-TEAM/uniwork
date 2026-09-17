import type { TaskStatus } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";

/**
 * Column chrome for the seven catalog categories. `tone` is the category's
 * tint (identity, not state — see PRODUCT.md › Design Principles). Status
 * glyph geometry lives in `icons/status-icon.tsx`, matching Multica.
 */
export const STATUS_CONFIG: Record<
  TaskStatus,
  { tone: Tint; iconColor: string; columnBg: string }
> = {
  backlog: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray dark:bg-tint-gray/35" },
  todo: { tone: "blue", iconColor: tintForegroundClass.blue, columnBg: "bg-tint-blue dark:bg-tint-blue/35" },
  in_progress: { tone: "yellow", iconColor: tintForegroundClass.yellow, columnBg: "bg-tint-yellow dark:bg-tint-yellow/35" },
  in_review: { tone: "violet", iconColor: tintForegroundClass.violet, columnBg: "bg-tint-violet dark:bg-tint-violet/35" },
  done: { tone: "green", iconColor: tintForegroundClass.green, columnBg: "bg-tint-green dark:bg-tint-green/35" },
  blocked: { tone: "red", iconColor: tintForegroundClass.red, columnBg: "bg-tint-red dark:bg-tint-red/35" },
  cancelled: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray dark:bg-tint-gray/35" },
};

export function statusColumnBg(status: string): string {
  return STATUS_CONFIG[status as TaskStatus]?.columnBg ?? "bg-muted/20";
}

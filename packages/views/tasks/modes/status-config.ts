import type { TaskStatus } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";

/**
 * Column chrome for the seven catalog categories. `tone` is the category's
 * tint (identity, not state — see PRODUCT.md › Design Principles). Status
 * glyph geometry lives in `icons/status-icon.tsx`.
 */
export const STATUS_CONFIG: Record<
  TaskStatus,
  { tone: Tint; iconColor: string; columnBg: string }
> = {
  backlog: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-muted/40" },
  todo: { tone: "blue", iconColor: tintForegroundClass.gray, columnBg: "bg-muted/40" },
  in_progress: { tone: "yellow", iconColor: "text-warning", columnBg: "bg-warning/5" },
  in_review: { tone: "violet", iconColor: "text-success", columnBg: "bg-success/5" },
  done: { tone: "green", iconColor: "text-info", columnBg: "bg-info/5" },
  blocked: { tone: "red", iconColor: "text-destructive", columnBg: "bg-destructive/5" },
  cancelled: { tone: "gray", iconColor: tintForegroundClass.gray, columnBg: "bg-muted/40" },
};

export function statusColumnBg(status: string): string {
  return STATUS_CONFIG[status as TaskStatus]?.columnBg ?? "bg-muted/20";
}

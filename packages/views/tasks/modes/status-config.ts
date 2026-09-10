import type { LucideIcon } from "lucide-react";
import { Ban, Circle, CircleCheck, CircleDashed, CircleDot, CircleX, Eye } from "lucide-react";
import type { TaskStatus } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";

/**
 * Column chrome for the seven catalog categories. `tone` is the category's
 * tint (identity, not state — see PRODUCT.md › Design Principles); `icon`
 * is the glyph every surface shows beside the status so a row can be read
 * without its column.
 */
export const STATUS_CONFIG: Record<
  TaskStatus,
  { tone: Tint; icon: LucideIcon; iconColor: string; columnBg: string }
> = {
  backlog: { tone: "gray", icon: CircleDashed, iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray/35" },
  todo: { tone: "blue", icon: Circle, iconColor: tintForegroundClass.blue, columnBg: "bg-tint-blue/35" },
  in_progress: { tone: "yellow", icon: CircleDot, iconColor: tintForegroundClass.yellow, columnBg: "bg-tint-yellow/35" },
  in_review: { tone: "violet", icon: Eye, iconColor: tintForegroundClass.violet, columnBg: "bg-tint-violet/35" },
  done: { tone: "green", icon: CircleCheck, iconColor: tintForegroundClass.green, columnBg: "bg-tint-green/35" },
  blocked: { tone: "red", icon: Ban, iconColor: tintForegroundClass.red, columnBg: "bg-tint-red/35" },
  cancelled: { tone: "gray", icon: CircleX, iconColor: tintForegroundClass.gray, columnBg: "bg-tint-gray/35" },
};

export function statusColumnBg(status: string): string {
  return STATUS_CONFIG[status as TaskStatus]?.columnBg ?? "bg-muted/20";
}

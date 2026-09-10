import type { TaskStatus } from "@uniwork/core/types";

/** Column chrome for the seven catalog categories. */
export const STATUS_CONFIG: Record<
  TaskStatus,
  { iconColor: string; columnBg: string }
> = {
  backlog: {
    iconColor: "text-muted-foreground",
    columnBg: "bg-muted/20",
  },
  todo: {
    iconColor: "text-muted-foreground",
    columnBg: "bg-muted/20",
  },
  in_progress: {
    iconColor: "text-warning",
    columnBg: "bg-warning/5",
  },
  in_review: {
    iconColor: "text-success",
    columnBg: "bg-success/5",
  },
  done: {
    iconColor: "text-info",
    columnBg: "bg-info/5",
  },
  blocked: {
    iconColor: "text-destructive",
    columnBg: "bg-destructive/5",
  },
  cancelled: {
    iconColor: "text-muted-foreground",
    columnBg: "bg-muted/20",
  },
};

export function statusColumnBg(status: string): string {
  return STATUS_CONFIG[status as TaskStatus]?.columnBg ?? "bg-muted/20";
}

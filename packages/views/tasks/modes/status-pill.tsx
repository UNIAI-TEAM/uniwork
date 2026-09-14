"use client";
import { Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskStatus } from "@uniwork/core/types";
import { tintClass, tintForegroundClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { priorityTone } from "./priority-config";
import { STATUS_CONFIG } from "./status-config";

/** Status glyph in the category's tint — the per-row mark beside a title. */
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_CONFIG[status as TaskStatus];
  const Icon = cfg?.icon ?? STATUS_CONFIG.todo.icon;
  return (
    <Icon
      aria-hidden
      data-slot="status-icon"
      className={cn("size-4 shrink-0", cfg?.iconColor ?? "text-muted-foreground", className)}
    />
  );
}

/**
 * Group / column header: the status name on its solid tint, uppercase, with
 * the glyph. The count sits OUTSIDE the pill in plain text — it is a number,
 * not part of the label.
 */
export function StatusPill({ status, label, className }: { status: string; label: string; className?: string }) {
  const cfg = STATUS_CONFIG[status as TaskStatus];
  const Icon = cfg?.icon ?? STATUS_CONFIG.todo.icon;
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-micro font-bold uppercase tracking-wide [&_svg]:size-3.5",
        cfg ? tintSolidClass[cfg.tone] : "bg-primary text-primary-foreground",
        className,
      )}
    >
      <Icon aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Priority as a filled flag in its tint; label is aria-only unless `withLabel`. */
export function PriorityFlag({
  priority,
  withLabel = false,
  className,
}: {
  priority: string;
  withLabel?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const tone = priorityTone(priority);
  const label = t(`tasks.priority_${priority}`);
  if (!withLabel) {
    return (
      <Flag
        role="img"
        aria-label={label}
        data-slot="priority-flag"
        className={cn("size-3.5 shrink-0 fill-current", tintForegroundClass[tone], className)}
      />
    );
  }
  return (
    <span
      data-slot="priority-flag"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-medium",
        tintClass[tone],
        className,
      )}
    >
      <Flag aria-hidden className="size-3 fill-current" />
      {label}
    </span>
  );
}

"use client";
import { useTranslation } from "react-i18next";
import type { TaskStatus } from "@uniwork/core/types";
import { tintClass, tintForegroundClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { PriorityIcon } from "../icons/priority-icon";
import { StatusIcon } from "../icons/status-icon";
import { priorityTone } from "./priority-config";
import { STATUS_CONFIG } from "./status-config";

export { StatusIcon } from "../icons/status-icon";

/**
 * Group / column header: the status name on its solid tint, uppercase, with
 * the glyph. The count sits OUTSIDE the pill in plain text — it is a number,
 * not part of the label.
 */
export function StatusPill({ status, label, className }: { status: string; label: string; className?: string }) {
  const cfg = STATUS_CONFIG[status as TaskStatus];
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
      <StatusIcon status={status} inheritColor />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function StatusHeading({
  status,
  label,
  count,
}: {
  status: string;
  label: string;
  count: number;
}) {
  const cfg = STATUS_CONFIG[status as TaskStatus];
  return (
    <div data-slot="status-heading" className="flex min-w-0 items-center gap-2">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-caption font-semibold">
        <StatusIcon status={status} className={cn("size-3", cfg?.iconColor)} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{count}</span>
    </div>
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
      <span
        role="img"
        aria-label={label}
        data-slot="priority-flag"
        className={cn("inline-flex shrink-0", tintForegroundClass[tone])}
      >
        <PriorityIcon priority={priority} inheritColor className={className} />
      </span>
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
      <PriorityIcon priority={priority} inheritColor className="size-3" />
      {label}
    </span>
  );
}

"use client";

import { useTranslation } from "react-i18next";
import type { TableRowLabel } from "@uniwork/core/api/endpoints/tasks-table";
import { cn } from "@uniwork/ui/lib/utils";
import { labelChipClass } from "../pickers/label-picker";

/** A task's labels on a card or a list row: the first `max`, then "+n". */
export function TaskLabelChips({
  labels,
  max = 2,
  className,
}: {
  labels: TableRowLabel[];
  max?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  if (labels.length === 0) return null;
  const rest = labels.length - max;
  return (
    <ul aria-label={t("tasks.display.card_labels")} className={cn("flex min-w-0 items-center gap-1", className)}>
      {labels.slice(0, max).map((label) => (
        <li
          key={label.id}
          className={cn("max-w-24 truncate rounded px-1.5 py-0.5 text-micro", labelChipClass(label.color))}
        >
          {label.name}
        </li>
      ))}
      {rest > 0 ? <li className="shrink-0 text-micro tabular-nums text-muted-foreground">+{rest}</li> : null}
    </ul>
  );
}

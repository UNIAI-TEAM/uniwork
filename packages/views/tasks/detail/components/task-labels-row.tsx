"use client";

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskLabel } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PROP_ROW_TRIGGER_CLASS, PropRow } from "../../../common/prop-row";
import { LabelPicker, labelChipClass, useTaskLabelToggle } from "../../pickers";

/** Attached label chips with a remove button each, then the add-label menu. */
export function TaskLabelsRow({
  workspaceId,
  taskId,
  catalog,
  attached,
  defaultOpen,
}: {
  workspaceId: string;
  taskId: string;
  catalog: TaskLabel[];
  attached: TaskLabel[];
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const toggle = useTaskLabelToggle(workspaceId, taskId, catalog);
  const attachedIds = new Set(attached.map((label) => label.id));

  return (
    <PropRow label={t("tasks.detail.prop_labels")}>
      <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
        {attached.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {attached.map((label) => (
              <li
                key={label.id}
                className={cn(
                  "inline-flex h-6 items-center gap-0.5 rounded-md pr-0.5 pl-1.5 text-caption",
                  labelChipClass(label.color),
                )}
              >
                <span className="max-w-32 truncate">{label.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-current hover:bg-foreground/10"
                  aria-label={t("tasks.detail.remove_label", { name: label.name })}
                  aria-disabled={toggle.pendingIds.has(label.id) || undefined}
                  onClick={() => toggle.toggle(label.id, false)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <LabelPicker
          labels={catalog}
          selectedIds={attachedIds}
          pendingIds={toggle.pendingIds}
          onToggle={toggle.toggle}
          ariaLabel={t("tasks.detail.add_label")}
          emptyLabel={t("tasks.table.labels_empty")}
          searchPlaceholder={t("tasks.create.label_search_placeholder")}
          noResultsLabel={t("tasks.create.options_no_results")}
          triggerClassName={cn(PROP_ROW_TRIGGER_CLASS, "text-muted-foreground")}
          defaultOpen={defaultOpen}
        >
          {t("tasks.detail.add_label")}
        </LabelPicker>
      </div>
    </PropRow>
  );
}

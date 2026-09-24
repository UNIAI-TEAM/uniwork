"use client";

import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { formatActionDueHint } from "./email-hub-summary-task-due";

export function EmailHubAiActionItemsCard({
  locale,
  actionItems,
  picked,
  onPickedChange,
  onOpenCreateDialog,
  createDisabled,
}: {
  locale: string;
  actionItems: EmailHubThreadSummary["action_items"];
  picked: Set<number>;
  onPickedChange: (next: Set<number>) => void;
  onOpenCreateDialog: () => void;
  createDisabled: boolean;
}) {
  const { t } = useTranslation();

  if (actionItems.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-surface px-3 py-3">
      <div className="flex items-center gap-2 text-caption font-medium text-foreground">
        <ListChecks className="size-3.5 shrink-0 text-brand" aria-hidden />
        {t("email_hub.ai.action_items")}
      </div>
      <p className="text-caption leading-snug text-muted-foreground">{t("email_hub.ai.task_pick_hint")}</p>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {actionItems.map((item, index) => (
          <li
            key={`${item.title}-${index}`}
            className={cn(
              "px-3 py-2.5 transition-colors",
              picked.has(index) && "bg-surface-selected",
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={picked.has(index)}
                onCheckedChange={(checked) => {
                  const next = new Set(picked);
                  if (checked) next.add(index);
                  else next.delete(index);
                  onPickedChange(next);
                }}
                aria-label={item.title}
              />
              <span className="min-w-0 flex-1 text-body leading-snug text-foreground">
                {item.title}
                {item.owner || item.due ? (
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {[item.owner, formatActionDueHint(item.due, locale)].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        size="sm"
        className="w-full rounded-full"
        disabled={createDisabled}
        onClick={onOpenCreateDialog}
      >
        {t("email_hub.ai.create_tasks")}
      </Button>
    </div>
  );
}

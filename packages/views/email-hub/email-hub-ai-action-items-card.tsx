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
    <section className="space-y-3 rounded-lg border border-border bg-surface px-4 py-3" aria-labelledby="email-hub-ai-actions">
      <h3 id="email-hub-ai-actions" className="flex items-center gap-2 text-body font-semibold text-foreground">
        <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("email_hub.ai.action_items")}
      </h3>
      <p className="text-caption leading-snug text-muted-foreground">{t("email_hub.ai.task_pick_hint")}</p>

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {actionItems.map((item, index) => (
          <li
            key={`${item.title}-${index}`}
            className={cn(
              "px-3 py-2.5 transition-colors",
              picked.has(index) && "bg-brand-subtle/50",
            )}
          >
            {/* The whole line is the label: the title is the target, not only the 16px box. */}
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={picked.has(index)}
                onCheckedChange={(checked) => {
                  const next = new Set(picked);
                  if (checked) next.add(index);
                  else next.delete(index);
                  onPickedChange(next);
                }}
              />
              <span className="min-w-0 flex-1 text-body leading-snug text-foreground">
                {item.title}
                {item.owner || item.due ? (
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {[item.owner, formatActionDueHint(item.due, locale)].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <Button type="button" variant="brand" className="w-full" disabled={createDisabled} onClick={onOpenCreateDialog}>
        {t("email_hub.ai.create_tasks", { count: picked.size })}
      </Button>
    </section>
  );
}

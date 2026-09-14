"use client";

import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { HomeCounts } from "@uniwork/core/types/home";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";

type StatKey = "due_today" | "overdue" | "meetings_today" | "unread";

/**
 * Today at a glance, as inline numbers rather than KPI cards (PRODUCT.md).
 * Each number opens the screen it counts; overdue is the only one that turns
 * to the danger signal, and only when it is not zero.
 */
export function HomeStats({ counts, loading }: { counts: HomeCounts | undefined; loading: boolean }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const items: { key: StatKey; href: string }[] = [
    { key: "due_today", href: ws.myTasks() },
    { key: "overdue", href: ws.myTasks() },
    { key: "meetings_today", href: ws.meetings() },
    { key: "unread", href: ws.inbox() },
  ];

  return (
    <section
      aria-label={t("home.stats.label")}
      className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-[var(--surface-shadow)]"
    >
      <ul className="grid grid-cols-2 sm:grid-cols-4">
        {items.map(({ key, href }) => {
          const value = counts?.[key] ?? 0;
          return (
            <li key={key} className="border-border not-last:border-b sm:not-last:border-r sm:not-last:border-b-0">
              <AppLink href={href} className="flex min-h-14 items-baseline gap-2 px-4 py-3 hover:bg-surface-hover">
                {loading ? (
                  <Skeleton className="h-6 w-8" />
                ) : (
                  <span
                    data-testid={`home-stat-${key}`}
                    className={cn(
                      "text-title font-semibold tabular-nums",
                      key === "overdue" && value > 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {value}
                  </span>
                )}
                <span className="text-caption text-muted-foreground">{t(`home.stats.${key}`)}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

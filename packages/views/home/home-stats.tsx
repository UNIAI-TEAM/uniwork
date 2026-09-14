"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { HomeCounts } from "@uniwork/core/types/home";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";

type StatKey = "due_today" | "overdue" | "meetings_today" | "unread";
export type HomeWorkStat = Extract<StatKey, "due_today" | "overdue">;

const CELL = "flex min-h-14 w-full items-baseline gap-2 px-4 py-3 text-left";

/**
 * Dividers for a 2×2 grid below `sm` and one row of four above it: the top row
 * and the left column carry the inner lines, so no line doubles the card edge.
 */
function dividerClass(index: number): string {
  return cn(
    "border-border",
    index < 2 && "border-b sm:border-b-0",
    index % 2 === 0 && "border-r",
    index === 1 && "sm:border-r",
  );
}

/**
 * Today at a glance, as inline numbers rather than KPI cards (PRODUCT.md).
 * Each number goes to what it counts: overdue and due today move focus to the
 * first such task in My work on this page (the task lists elsewhere have no
 * due-date filter to land on), meetings open the meeting list, unread opens
 * the inbox. A number with nowhere truthful to go is plain text. Overdue is the
 * only one that turns to the danger signal, and only when it is not zero.
 */
export function HomeStats({
  counts,
  loading,
  onShowWork,
}: {
  counts: HomeCounts | undefined;
  loading: boolean;
  /** Present only while My work is on the page. */
  onShowWork?: (stat: HomeWorkStat) => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const items: { key: StatKey; href?: string }[] = [
    { key: "due_today" },
    { key: "overdue" },
    { key: "meetings_today", href: ws.meetings() },
    { key: "unread", href: ws.inbox() },
  ];

  return (
    <section
      aria-label={t("home.stats.label")}
      className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-[var(--surface-shadow)]"
    >
      <ul className="grid grid-cols-2 sm:grid-cols-4">
        {items.map(({ key, href }, index) => {
          const value = counts?.[key] ?? 0;
          const label = t(`home.stats.${key}`);
          const name = t("home.stats.item", { count: value, label });
          const content: ReactNode = (
            <>
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
              <span className="text-caption text-muted-foreground">{label}</span>
            </>
          );
          const showWork = (key === "overdue" || key === "due_today") && value > 0 && !loading ? onShowWork : undefined;

          return (
            <li key={key} className={dividerClass(index)}>
              {href ? (
                <AppLink href={href} aria-label={name} className={cn(CELL, "hover:bg-surface-hover")}>
                  {content}
                </AppLink>
              ) : showWork ? (
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => showWork(key as HomeWorkStat)}
                  className={cn(CELL, "cursor-pointer hover:bg-surface-hover")}
                >
                  {content}
                </button>
              ) : (
                <div className={CELL}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

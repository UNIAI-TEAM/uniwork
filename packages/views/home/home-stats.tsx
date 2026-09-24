"use client";

import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { HomeCounts } from "@uniwork/core/types/home";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { HOME_MARKS, homeMarkTone, type HomeMarkKey } from "./home-marks";

export type HomeWorkStat = Extract<HomeMarkKey, "due_today" | "overdue">;

const TILE =
  "group flex h-full w-full items-center gap-3 rounded-xl border border-surface-border bg-surface p-3.5 text-left shadow-[var(--surface-shadow)] sm:p-4";
const INTERACTIVE =
  "cursor-pointer transition-[background-color,border-color] duration-150 ease-out hover:border-border hover:bg-surface-hover active:bg-surface-selected";

/**
 * Today at a glance: four tiles counting real records (PRODUCT.md allows
 * metric cards that report the state of the thing on screen). Each number
 * goes to what it counts: overdue and due today move focus to the first such
 * task in My work on this page (the task lists elsewhere have no due-date
 * filter to land on), meetings open the meeting list, unread opens the inbox.
 * A number with nowhere truthful to go is plain text. Due and overdue take
 * their signal colour only when they are not zero; overdue is the only
 * number that turns red.
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
  const items: { key: HomeMarkKey; href?: string }[] = [
    { key: "due_today" },
    { key: "overdue" },
    { key: "meetings_today", href: ws.meetings() },
    { key: "unread", href: ws.inbox() },
  ];

  return (
    <section aria-label={t("home.stats.label")}>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(({ key, href }) => {
          const value = counts?.[key] ?? 0;
          const label = t(`home.stats.${key}`);
          const name = t("home.stats.item", { count: value, label });
          const showWork = (key === "overdue" || key === "due_today") && value > 0 && !loading ? onShowWork : undefined;
          const interactive = Boolean(href || showWork);
          const content: ReactNode = (
            <>
              <IconTile icon={HOME_MARKS[key].icon} tone={loading ? "muted" : homeMarkTone(key, value)} />
              <span className="flex min-w-0 flex-1 flex-col">
                {loading ? (
                  <Skeleton className="my-1 h-6 w-10" />
                ) : (
                  <span
                    data-testid={`home-stat-${key}`}
                    className={cn(
                      "text-display-sm font-semibold tabular-nums",
                      key === "overdue" && value > 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {value}
                  </span>
                )}
                <span className="text-label text-pretty text-muted-foreground first-letter:uppercase">{label}</span>
              </span>
              {interactive ? (
                <ArrowUpRight
                  aria-hidden
                  className="size-4 shrink-0 self-start text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              ) : null}
            </>
          );

          return (
            <li key={key} className="min-w-0">
              {href ? (
                <AppLink href={href} aria-label={name} className={cn(TILE, INTERACTIVE)}>
                  {content}
                </AppLink>
              ) : showWork ? (
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => showWork(key as HomeWorkStat)}
                  className={cn(TILE, INTERACTIVE)}
                >
                  {content}
                </button>
              ) : (
                <div className={TILE}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

"use client";

import { useState } from "react";
import { RotateCcw, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { PAGE_GUTTER } from "../layout/page-header";

export interface TrashItem {
  id: string;
  title: string;
  subtitle?: string;
  trashedAt: string;
  trashedByName: string;
  purgeAfter: string;
  /** Subtasks trashed with a task; tasks of a trashed project. */
  extraCount: number;
}

const DAY_MS = 86_400_000;

/** Whole days until the purge, rounded up and never below 0. */
function daysLeft(purgeAfter: string): number {
  const ms = Date.parse(purgeAfter) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / DAY_MS)) : 0;
}

export function TrashList({
  kind,
  items,
  onRestore,
  onPurge,
  busy = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  kind: "task" | "project";
  items: TrashItem[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  /** A restore or purge is in flight: the buttons stay in the tab order but do nothing. */
  busy?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <ul className={`flex flex-col divide-y divide-border ${PAGE_GUTTER}`}>
        {items.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-body font-medium">{row.title}</span>
                {row.subtitle ? (
                  <span className="shrink-0 font-mono text-caption text-muted-foreground">{row.subtitle}</span>
                ) : null}
              </div>
              <p className="text-caption text-muted-foreground">
                {t("trash.trashed_by", { name: row.trashedByName, time: when(row.trashedAt) })}
              </p>
              <p className="text-caption text-muted-foreground">
                {t("trash.purge_in", { count: daysLeft(row.purgeAfter) })}
              </p>
              {row.extraCount > 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t(kind === "task" ? "trash.subtasks" : "trash.project_tasks", { count: row.extraCount })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="toolbar"
                size="sm"
                aria-label={t("trash.restore_item", { title: row.title })}
                aria-disabled={busy || undefined}
                onClick={() => onRestore(row.id)}
              >
                <RotateCcw aria-hidden className="size-3.5" />
                {t("trash.restore")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                aria-label={t("trash.purge_item", { title: row.title })}
                aria-disabled={busy || undefined}
                onClick={() => setPurging(row)}
              >
                <Trash aria-hidden className="size-3.5" />
                {t("trash.purge")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="flex justify-center py-3">
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-disabled={loadingMore || undefined}
            onClick={onLoadMore}
          >
            {loadingMore ? <Spinner /> : null}
            {t("trash.load_more")}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={purging !== null} onOpenChange={(open) => !open && setPurging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trash.purge_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("trash.purge_desc", { title: purging?.title ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("trash.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (purging) onPurge(purging.id);
                setPurging(null);
              }}
            >
              {t("trash.purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

"use client";

import { useId, useState } from "react";
import { Ellipsis, Folder, Lock, RotateCcw, Trash, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrashItem } from "@uniwork/core/trash";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { DocumentPurgeDialog } from "../documents/document-purge-dialog";
import { MODULE_ICONS } from "../layout/module-icons";
import { absoluteTime, relativeTime } from "../notifications/relative-time";
import { SettingsCard } from "../settings/components/settings-layout";

const DAY_MS = 86_400_000;
/** At or under this many days left, the count turns red. */
const SOON_DAYS = 7;

/** Whole days until the purge, rounded up and never below 0. */
function daysLeft(purgeAfter: string): number {
  const ms = Date.parse(purgeAfter) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / DAY_MS)) : 0;
}

const KIND_ICONS: Record<string, LucideIcon> = {
  task: MODULE_ICONS.tasks,
  project: MODULE_ICONS.projects,
  document: MODULE_ICONS.documents,
};
const DOCUMENT_SUB_KINDS = new Set(["page", "file", "folder"]);

export function TrashTable({
  wsId,
  items,
  nameOf,
  onRestore,
  onPurge,
  busy = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  wsId: string;
  items: TrashItem[];
  /** The deleter's display name from their user id. */
  nameOf: (userId?: string) => string;
  onRestore: (row: TrashItem) => void;
  /** A task or a project, once confirmed here; a document confirms and purges in DocumentPurgeDialog. */
  onPurge: (row: TrashItem) => void;
  /** A restore or purge is in flight: the commands stay in the tab order but do nothing. */
  busy?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const reasonIdBase = useId();
  // A row may come back without a title; the cell, the menu's name and the dialog all say so.
  const titleOf = (row: TrashItem) =>
    row.title || (row.kind === "document" ? t("documents.detail.untitled") : t("trash.untitled"));

  const subLine = (row: TrashItem): string => {
    switch (row.kind) {
      case "task":
        return row.count > 0 ? t("trash.sub.task_with", { count: row.count }) : t("trash.kinds.task");
      case "project":
        return row.count > 0 ? t("trash.sub.project_with", { count: row.count }) : t("trash.kinds.project");
      case "document":
        return DOCUMENT_SUB_KINDS.has(row.sub_kind) ? t(`trash.sub.${row.sub_kind}`) : t("trash.kinds.document");
      default:
        return "";
    }
  };
  // Only the two kinds whose rows can be locked have a reason; a task is always manageable.
  const lockReason = (row: TrashItem): string | null => {
    if (row.can_manage) return null;
    if (row.kind === "project") return t("trash.locked.project");
    if (row.kind === "document") return t("trash.locked.document");
    return null;
  };

  return (
    <>
      <SettingsCard>
        <div className="overflow-x-auto">
          <Table aria-label={t("trash.table_label")} className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[38%] pl-4">{t("trash.columns.name")}</TableHead>
                <TableHead>{t("trash.columns.location")}</TableHead>
                <TableHead>{t("trash.columns.trashed_at")}</TableHead>
                <TableHead>{t("trash.columns.trashed_by")}</TableHead>
                <TableHead>{t("trash.columns.left")}</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">{t("trash.columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => {
                const Icon = row.kind === "document" && row.sub_kind === "folder" ? Folder : (KIND_ICONS[row.kind] ?? Trash);
                const days = daysLeft(row.purge_after);
                const reason = lockReason(row);
                const reasonId = reason ? `${reasonIdBase}-${row.kind}-${row.id}` : undefined;
                const title = titleOf(row);
                const location = row.location_path.length > 0 ? row.location_path.join(" › ") : row.location_title;
                // A kind a later server adds has no hook here: listed, never acted on.
                const locked = !row.can_manage || !KIND_ICONS[row.kind];
                return (
                  <TableRow key={`${row.kind}:${row.id}`}>
                    <TableCell className="pl-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-body font-medium">{title}</span>
                            {row.identifier ? (
                              <span className="shrink-0 font-mono text-caption text-muted-foreground">{row.identifier}</span>
                            ) : null}
                          </div>
                          <p className="truncate text-caption text-muted-foreground">{subLine(row)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block max-w-48 truncate" title={location}>
                        {location}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <time dateTime={row.trashed_at} title={absoluteTime(row.trashed_at, i18n.language)}>
                        {relativeTime(row.trashed_at, i18n.language)}
                      </time>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-40 truncate">{nameOf(row.trashed_by)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className={days <= SOON_DAYS ? "text-destructive" : "text-muted-foreground"}>
                        {t("trash.days_left", { count: days })}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("trash.row_actions", { title })}
                            />
                          }
                        >
                          <Ellipsis aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuItem
                            disabled={locked || busy}
                            aria-describedby={reasonId}
                            onClick={() => onRestore(row)}
                          >
                            <RotateCcw aria-hidden />
                            {t("trash.restore")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={locked || busy}
                            aria-describedby={reasonId}
                            onClick={() => setPurging(row)}
                          >
                            <Trash aria-hidden />
                            {t("trash.purge")}
                          </DropdownMenuItem>
                          {reason ? (
                            <p className="flex gap-1.5 px-2 py-1.5 text-caption text-pretty text-muted-foreground">
                              <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
                              <span id={reasonId}>{reason}</span>
                            </p>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SettingsCard>
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            aria-disabled={loadingMore || undefined}
            onClick={loadingMore ? undefined : onLoadMore}
          >
            {loadingMore ? <Spinner data-icon="inline-start" /> : null}
            {t("trash.load_more")}
          </Button>
        </div>
      ) : null}

      {purging?.kind === "document" ? (
        <DocumentPurgeDialog
          open
          wsId={wsId}
          doc={{ id: purging.id, title: purging.title, kind: purging.sub_kind }}
          onOpenChange={(open) => !open && setPurging(null)}
        />
      ) : null}
      <AlertDialog
        open={purging !== null && purging.kind !== "document"}
        onOpenChange={(open) => !open && setPurging(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trash.purge_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("trash.purge_desc", { title: purging ? titleOf(purging) : "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("trash.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (purging) onPurge(purging);
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

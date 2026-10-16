"use client";

import { useMemo } from "react";
import { ArchiveRestore, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { DocumentTypeIcon } from "./document-type-icon";
import { isFolderRow, rowFormat, documentRow, type DocumentSummaryRow } from "./library-rows";
import { canArchiveRow, rowLevel } from "./row-level";

/** Trashed items are purged 30 days after they were trashed (server GC; purge_after is not sent yet). */
const RETENTION_DAYS = 30;
/** At or under this many days left the countdown turns red. */
const URGENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DocumentsTrashViewProps {
  /** The workspace the rows belong to; kept so RESTORE-01 can wire the hard delete without a new prop. */
  wsId: string;
  /** The archived list the page already fetches. */
  rows: DocumentSummaryRow[];
  loading: boolean;
  failure: "error" | "permission" | null;
  onRetry: () => void;
  /** The page's restore handler (rowDialogs.onRestore); only offered at manage level. */
  onRestore: (doc: DocumentSummaryRow) => void;
  /** Opens a trashed document read-only; a trashed folder is never opened. */
  onOpen?: (doc: DocumentSummaryRow) => void;
  /** Slot for the hard delete: renders nothing when absent. */
  onDeleteForever?: (doc: DocumentSummaryRow) => void;
  /** The folder tree, to name the folder a row sat in. */
  tree?: DocumentTreeNode[];
}

function folderTitles(nodes: DocumentTreeNode[], into: Map<string, string> = new Map()): Map<string, string> {
  for (const node of nodes) {
    into.set(node.id, node.title);
    folderTitles(node.children, into);
  }
  return into;
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale || undefined, { dateStyle: "short" }).format(date);
}

/** Whole days left before the purge, or null when the row has no trashed-at time. */
function daysLeft(archivedAt: string | null | undefined, now: number): number | null {
  const at = archivedAt ? new Date(archivedAt).getTime() : NaN;
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at + RETENTION_DAYS * DAY_MS - now) / DAY_MS));
}

/**
 * The Trash screen (Trash.dc.html): header, a dedicated five-column table and
 * the restore note. Presentational: the page owns the query and the restore
 * dialog. It shows only what the row carries, so Deleted-by is a dash until
 * the server sends archived_by (RESTORE-01).
 */
export function DocumentsTrashView({ rows, loading, failure, onRetry, onRestore, onOpen, onDeleteForever, tree }: DocumentsTrashViewProps) {
  const { t, i18n } = useTranslation();
  const titles = useMemo(() => folderTitles(tree ?? []), [tree]);
  const now = Date.now();

  const header = (
    <div className="flex flex-col gap-1">
      <h1 className="text-title font-semibold">{t("documents.trash.title")}</h1>
      <p className="text-caption text-muted-foreground">{t("documents.trash.subtitle")}</p>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="space-y-2" aria-busy="true" aria-label={t("documents.library.loading")}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (failure) {
    const permission = failure === "permission";
    return (
      <div className="flex flex-col gap-5">
        {header}
        <CollectionPageState
          icon={ShieldAlert}
          title={t(permission ? "documents.library.permission_title" : "documents.library.error_title")}
          description={t(permission ? "documents.library.permission_description" : "documents.library.error_description")}
          tone={permission ? undefined : "destructive"}
          role={permission ? "status" : "alert"}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t("documents.library.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <CollectionPageState
          icon={Trash2}
          title={t("documents.home.empty.archived_title")}
          description={t("documents.home.empty.archived_description")}
          role="status"
        />
      </div>
    );
  }

  const subtitle = (doc: DocumentSummaryRow): string => {
    if (doc.kind === "folder") return t("documents.file_types.folder");
    const parent = doc.parent_id ? titles.get(doc.parent_id) : undefined;
    return parent ? t("documents.trash.row_in_folder", { folder: parent }) : t("documents.trash.row_from_root");
  };

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[940px] table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col className="w-[200px]" />
            <col className="w-[120px]" />
            <col className="w-[150px]" />
            <col className="w-[160px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.home.columns.name")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.trash.columns.deleted_by")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.trash.columns.deleted_at")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.trash.columns.purge_after")}</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">{t("documents.home.columns.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => {
              const folder = isFolderRow(documentRow(doc));
              const title = doc.title || t("documents.detail.untitled");
              const left = daysLeft(doc.archived_at, now);
              const deletedAt = doc.archived_at ? formatDate(doc.archived_at, i18n.language) : "";
              const canRestore = canArchiveRow(rowLevel(doc));
              const nameCell = (
                <>
                  <DocumentTypeIcon format={folder ? "folder" : rowFormat(documentRow(doc))} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-foreground">{title}</span>
                    <span className="block truncate text-caption text-muted-foreground">{subtitle(doc)}</span>
                  </span>
                </>
              );
              return (
                <tr key={doc.id} data-trash-row={doc.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-3">
                    {onOpen && !folder ? (
                      <button type="button" onClick={() => onOpen(doc)} className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">
                        {nameCell}
                      </button>
                    ) : (
                      <div className="flex w-full min-w-0 items-center gap-3 pointer-coarse:min-h-11">{nameCell}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {/* archived_by is not in the list data yet (RESTORE-01): a dash that says so, never a guessed name. */}
                    <span aria-label={t("documents.trash.pending_deleted_by")} title={t("documents.trash.pending_deleted_by")} className="text-muted-foreground">
                      —
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-caption tabular-nums text-muted-foreground">{deletedAt || "—"}</td>
                  <td className={cn("px-3 py-3 font-mono text-caption tabular-nums", left !== null && left <= URGENT_DAYS ? "text-destructive" : "text-muted-foreground")}>
                    {left === null ? "—" : t("documents.trash.days_left", { count: left })}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {canRestore ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onRestore(doc)}>
                          <ArchiveRestore aria-hidden />
                          {t("documents.actions.restore")}
                        </Button>
                      ) : (
                        <span className="text-right text-caption text-muted-foreground">{t("documents.trash.read_only_hint")}</span>
                      )}
                      {/* Pending RESTORE-01 wires the hard delete: the slot renders nothing until a host passes the handler. */}
                      {canRestore && onDeleteForever ? (
                        <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" aria-label={t("common.delete")} onClick={() => onDeleteForever(doc)}>
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rounded-lg bg-muted px-3 py-2.5 text-caption text-muted-foreground">{t("documents.trash.footer_note")}</p>
    </div>
  );
}

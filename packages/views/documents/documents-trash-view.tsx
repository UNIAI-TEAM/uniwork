"use client";

import { useMemo } from "react";
import { ArchiveRestore, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canManageTrashed, type DocumentTreeNode } from "@uniwork/core/types/document";
import type { Member } from "@uniwork/core/types/workspace";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { formatShortWhen } from "./document-format";
import { DocumentTypeIcon } from "./document-type-icon";
import { isFolderRow, rowFormat, documentRow, type DocumentSummaryRow } from "./library-rows";
import type { TrashActions } from "./use-trash-actions";

/** At or under this many days left the countdown turns red. */
const URGENT_DAYS = 7;

export interface DocumentsTrashViewProps {
  /** The archived list the page already fetches. */
  rows: DocumentSummaryRow[];
  loading: boolean;
  failure: "error" | "permission" | null;
  onRetry: () => void;
  /** The row commands RESTORE-01 wires: restore (direct) and purge (dialog the page renders). */
  actions: TrashActions;
  /** The workspace member list by user id, feeding the Xóa bởi column. */
  members: ReadonlyMap<string, Member>;
  /** True once the members query has answered; until then an unknown id is "still loading", not "former member". */
  membersReady: boolean;
  /** Opens a trashed document read-only; a trashed folder is never opened. */
  onOpen?: (doc: DocumentSummaryRow) => void;
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

/** Calendar days until the purge deadline, floored at local midnight on each
 *  side so "today" and "expired" mean the reader's day, not a 24-hour span
 *  (RESTORE-01). */
function purgeDaysLeft(purgeAfter: string | null | undefined, now: Date = new Date()): number | null {
  if (!purgeAfter) return null;
  const then = new Date(purgeAfter);
  if (Number.isNaN(then.getTime())) return null;
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((dayStart(then) - dayStart(now)) / 86_400_000);
}

/**
 * The Trash screen (Trash.dc.html): header, a dedicated five-column table and
 * the restore note. Presentational: the page owns the queries, the restore
 * mutation and the purge dialog (use-trash-actions). Rows offer Restore and
 * Delete forever at manage level (`canManageTrashed`, RESTORE-01).
 */
export function DocumentsTrashView({ rows, loading, failure, onRetry, actions, members, membersReady, onOpen, tree }: DocumentsTrashViewProps) {
  const { t, i18n } = useTranslation();
  const titles = useMemo(() => folderTitles(tree ?? []), [tree]);

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
    if (!doc.parent_id) return t("documents.trash.row_from_root");
    // The parent may be in the trash too: name it from the tree or the rows,
    // and say nothing when it is in neither list rather than guess the root.
    const parent = titles.get(doc.parent_id) ?? rows.find((other) => other.id === doc.parent_id)?.title;
    return parent ? t("documents.trash.row_in_folder", { folder: parent }) : "";
  };

  return (
    <div className="@container/trash flex flex-col gap-5">
      {header}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Same rule as the library table: the secondary columns hide by this
            wrapper's own width, so Khôi phục and the purge header are never
            pushed off-screen (TV-2). Rungs: Xóa lúc + Xóa vĩnh viễn sau at
            40rem, Xóa bởi last at 54rem — it needs the widest room for a
            member name. */}
        <table className="w-full table-fixed border-collapse text-left" aria-label={t("documents.trash.title")}>
          <colgroup>
            <col />
            <col className="hidden w-[200px] @min-[54rem]/trash:table-column" />
            <col className="hidden w-[120px] @min-[40rem]/trash:table-column" />
            <col className="hidden w-[150px] @min-[40rem]/trash:table-column" />
            <col className="w-[120px] @min-[40rem]/trash:w-[160px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">{t("documents.trash.columns.name")}</th>
              <th scope="col" className="hidden px-3 py-2 font-medium @min-[54rem]/trash:table-cell">{t("documents.trash.columns.deleted_by")}</th>
              <th scope="col" className="hidden px-3 py-2 font-medium @min-[40rem]/trash:table-cell">{t("documents.trash.columns.deleted_at")}</th>
              <th scope="col" className="hidden px-3 py-2 font-medium @min-[40rem]/trash:table-cell">{t("documents.trash.columns.purge_in")}</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">{t("documents.trash.columns.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => {
              const folder = isFolderRow(documentRow(doc));
              const title = doc.title || t("documents.detail.untitled");
              const deletedAt = formatShortWhen(doc.archived_at, i18n.language);
              const left = purgeDaysLeft(doc.purge_after);
              const purgeText =
                left === null
                  ? null
                  : left < 0
                    ? t("documents.trash.purge_expired")
                    : left === 0
                      ? t("documents.trash.purge_today")
                      : t("documents.trash.purge_days", { count: left });
              const purgeUrgent = left !== null && left <= URGENT_DAYS;
              // RESTORE-01: restore/purge belong to people who manage the row
              // (a workspace admin arrives with admin_scope, no my_level).
              const manage = canManageTrashed(doc);
              const origin = subtitle(doc);
              const deleterMember = doc.archived_by && membersReady ? members.get(doc.archived_by) : undefined;
              const deleter = doc.archived_by
                ? membersReady
                  ? (deleterMember?.display_name ?? t("documents.trash.deleted_by_unknown"))
                  : null
                : null;
              const nameCell = (
                <>
                  <DocumentTypeIcon format={folder ? "folder" : rowFormat(documentRow(doc))} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    {/* TV-12: the truncated name still reads in full on hover. */}
                    <span title={title} className="block truncate text-body font-medium text-foreground">{title}</span>
                    {origin ? <span className="block truncate text-caption text-muted-foreground">{origin}</span> : null}
                    {/* Narrow widths carry the meta the columns have not joined
                        yet (RESTORE-01): deleted-at + countdown below 40rem,
                        wrapping rather than truncating; deleted-by below 54rem. */}
                    {deletedAt || purgeText ? (
                      <span data-trash-meta="" className="block text-caption text-muted-foreground @min-[40rem]/trash:hidden">
                        {[deletedAt, purgeText].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {deleter ? (
                      <span data-trash-meta="" className="block truncate text-caption text-muted-foreground @min-[54rem]/trash:hidden">{deleter}</span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <tr key={doc.id} data-trash-row={doc.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-3">
                    {onOpen && manage && !folder ? (
                      <button type="button" onClick={() => onOpen(doc)} className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">
                        {nameCell}
                      </button>
                    ) : (
                      <div className="flex w-full min-w-0 items-center gap-3 pointer-coarse:min-h-11">{nameCell}</div>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 @min-[54rem]/trash:table-cell">
                    {deleter ? (
                      <span className="flex items-center gap-2 text-body text-foreground">
                        <CommentActorAvatar name={deleter} avatarUrl={typeof deleterMember?.avatar_url === "string" ? deleterMember.avatar_url : undefined} size="xs" />
                        <span className="min-w-0 truncate">{deleter}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-caption tabular-nums text-muted-foreground @min-[40rem]/trash:table-cell">{deletedAt || "—"}</td>
                  <td className={cn("hidden px-3 py-3 text-caption tabular-nums @min-[40rem]/trash:table-cell", purgeUrgent ? "text-destructive" : "text-muted-foreground")}>
                    {purgeText ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {manage ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-7 px-0 @min-[40rem]/trash:w-auto @min-[40rem]/trash:px-2.5"
                          aria-label={t("documents.trash.restore_item", { title })}
                          disabled={actions.isRestoring(doc.id)}
                          aria-busy={actions.isRestoring(doc.id) || undefined}
                          onClick={() => actions.onRestore(doc)}
                        >
                          <ArchiveRestore aria-hidden />
                          <span className="hidden @min-[40rem]/trash:inline">{t("documents.trash.restore")}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive pointer-coarse:size-11"
                          aria-label={t("documents.trash.purge_item", { title })}
                          onClick={() => actions.onPurge(doc)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end">
                        <span className="text-right text-caption text-muted-foreground">{t("documents.trash.read_only")}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rounded-lg bg-muted px-3 py-2.5 text-caption text-muted-foreground">{t("documents.trash.note")}</p>
    </div>
  );
}

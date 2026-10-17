"use client";

import { ArchiveRestore, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types/workspace";
import { canManageTrashed } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { DocumentTypeIcon } from "./document-type-icon";
import { formatWhen } from "./document-format";
import { libraryCell, type LibraryLadder } from "./library-columns";
import { isFolderRow, rowFormat, rowTitle, rowTypeKey, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

/** Calendar days until the purge deadline, floored at local midnight on each
 *  side so "today" and "expired" mean the reader's day, not a 24-hour span. */
function purgeDaysLeft(purgeAfter: string | null | undefined, now: Date = new Date()): number | null {
  if (!purgeAfter) return null;
  const then = new Date(purgeAfter);
  if (Number.isNaN(then.getTime())) return null;
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((dayStart(then) - dayStart(now)) / 86_400_000);
}

/** The commands a manage row offers (RESTORE-01). The page owns the
 *  mutations and their toasts; the row only names the item asked for. */
export interface TrashRowActions {
  onRestore: (doc: DocumentSummaryRow) => void;
  onPurge: (doc: DocumentSummaryRow) => void;
  isRestoring: (documentId: string) => boolean;
}

/**
 * One row of the Thùng rác table (Trash.dc, RESTORE-01): the name cell keeps
 * its folder/type context line, Xóa bởi reads the workspace members list (a
 * former member falls back to a generic label), Xóa vĩnh viễn sau counts the
 * purge deadline down in days, and the actions column is either the manage
 * pair — Khôi phục, Xóa vĩnh viễn — or the read-only label an edit-only
 * holder gets (T-3, `canManageTrashed`). Only a manage row's name opens the
 * document; a trashed folder never browses, and an edit row opens nothing.
 */
export function TrashRowView({
  row,
  members,
  membersReady,
  parentTitle,
  ladder,
  trash,
  onOpen,
}: {
  row: LibraryRow;
  /** The workspace member list by user id, for the Xóa bởi cell. */
  members: ReadonlyMap<string, Member>;
  /** True once the members query has answered; before that a name the list does not hold is unknown, not "former". */
  membersReady: boolean;
  /** The trashed parent folder's title when the parent is itself a listed trash row; null otherwise. */
  parentTitle: string | null;
  ladder: LibraryLadder;
  trash: TrashRowActions;
  onOpen: (documentId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (row.type !== "document") return null;
  const doc = row.doc;
  const manage = canManageTrashed(doc);
  const folder = isFolderRow(row);
  const title = rowTitle(row) || t("documents.detail.untitled");
  const deletedAt = formatWhen(doc.archived_at, i18n.language);
  const daysLeft = purgeDaysLeft(doc.purge_after);
  const purgeText =
    daysLeft === null
      ? null
      : daysLeft < 0
        ? t("documents.trash.purge_expired")
        : daysLeft === 0
          ? t("documents.trash.purge_today")
          : t("documents.trash.purge_days", { count: daysLeft });
  // The last week of the retention window runs in the destructive tone, as
  // the board paints its "4 ngày" / "2 ngày" rows.
  const purgeUrgent = daysLeft !== null && daysLeft <= 7;

  const deleterMember = doc.archived_by && membersReady ? members.get(doc.archived_by) : undefined;
  const deleter = doc.archived_by
    ? membersReady
      ? (deleterMember?.display_name ?? t("documents.trash.deleted_by_unknown"))
      : null
    : null;
  const deleterAvatar = typeof deleterMember?.avatar_url === "string" ? deleterMember.avatar_url : undefined;

  // The context line: the folder the item sat in when it was deleted (only
  // knowable when the parent is itself a listed trash row), else its type.
  const context = parentTitle ? t("documents.trash.in_trashed_folder", { folder: parentTitle }) : t(rowTypeKey(row));

  const nameCell = (
    <>
      <DocumentTypeIcon format={folder ? "folder" : rowFormat(row)} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{title}</span>
        <span className="block truncate text-caption text-muted-foreground">{context}</span>
        {/* Narrow widths carry the meta the columns have not joined yet:
            deleted-at + countdown until 46rem, deleted-by until 56rem. */}
        {deletedAt || purgeText ? (
          <span className={cn("block truncate text-caption text-muted-foreground", ladder.metaHides)}>
            {[deletedAt, purgeText].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {deleter ? (
          <span className={cn("block truncate text-caption text-muted-foreground", ladder.accessLineHides)}>{deleter}</span>
        ) : null}
      </span>
    </>
  );

  return (
    <tr data-library-row={row.id} className="border-b border-border transition-colors last:border-b-0 hover:bg-accent/40">
      <td className="px-3 py-2">
        {manage && !folder ? (
          <button
            type="button"
            onClick={() => onOpen(doc.id)}
            className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11"
          >
            {nameCell}
          </button>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">{nameCell}</div>
        )}
      </td>
      <td className={cn("px-3 py-2", libraryCell(ladder, "deleted_by"))}>
        {deleter ? (
          <span className="flex items-center gap-2 text-body text-foreground">
            <CommentActorAvatar name={deleter} avatarUrl={deleterAvatar} size="xs" />
            <span className="truncate">{deleter}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn("px-3 py-2 text-caption text-muted-foreground", libraryCell(ladder, "deleted_at"))}>
        {deletedAt || "—"}
      </td>
      <td className={cn("px-3 py-2 text-caption", libraryCell(ladder, "purge_in"))}>
        {purgeText ? (
          <span className={purgeUrgent ? "text-destructive" : "text-foreground"}>{purgeText}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        {manage ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-coarse:min-h-11"
              aria-label={t("documents.trash.restore_item", { title })}
              disabled={trash.isRestoring(doc.id)}
              aria-busy={trash.isRestoring(doc.id) || undefined}
              onClick={() => trash.onRestore(doc)}
            >
              <ArchiveRestore aria-hidden className="size-3.5" />
              {t("documents.trash.restore")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive pointer-coarse:size-11"
              aria-label={t("documents.trash.purge_item", { title })}
              onClick={() => trash.onPurge(doc)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <span className="truncate text-caption text-muted-foreground">{t("documents.trash.read_only")}</span>
          </div>
        )}
      </td>
    </tr>
  );
}

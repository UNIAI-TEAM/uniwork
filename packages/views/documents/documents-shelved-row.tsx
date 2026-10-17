"use client";

import { ArchiveRestore, Download, Ellipsis, ExternalLink, Star, StarOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDocumentDownload } from "@uniwork/core/documents/hooks";
import type { Member } from "@uniwork/core/types/workspace";
import { canManageTrashed } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { CommentActorAvatar } from "../comments/comment-actor-avatar";
import { DocumentTypeIcon } from "./document-type-icon";
import { formatShortWhen } from "./document-format";
import { libraryCell, type LibraryLadder } from "./library-columns";
import { rowAccessLabelKey, rowFormat, rowTitle, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

/** The commands a shelved row offers (ARCHIVE-01 U-3/U-4). The page owns the
 *  mutations and their toasts; the row only names the item asked for. */
export interface ShelvedRowActions {
  /** Bỏ lưu trữ: brings the item (and its same-batch shelved descendants the caller manages) back live. */
  onUnshelve: (doc: DocumentSummaryRow) => void;
  /** Chuyển vào thùng rác: the trash archive command, manage only. */
  onTrash: (doc: DocumentSummaryRow) => void;
  /** True while that item's unshelve request runs: its button is disabled, a second click sends nothing. */
  isUnshelving: (documentId: string) => boolean;
  /** Optional star toggle, same handler the live rows use. */
  onToggleStar?: (documentId: string, starred: boolean) => void;
  isStarred?: (documentId: string) => boolean;
}

interface ShelvedMenuAction {
  id: string;
  label: string;
  icon: typeof ArchiveRestore;
  run: () => void;
}

/**
 * One row of the Lưu trữ table (Archive.dc, ARCHIVE-01 U-2/U-3): the name cell
 * keeps its parent-folder path line, Truy cập is the viewer's level, Lưu trữ
 * bởi reads the workspace members list (a former member falls back to a
 * generic label, a null `shelved_by` is the system), Lưu trữ lúc is the short
 * stamp the trash's "Xóa lúc" uses, and the actions column is Bỏ lưu trữ for
 * rows the viewer manages (`canManageTrashed` — my_level manage or
 * admin_scope) plus the keep-list menu: open, download, star, unarchive, trash. Every
 * row opens its document read-only; shelved folders never browse.
 */
export function ShelvedRowView({
  row,
  members,
  membersReady,
  ladder,
  shelved,
  onOpen,
}: {
  row: LibraryRow;
  /** The workspace member list by user id, for the Lưu trữ bởi cell. */
  members: ReadonlyMap<string, Member>;
  /** True once the members query has answered; before that a name the list does not hold is unknown, not "former". */
  membersReady: boolean;
  ladder: LibraryLadder;
  shelved: ShelvedRowActions;
  onOpen: (documentId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const wsId = useOptionalWorkspace()?.workspace.id ?? "";
  const downloadFile = useDocumentDownload(wsId, row.type === "document" ? row.doc.id : "");
  if (row.type !== "document") return null;
  const doc = row.doc;
  const folder = doc.kind === "folder";
  const title = rowTitle(row) || t("documents.detail.untitled");
  const shelvedAt = formatShortWhen(doc.shelved_at, i18n.language);
  const manage = canManageTrashed(doc);
  const starred = Boolean(shelved.isStarred?.(doc.id));

  // The secondary line: the folder path the item sat under (the server sends
  // `path` on list rows), or the root label when the row has no ancestors.
  const pathText = doc.path && doc.path.length > 0 ? doc.path.map((crumb) => crumb.title).join(" › ") : null;

  const shelverMember = doc.shelved_by && membersReady ? members.get(doc.shelved_by) : undefined;
  const shelver = doc.shelved_by
    ? membersReady
      ? (shelverMember?.display_name ?? t("documents.shelved_list.shelved_by_former"))
      : null
    : t("documents.shelved_list.shelved_by_system");
  const shelverAvatar = typeof shelverMember?.avatar_url === "string" ? shelverMember.avatar_url : undefined;

  const accessKey = rowAccessLabelKey(row);

  // Reading is allowed on a shelved item, so any reader may take the bytes of a file out (U-4, the file view's rule).
  const download = () => {
    if (downloadFile.isPending) return;
    void downloadFile.mutateAsync({}).then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = doc.title;
        anchor.rel = "noopener";
        window.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      () => toast.error(t("documents.file.download_failed")),
    );
  };

  // U-4 keep-list on a shelved row: open, download (file rows), star, Bỏ lưu
  // trữ and Chuyển vào thùng rác (manage). Rename/move/create-child/share-new
  // never appear; export PDF and copy are not row commands on live rows either.
  const menuActions: ShelvedMenuAction[] = [
    { id: "open", label: t("documents.home.row.open_web"), icon: ExternalLink, run: () => onOpen(doc.id) },
  ];
  if (doc.kind === "file" && doc.current_version > 0) {
    menuActions.push({ id: "download", label: t("documents.home.row.download"), icon: Download, run: download });
  }
  if (shelved.onToggleStar) {
    menuActions.push({
      id: "star",
      label: starred ? t("documents.home.row.unstar") : t("documents.home.row.star"),
      icon: starred ? StarOff : Star,
      run: () => shelved.onToggleStar?.(doc.id, starred),
    });
  }
  if (manage) {
    menuActions.push(
      { id: "unshelve", label: t("documents.shelved_list.unshelve"), icon: ArchiveRestore, run: () => shelved.onUnshelve(doc) },
      { id: "trash", label: t("documents.actions.archive"), icon: Trash2, run: () => shelved.onTrash(doc) },
    );
  }

  const nameCell = (
    <>
      <DocumentTypeIcon format={folder ? "folder" : rowFormat(row)} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{title}</span>
        <span className="block truncate text-caption text-muted-foreground">
          {pathText ?? t("documents.home.search.path_root")}
        </span>
        {/* Narrow widths carry the meta the columns have not joined yet. */}
        {shelvedAt ? <span className={cn("block text-caption text-muted-foreground", ladder.metaHides)}>{shelvedAt}</span> : null}
        {shelver ? (
          <span className={cn("block truncate text-caption text-muted-foreground", ladder.accessLineHides)}>{shelver}</span>
        ) : null}
      </span>
    </>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.home.row.menu", { title })} />
        }
      >
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {menuActions.map((action) => (
          <DropdownMenuItem key={action.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={action.run}>
            <action.icon aria-hidden className="size-3.5" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <tr data-library-row={row.id} className="group/row border-b border-border transition-colors last:border-b-0 hover:bg-accent/40" />
        }
      >
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => onOpen(doc.id)}
            className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11"
          >
            {nameCell}
          </button>
        </td>
        <td className={cn("px-3 py-2 text-caption text-muted-foreground", libraryCell(ladder, "access"))}>
          {accessKey ? t(accessKey) : "—"}
        </td>
        <td className={cn("px-3 py-2", libraryCell(ladder, "shelved_by"))}>
          {shelver ? (
            <span className="flex items-center gap-2 text-body text-foreground">
              <CommentActorAvatar name={shelver} avatarUrl={shelverAvatar} size="xs" />
              <span className="min-w-0 break-words">{shelver}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className={cn("px-3 py-2 text-caption text-muted-foreground", libraryCell(ladder, "shelved_at"))}>
          {shelvedAt || "—"}
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-end gap-1.5">
            {manage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="pointer-coarse:min-h-11 @max-[46rem]/library:w-8 @max-[46rem]/library:px-0 pointer-coarse:@max-[46rem]/library:w-11"
                aria-label={t("documents.shelved_list.unshelve_item", { title })}
                disabled={shelved.isUnshelving(doc.id)}
                aria-busy={shelved.isUnshelving(doc.id) || undefined}
                onClick={() => shelved.onUnshelve(doc)}
              >
                <ArchiveRestore aria-hidden className="size-3.5" />
                <span className="@max-[46rem]/library:hidden">{t("documents.shelved_list.unshelve")}</span>
              </Button>
            ) : null}
            {menuActions.length > 0 ? menu : null}
          </div>
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {menuActions.map((action) => (
          <ContextMenuItem key={action.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={action.run}>
            <action.icon aria-hidden className="size-3.5" />
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

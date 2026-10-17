"use client";

import { useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, Download, Ellipsis, ExternalLink, FolderInput, FolderOpen, FolderPlus, Lock, MonitorUp, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMyFolder, isShelved } from "@uniwork/core/types/document";
import { Badge } from "@uniwork/ui/components/ui/badge";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction, type DesktopOpenOutcome } from "../office/desktop-open-action";
import { DocumentTypeIcon } from "./document-type-icon";
import { libraryCell, type LibraryLadder } from "./library-columns";
import { canArchiveRow, canMoveRow, rowAppOperation, rowLevel } from "./row-level";
import { sourceLinkIcon, sourceLinkLabelKey, sourceLinkNamedLabelKey, sourceOpenAction, sourceParentLinked } from "./source-links";
import {
  formatBytes,
  isFolderRow,
  rowFormat,
  rowAccessLabelKey,
  rowOrigin,
  rowSizeBytes,
  rowTitle,
  rowUpdatedAt,
  rowVisibilityLabelKey,
  type DocumentSummaryRow,
  type LibraryRow,
} from "./library-rows";

/** The formats UniWork Office opens; a page, folder or other file has no app action. */
const APP_FORMATS = new Set(["docx", "xlsx", "pptx", "pdf", "md", "html"]);

/** How a library row reaches "Open in UniWork Office" (host wiring, per row). */
export type LibraryDesktopOpen = (doc: { id: string; organization_id: string; current_version: number }) => FrameDesktopOpenProps;

export interface LibraryRowHandlers {
  onOpen: (documentId: string) => void;
  onFolder: (folderId: string) => void;
  onGoToSource: (row: Extract<LibraryRow, { type: "source" }>) => void;
  /** Image sources only: fetches the bytes and opens them view-only. */
  onPreviewSource?: (sourceId: string, name: string) => void;
  onDownloadSource: (sourceId: string) => void;
  onSaveSource: (row: Extract<LibraryRow, { type: "source" }>) => void;
  /** Absent outside an organization (no favorites there). */
  onToggleStar?: (documentId: string, starred: boolean) => void;
  isStarred: (documentId: string) => boolean;
  /**
   * Create subfolder, rename, move to another folder, and archive, for people
   * who may change the open folder; absent hides them. The server still decides per document.
   */
  onNewSubfolder?: (doc: DocumentSummaryRow) => void;
  onRename?: (doc: DocumentSummaryRow) => void;
  onMove?: (doc: DocumentSummaryRow) => void;
  onArchive?: (doc: DocumentSummaryRow) => void;
  /** Lưu trữ (ARCHIVE-01 U-4): manage-only, hidden on My Folder; the page
   *  wires it so a folder opens the confirm dialog and a document shelves at
   *  once with an undo toast. */
  onShelve?: (doc: DocumentSummaryRow) => void;
  /** The display name of a person id, or null when unknown. */
  personName: (userId: string, kind: string) => string | null;
  desktopOpen?: LibraryDesktopOpen;
}

interface RowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale || undefined, { dateStyle: "short" }).format(date);
}

/** The first letter of a name, for the editor's initial. */
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function LibraryRowView({
  row,
  handlers,
  ladder,
  typeCell,
}: {
  row: LibraryRow;
  handlers: LibraryRowHandlers;
  /** The column ladder the list's header and colgroup were built from (library-columns.ts). */
  ladder: LibraryLadder;
  typeCell?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const appRequest = useRef<(() => Promise<DesktopOpenOutcome>) | null>(null);
  const title = rowTitle(row) || t("documents.detail.untitled");
  const format = rowFormat(row);
  const origin = rowOrigin(row);
  const folder = isFolderRow(row);
  const doc = row.type === "document" ? row.doc : null;
  const source = row.type === "source" ? row.source : null;
  const sourceLinked = source ? sourceParentLinked(source.parent) : false;

  const editor = doc
    ? doc.updated_by
      ? handlers.personName(doc.updated_by, doc.updated_by_kind)
      : null
    : source?.owner?.name || null;
  const size = formatBytes(rowSizeBytes(row), i18n.language);
  const updated = formatDate(rowUpdatedAt(row), i18n.language);

  // "Open in app" sits on every document file row (user decision 6); a viewer
  // gets a read-only session. Source files have no launch route yet
  // (api-contract §4): they offer the download instead.
  // A starred row whose document is not in any loaded list has no version or
  // organisation yet: no app action until the document is known.
  const desktop =
    doc && doc.kind === "file" && doc.current_version > 0 && APP_FORMATS.has(format) && handlers.desktopOpen && !doc.archived_at
      ? handlers.desktopOpen({ id: doc.id, organization_id: doc.organization_id, current_version: doc.current_version })
      : null;
  const level = rowLevel(doc);
  const accessKey = rowAccessLabelKey(row);
  const visibilityKey = rowVisibilityLabelKey(row);
  const restricted = doc?.visibility === "restricted";
  const starred = Boolean(doc && handlers.isStarred(doc.id));
  const metaLine = [editor, updated, size].filter(Boolean).join(" · ");

  // A row whose archive stamp survived into a live list is inert: the trash
  // view (its own rows) owns restore/purge, so here nothing runs on it.
  const trashed = Boolean(doc?.archived_at);

  const primary = () => {
    if (doc && folder) handlers.onFolder(doc.id);
    else if (doc) handlers.onOpen(doc.id);
    else if (row.type === "source") {
      // U-SRC1: the primary click opens the file view-only where the row can
      // (images today), else downloads it; "Xem nơi đính kèm" is a secondary.
      const open = sourceOpenAction(row.source);
      if (open === "image" && handlers.onPreviewSource) handlers.onPreviewSource(row.source.id, row.source.name);
      else handlers.onDownloadSource(row.source.id);
    }
  };

  const actions: RowAction[] = [];
  if (doc && trashed) {
    // No live-list command applies to a trashed row; the badge says why.
  } else if (doc && folder) {
    actions.push({ id: "open-folder", label: t("documents.home.row.open_folder"), icon: FolderOpen, run: primary });
  } else if (doc) {
    actions.push({ id: "open", label: t("documents.home.row.open_web"), icon: ExternalLink, run: primary });
    if (desktop) {
      actions.push({ id: "open-app", label: t("documents.home.row.open_app"), icon: MonitorUp, run: () => void appRequest.current?.() });
    }
    if (handlers.onToggleStar) {
      actions.push({
        id: "star",
        label: starred ? t("documents.home.row.unstar") : t("documents.home.row.star"),
        icon: starred ? StarOff : Star,
        run: () => handlers.onToggleStar?.(doc.id, starred),
      });
    }
  }
  // Each command follows the level of THIS row (create subfolder / rename /
  // move: edit, archive: manage); a trashed row offers none of them.
  if (doc && !trashed) {
    if (folder && handlers.onNewSubfolder && canMoveRow(level)) {
      actions.push({ id: "new-subfolder", label: t("documents.home.row.new_subfolder"), icon: FolderPlus, run: () => handlers.onNewSubfolder?.(doc) });
    }
    if (handlers.onRename && canMoveRow(level)) {
      actions.push({ id: "rename", label: t("documents.home.row.rename"), icon: Pencil, run: () => handlers.onRename?.(doc) });
    }
    if (handlers.onMove && canMoveRow(level)) {
      actions.push({ id: "move", label: t("documents.tree.menu.move_to"), icon: FolderInput, run: () => handlers.onMove?.(doc) });
    }
    if (handlers.onShelve && canArchiveRow(level) && !isMyFolder(doc) && !isShelved(doc)) {
      // U-4: shelve sits beside the trash command, manage-only and never on
      // the My Folder root; the page decides document-now vs folder-dialog.
      actions.push({ id: "shelve", label: t("documents.shelved_list.shelve"), icon: Archive, run: () => handlers.onShelve?.(doc) });
    }
    if (handlers.onArchive && canArchiveRow(level)) {
      // A folder's dialog says Delete (FD-D6), so its row says it too, with the tree menu's words and icon.
      actions.push(
        folder
          ? { id: "archive", label: t("documents.tree.menu.delete"), icon: Trash2, run: () => handlers.onArchive?.(doc) }
          : { id: "archive", label: t("documents.home.row.archive"), icon: Archive, run: () => handlers.onArchive?.(doc) },
      );
    }
  }
  if (row.type === "source") {
    // A parent kind with no route offers neither the menu item nor the button.
    if (sourceLinked) {
      actions.push({ id: "go-to-source", label: t(sourceLinkLabelKey(row.source.parent)), icon: sourceLinkIcon(row.source.parent), run: () => handlers.onGoToSource(row) });
    }
    actions.push({ id: "download", label: t("documents.home.row.download"), icon: Download, run: () => handlers.onDownloadSource(row.source.id) });
    // Only a file the server marks as copyable offers the save.
    if (row.source.can_save) {
      actions.push({ id: "save", label: t("documents.home.row.save_to_folder"), icon: FolderInput, run: () => handlers.onSaveSource(row) });
    }
  }
  // The app command joins the actions cell only when its column is wide
  // enough (the ladder's quick rung); the source's own link button below
  // is icon-sized and rendered at every width.
  const quick = desktop ? (
    <DesktopOpenAction
      {...desktop}
      documentId={doc!.id}
      placement="row"
      operation={rowAppOperation(level)}
      requestRef={appRequest}
    />
  ) : null;

  // S2V-2/3: "Xem nơi đính kèm" / "Mở Email" as an icon button, so it fits the
  // actions column at every width instead of covering Size. The words live on
  // the tooltip and inside the accessible name.
  const SourceLinkGlyph = source ? sourceLinkIcon(source.parent) : null;
  const sourceLink = source && sourceLinked && SourceLinkGlyph ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t(sourceLinkNamedLabelKey(source.parent), { title })}
            onClick={() => row.type === "source" && handlers.onGoToSource(row)}
          />
        }
      >
        <SourceLinkGlyph aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{t(sourceLinkLabelKey(source.parent))}</TooltipContent>
    </Tooltip>
  ) : null;

  const nameCell = (
    <>
      <DocumentTypeIcon format={folder ? "folder" : format} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body text-foreground">{title}</span>
          {starred ? (
            <Star role="img" aria-label={t("documents.home.row.starred")} className="size-3.5 shrink-0 fill-current text-brand" />
          ) : null}
          {trashed ? (
            <Badge variant="secondary" className="shrink-0">{t("documents.library.archived_badge")}</Badge>
          ) : null}
        </span>
        {/* The editor · date · size part rides on this line until its columns join the table; the level and the restricted mark until My access / Visibility do (library-columns.ts). Only the meta part truncates: the mark keeps its width inside the Name cell. */}
        {metaLine || accessKey || restricted ? (
          <span data-library-access-line className={cn("flex min-w-0 items-center gap-1.5 overflow-hidden text-caption text-muted-foreground", ladder.accessLineHides)}>
            {metaLine ? <span className={cn("min-w-0 truncate", ladder.metaHides)}>{metaLine}</span> : null}
            {metaLine && (accessKey || restricted) ? (
              <span aria-hidden className={cn("shrink-0", ladder.metaHides)}>·</span>
            ) : null}
            {accessKey ? <span className="shrink-0">{t(accessKey)}</span> : null}
            {accessKey && restricted ? <span aria-hidden className="shrink-0">·</span> : null}
            {restricted && visibilityKey ? (
              <span className="flex shrink-0 items-center gap-1">
                <Lock aria-hidden className="size-3 shrink-0" />
                {t(visibilityKey)}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<tr />}
        data-library-row={row.id}
        className="group/row border-b border-border transition-colors last:border-b-0 hover:bg-accent/40"
      >
        <td className="px-3 py-2">
          {trashed ? (
            <div className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">{nameCell}</div>
          ) : (
            <button type="button" onClick={primary} className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">
              {nameCell}
            </button>
          )}
        </td>
        {typeCell !== undefined ? (
          <td className={cn("truncate px-3 py-2 text-caption text-muted-foreground", libraryCell(ladder, "type"))}>{typeCell}</td>
        ) : null}
        <td className={cn("px-3 py-2", libraryCell(ladder, "source"))}>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", origin === "created" || origin === "documents" ? "bg-primary" : "bg-muted-foreground")} />
            <span className="truncate">{t(`documents.home.origin.${origin}`)}</span>
          </span>
        </td>
        <td className={cn("px-3 py-2", libraryCell(ladder, "editor"))}>
          {editor ? (
            <span className="flex items-center gap-2 text-body text-foreground">
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground">
                {initial(editor)}
              </span>
              <span className="truncate">{editor}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className={cn("px-3 py-2 font-mono text-caption tabular-nums text-muted-foreground", libraryCell(ladder, "updated"))}>{updated || "—"}</td>
        <td className={cn("px-3 py-2 font-mono text-caption tabular-nums text-muted-foreground", libraryCell(ladder, "size"))}>{size || "—"}</td>
        {/* My access / Visibility exist only where the ladder has room for them; until then the secondary line carries them. */}
        {libraryCell(ladder, "access") ? (
          <td className={cn("px-3 py-2 text-caption text-foreground", libraryCell(ladder, "access"))}>
            {accessKey ? <span className="block truncate">{t(accessKey)}</span> : <span className="text-muted-foreground">—</span>}
          </td>
        ) : null}
        {libraryCell(ladder, "visibility") ? (
          <td className={cn("px-3 py-2 text-caption", libraryCell(ladder, "visibility"))}>
            {visibilityKey ? (
              <span className="flex items-center gap-1.5 text-foreground">
                {restricted ? <Lock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                <span className="truncate">{t(visibilityKey)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
        ) : null}
        <td className="px-2 py-2">
          <div className="flex items-center justify-end gap-1">
            {quick ? (
              // Until the actions column widens (first ladder rung) the app command lives in the ⋯ menu so the name keeps the row.
              <div className={cn("opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100", ladder.quick)}>
                {quick}
              </div>
            ) : null}
            {sourceLink ? (
              // Every width, not the quick rung: hover/focus reveals it on a
              // fine pointer, a coarse pointer shows it always (no hover there).
              <div className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                {sourceLink}
              </div>
            ) : null}
            {actions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.home.row.menu", { title })} />
                  }
                >
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {actions.map((action) => (
                    <DropdownMenuItem key={action.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={action.run}>
                      <action.icon aria-hidden className="size-3.5" />
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {actions.map((action) => (
          <ContextMenuItem key={action.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={action.run}>
            <action.icon aria-hidden className="size-3.5" />
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

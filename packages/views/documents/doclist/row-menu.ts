import { canManageTrashed, isMyFolder, isShelved, isTemplate } from "@uniwork/core/types/document";
import { isFolderRow, type DocumentSummaryRow, type LibraryRow } from "../library-rows";
import { canArchiveRow, canMoveRow, canShareRow, rowLevel } from "../row-level";
import { sourceLinkLabelKey, sourceParentLinked } from "../source-links";
import type { DocListScreen } from "./columns";

// The one row menu of every document list (workspace + folders, Recent,
// Starred, Shared with me, Shared by me, Lưu trữ, Thùng rác), as a pure
// function of the row, the screen, the viewer's level on it and the commands
// the host wired. The ⋯ dropdown and the right-click menu both draw the groups
// it returns, so the two cannot drift.
// Source: contract UNI-2045, "Quy tắc định dạng dùng chung" → Thao tác.

export type RowMenuItemId =
  | "open"
  | "open-folder"
  | "open-app"
  | "share"
  | "share-contents"
  | "copy-link"
  | "star"
  | "new-subfolder"
  | "rename"
  | "move"
  | "duplicate"
  | "download"
  | "shelve"
  | "trash"
  | "go-to-source"
  | "save"
  | "unshelve"
  | "mark-template"
  | "unmark-template"
  | "restore"
  | "view-details"
  | "purge";

export interface RowMenuItem {
  id: RowMenuItemId;
  /** An i18n key; the renderer resolves it and picks the icon from the id. */
  labelKey: string;
  /** Red, and always the last item of the last group. */
  destructive?: true;
  run: () => void;
}

/** A group is a run of related items; the renderer puts a separator between groups. */
export type RowMenuGroup = RowMenuItem[];

type SourceRow = Extract<LibraryRow, { type: "source" }>;

/** The commands a host may wire; an absent one hides its item. */
export interface RowMenuHandlers {
  /** Absent outside an organization (no favorites there). */
  onToggleStar?: (documentId: string, starred: boolean) => void;
  onShare?: (doc: DocumentSummaryRow) => void;
  /** "Chia sẻ": a folder row's bulk access dialog; absent hides the item. */
  onShareContents?: (doc: DocumentSummaryRow) => void;
  onNewSubfolder?: (doc: DocumentSummaryRow) => void;
  /** UNI-2055 W3: may the viewer create inside this folder (a workspace folder takes every member); absent = the edit level. */
  canCreateInside?: (doc: DocumentSummaryRow) => boolean;
  onRename?: (doc: DocumentSummaryRow) => void;
  onMove?: (doc: DocumentSummaryRow) => void;
  onShelve?: (doc: DocumentSummaryRow) => void;
  /** Chuyển vào thùng rác: the host asks for confirmation before it archives. */
  onArchive?: (doc: DocumentSummaryRow) => void;
  onCopyLink?: (doc: DocumentSummaryRow) => void;
  onDuplicate?: (doc: DocumentSummaryRow) => void;
  onDownload?: (doc: DocumentSummaryRow) => void;
  onGoToSource?: (row: SourceRow) => void;
  onSaveSource?: (row: SourceRow) => void;
  onDownloadSource?: (sourceId: string) => void;
  /** Lưu trữ: Bỏ lưu trữ. */
  onUnshelve?: (doc: DocumentSummaryRow) => void;
  /** Mẫu văn bản: Đánh dấu là mẫu (a restricted file asks first) and Bỏ khỏi Mẫu. */
  onMarkTemplate?: (doc: DocumentSummaryRow) => void;
  onUnmarkTemplate?: (doc: DocumentSummaryRow) => void;
  /** Thùng rác: Khôi phục, Xem chi tiết (the document read-only) and Xóa vĩnh viễn (the host asks first). */
  onRestore?: (doc: DocumentSummaryRow) => void;
  onViewDetails?: (doc: DocumentSummaryRow) => void;
  onPurge?: (doc: DocumentSummaryRow) => void;
}

export interface RowMenuContext {
  handlers: RowMenuHandlers;
  /** The viewer starred this document. */
  starred: boolean;
  /** The row's primary click: open the document, or the folder. */
  open: () => void;
  /** Present when the host can open this row in UniWork Office. */
  openApp?: () => void;
  /** The list the row sits in; Lưu trữ and Thùng rác have their own menus. */
  screen?: DocListScreen;
}

/**
 * The menu of one row as ordered groups, empty groups removed:
 * `Mở` · `Mở bằng UniWork Office` │ `Chia sẻ` · `Sao chép link` │ `Gắn sao` ·
 * `Đổi tên` · `Di chuyển` · `Tạo bản sao` · `Tải xuống` │ `Lưu trữ` ·
 * `Chuyển vào thùng rác`. An item the viewer may not use is left out, not
 * disabled: the levels come from `rowLevel` (the row's `my_level`), so on
 * Shared with me Lưu trữ and the trash item need manage like everywhere else.
 * A folder keeps its own items in the same order; a source row (a file that
 * lives in another module) keeps the items it had.
 */
export function docRowMenu(row: LibraryRow, ctx: RowMenuContext): RowMenuGroup[] {
  const groups =
    row.type === "source"
      ? sourceGroups(row, ctx)
      : ctx.screen === "trash" || row.doc.archived_at
        ? trashGroups(row.doc, ctx)
        : ctx.screen === "shelved"
          ? shelvedGroups(row.doc, ctx)
          : documentGroups(row.doc, ctx);
  return groups.filter((group) => group.length > 0);
}

/** The trash item of a row: a folder's dialog says Delete (FD-D6), so its row says it too, with the tree menu's words. */
function trashItem(doc: DocumentSummaryRow, onArchive: (doc: DocumentSummaryRow) => void): RowMenuItem {
  const folder = isFolderRow({ type: "document", id: doc.id, doc });
  return {
    id: "trash",
    labelKey: folder ? "documents.tree.menu.delete" : "documents.home.row.archive",
    destructive: true,
    run: () => onArchive(doc),
  };
}

function unmarkItem(doc: DocumentSummaryRow, onUnmark: (doc: DocumentSummaryRow) => void): RowMenuItem {
  return { id: "unmark-template", labelKey: "documents.templates.unmark", run: () => onUnmark(doc) };
}

/**
 * Thùng rác: `Khôi phục` · `Xem chi tiết` │ `Xóa vĩnh viễn`. Everything needs
 * manage (`canManageTrashed`: my_level manage or admin_scope, RESTORE-01), so a
 * row the viewer only edits has no menu at all; a folder is never opened. A
 * trashed row on any other list gets these only where its host wired them,
 * which no live list does, so there it stays inert.
 */
function trashGroups(doc: DocumentSummaryRow, { handlers }: RowMenuContext): RowMenuGroup[] {
  if (!canManageTrashed(doc)) return [];
  const { onRestore, onViewDetails, onPurge } = handlers;
  const back: RowMenuItem[] = [];
  if (onRestore) back.push({ id: "restore", labelKey: "documents.trash.restore", run: () => onRestore(doc) });
  if (onViewDetails && doc.kind !== "folder") {
    back.push({ id: "view-details", labelKey: "documents.trash.view_details", run: () => onViewDetails(doc) });
  }
  const purge: RowMenuItem[] = onPurge
    ? [{ id: "purge", labelKey: "documents.trash.purge", destructive: true, run: () => onPurge(doc) }]
    : [];
  return [back, purge];
}

/**
 * Lưu trữ: `Mở` (read-only) · `Bỏ lưu trữ` · `Tải xuống` │ `Chuyển vào thùng
 * rác`. Any reader opens and downloads a file (reading a shelved item is
 * allowed, U-4); Bỏ lưu trữ and the trash need manage (`canManageTrashed`).
 * Nothing that writes (rename, move, share, star, copy) is offered.
 */
function shelvedGroups(doc: DocumentSummaryRow, { handlers, open }: RowMenuContext): RowMenuGroup[] {
  const manage = canManageTrashed(doc);
  const { onUnshelve, onDownload, onArchive, onUnmarkTemplate } = handlers;
  const reading: RowMenuItem[] = [{ id: "open", labelKey: "documents.tree.menu.open", run: open }];
  if (manage && onUnshelve) reading.push({ id: "unshelve", labelKey: "documents.shelved_list.unshelve", run: () => onUnshelve(doc) });
  if (doc.kind === "file" && doc.current_version > 0 && onDownload) {
    reading.push({ id: "download", labelKey: "documents.home.row.download", run: () => onDownload(doc) });
  }
  const removing: RowMenuItem[] = [];
  if (onUnmarkTemplate && isTemplate(doc)) removing.push(unmarkItem(doc, onUnmarkTemplate));
  if (manage && onArchive) removing.push(trashItem(doc, onArchive));
  return [reading, removing];
}

function sourceGroups(row: SourceRow, { handlers, open }: RowMenuContext): RowMenuGroup[] {
  const items: RowMenuItem[] = [];
  const { onGoToSource, onDownloadSource, onSaveSource } = handlers;
  const isPage = row.source.kind === "page";
  if (isPage && Boolean(row.source.document_id)) {
    items.push({ id: "open", labelKey: "documents.tree.menu.open", run: open });
  }
  // A parent kind with no route offers neither the menu item nor the button.
  if (onGoToSource && sourceParentLinked(row.source.parent)) {
    items.push({ id: "go-to-source", labelKey: sourceLinkLabelKey(row.source.parent), run: () => onGoToSource(row) });
  }
  if (!isPage && onDownloadSource) {
    items.push({ id: "download", labelKey: "documents.home.row.download", run: () => onDownloadSource(row.source.id) });
  }
  // Only a file the server marks as copyable offers the save.
  if (!isPage && onSaveSource && row.source.can_save) {
    items.push({ id: "save", labelKey: "documents.home.row.save_to_folder", run: () => onSaveSource(row) });
  }
  return [items];
}

function documentGroups(doc: DocumentSummaryRow, { handlers, starred, open, openApp }: RowMenuContext): RowMenuGroup[] {
  const level = rowLevel(doc);
  const folder = isFolderRow({ type: "document", id: doc.id, doc });
  const myFolder = isMyFolder(doc);
  const file = doc.kind === "file";
  // A starred row whose document no loaded list has answered has no organisation
  // yet: it offers nothing that needs the document itself.
  const known = doc.organization_id !== "";

  const opening: RowMenuItem[] = folder
    ? [{ id: "open-folder", labelKey: "documents.home.row.open_folder", run: open }]
    : [{ id: "open", labelKey: "documents.tree.menu.open", run: open }];
  if (!folder && openApp) opening.push({ id: "open-app", labelKey: "documents.home.row.open_app", run: openApp });

  const sharing: RowMenuItem[] = [];
  if (handlers.onShare && canShareRow(doc)) {
    const { onShare } = handlers;
    sharing.push({ id: "share", labelKey: "documents.actions.share", run: () => onShare(doc) });
  }
  // A folder has no share of its own; its menu offers the bulk command for the documents inside.
  if (folder && handlers.onShareContents && known) {
    const { onShareContents } = handlers;
    sharing.push({ id: "share-contents", labelKey: "documents.folderAccess.menu", run: () => onShareContents(doc) });
  }
  if (handlers.onCopyLink && !myFolder) {
    const { onCopyLink } = handlers;
    sharing.push({ id: "copy-link", labelKey: "documents.list.menu.copy_link", run: () => onCopyLink(doc) });
  }

  const managing: RowMenuItem[] = [];
  if (handlers.onToggleStar) {
    const { onToggleStar } = handlers;
    managing.push({
      id: "star",
      labelKey: starred ? "documents.home.row.unstar" : "documents.home.row.star",
      run: () => onToggleStar(doc.id, starred),
    });
  }
  if (folder && handlers.onNewSubfolder && (handlers.canCreateInside?.(doc) ?? canMoveRow(level))) {
    const { onNewSubfolder } = handlers;
    managing.push({ id: "new-subfolder", labelKey: "documents.home.row.new_subfolder", run: () => onNewSubfolder(doc) });
  }
  if (!myFolder && handlers.onRename && canMoveRow(level)) {
    const { onRename } = handlers;
    managing.push({ id: "rename", labelKey: "documents.home.row.rename", run: () => onRename(doc) });
  }
  if (!myFolder && handlers.onMove && canMoveRow(level)) {
    const { onMove } = handlers;
    managing.push({ id: "move", labelKey: "documents.home.row.move", run: () => onMove(doc) });
  }
  // Q7: only files copy. An owned (work-product) document copies through its owner.
  if (file && known && !doc.owner_kind && handlers.onDuplicate && canMoveRow(level)) {
    const { onDuplicate } = handlers;
    managing.push({ id: "duplicate", labelKey: "documents.actions.copy", run: () => onDuplicate(doc) });
  }
  if (file && known && handlers.onDownload) {
    const { onDownload } = handlers;
    managing.push({ id: "download", labelKey: "documents.home.row.download", run: () => onDownload(doc) });
  }

  const removing: RowMenuItem[] = [];
  // A restricted file widens to the workspace, which only a manager may do (the server refuses anyone else).
  if (
    handlers.onMarkTemplate &&
    file &&
    known &&
    !doc.owner_kind &&
    !isTemplate(doc) &&
    !isShelved(doc) &&
    !doc.archived_at &&
    (doc.visibility !== "restricted" || level === "manage")
  ) {
    const { onMarkTemplate } = handlers;
    managing.push({ id: "mark-template", labelKey: "documents.templates.mark", run: () => onMarkTemplate(doc) });
  }
  if (handlers.onShelve && canArchiveRow(level) && !myFolder && !isShelved(doc)) {
    const { onShelve } = handlers;
    removing.push({ id: "shelve", labelKey: "documents.shelved_list.shelve", run: () => onShelve(doc) });
  }
  // A marked file leaves Mẫu here; a screen that wires no archive (Mẫu văn bản) shows it where the trash item would sit.
  if (handlers.onUnmarkTemplate && isTemplate(doc)) removing.push(unmarkItem(doc, handlers.onUnmarkTemplate));
  if (handlers.onArchive && canArchiveRow(level) && !myFolder) removing.push(trashItem(doc, handlers.onArchive));

  return [opening, sharing, managing, removing];
}

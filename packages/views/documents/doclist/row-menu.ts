import { isMyFolder, isShelved } from "@uniwork/core/types/document";
import { isFolderRow, type DocumentSummaryRow, type LibraryRow } from "../library-rows";
import { canArchiveRow, canMoveRow, canShareRow, rowLevel } from "../row-level";
import { sourceLinkLabelKey, sourceParentLinked } from "../source-links";

// The one row menu of the live document lists (workspace + folders, Recent,
// Starred, Shared with me, Shared by me), as a pure function of the row, the
// viewer's level on it and the commands the host wired. The ⋯ dropdown and the
// right-click menu both draw the groups it returns, so the two cannot drift.
// Source: contract UNI-2045, "Quy tắc định dạng dùng chung" → Thao tác.
// Lưu trữ and Thùng rác rows have their own menus (W3 / W2) and do not use it.

export type RowMenuItemId =
  | "open"
  | "open-folder"
  | "open-app"
  | "share"
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
  | "save";

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
  onNewSubfolder?: (doc: DocumentSummaryRow) => void;
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
}

export interface RowMenuContext {
  handlers: RowMenuHandlers;
  /** The viewer starred this document. */
  starred: boolean;
  /** The row's primary click: open the document, or the folder. */
  open: () => void;
  /** Present when the host can open this row in UniWork Office. */
  openApp?: () => void;
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
  const groups = row.type === "source" ? sourceGroups(row, ctx) : documentGroups(row.doc, ctx);
  return groups.filter((group) => group.length > 0);
}

function sourceGroups(row: SourceRow, { handlers }: RowMenuContext): RowMenuGroup[] {
  const items: RowMenuItem[] = [];
  const { onGoToSource, onDownloadSource, onSaveSource } = handlers;
  // A parent kind with no route offers neither the menu item nor the button.
  if (onGoToSource && sourceParentLinked(row.source.parent)) {
    items.push({ id: "go-to-source", labelKey: sourceLinkLabelKey(row.source.parent), run: () => onGoToSource(row) });
  }
  if (onDownloadSource) {
    items.push({ id: "download", labelKey: "documents.home.row.download", run: () => onDownloadSource(row.source.id) });
  }
  // Only a file the server marks as copyable offers the save.
  if (onSaveSource && row.source.can_save) {
    items.push({ id: "save", labelKey: "documents.home.row.save_to_folder", run: () => onSaveSource(row) });
  }
  return [items];
}

function documentGroups(doc: DocumentSummaryRow, { handlers, starred, open, openApp }: RowMenuContext): RowMenuGroup[] {
  // A row whose archive stamp survived into a live list is inert: the trash
  // view owns restore and purge, so here nothing runs on it.
  if (doc.archived_at) return [];
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
  if (folder && handlers.onNewSubfolder && canMoveRow(level)) {
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
  if (handlers.onShelve && canArchiveRow(level) && !myFolder && !isShelved(doc)) {
    const { onShelve } = handlers;
    removing.push({ id: "shelve", labelKey: "documents.shelved_list.shelve", run: () => onShelve(doc) });
  }
  if (handlers.onArchive && canArchiveRow(level) && !myFolder) {
    const { onArchive } = handlers;
    // A folder's dialog says Delete (FD-D6), so its row says it too, with the tree menu's words.
    removing.push({
      id: "trash",
      labelKey: folder ? "documents.tree.menu.delete" : "documents.home.row.archive",
      destructive: true,
      run: () => onArchive(doc),
    });
  }

  return [opening, sharing, managing, removing];
}

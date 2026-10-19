"use client";

import { Archive, Folder, FolderInput, FolderOpen, FolderPlus, Ellipsis, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { isMyFolder, isShelved, type DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import type { LibraryRowHandlers } from "./documents-library-row";
import { isFolderRow, type DocumentSummaryRow, type LibraryRow } from "./library-rows";
import { canArchiveRow, canMoveRow, rowLevel } from "./row-level";
import { myFolderFirst } from "./document-tree-model";

/**
 * The folder card grid of the TRASH-A3 boards (Main.dc "Thư mục" section,
 * Folder.dc "Thư mục con"): one card per folder, counts read from the live
 * tree, the row commands in each card's menu when that folder's own row is
 * loaded.
 */

export interface DocumentsFoldersGridProps {
  /** The folders to show, in the order given: root folders at home, the open folder's children inside it. */
  folders: DocumentTreeNode[];
  /** Unfiltered document rows by id: a folder whose row is loaded gets its editor/updated meta and its commands. */
  docById: Map<string, DocumentSummaryRow>;
  /** The table row handlers; a handler absent for the viewer hides its menu item too. */
  handlers: Pick<
    LibraryRowHandlers,
    "onNewSubfolder" | "onRename" | "onMove" | "onShelve" | "onArchive" | "onToggleStar" | "isStarred" | "personName"
  >;
  onOpenFolder: (folderId: string) => void;
}

export function DocumentsFoldersGrid({ folders, docById, handlers, onOpenFolder }: DocumentsFoldersGridProps) {
  const { t, i18n } = useTranslation();
  if (folders.length === 0) return null;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {folders.map((node) => {
        const doc = docById.get(node.id);
        const myFolder = isMyFolder(node) || isMyFolder(doc);
        const cardTitle = (myFolder ? t("documents.home.my_folder.label") : node.title) || t("documents.detail.untitled");
        // document of a folder, so the card never counts documents. The editor
        // and the last update show only when the folder's own row is loaded.
        const sub = node.children.filter((child) => child.kind === "folder").length;
        const meta = [
          sub > 0 ? t("documents.home.folder_card.folders", { count: sub }) : "",
          doc?.updated_by ? handlers.personName(doc.updated_by, doc.updated_by_kind) : "",
          doc?.updated_at
            ? new Intl.DateTimeFormat(i18n.language || undefined, { dateStyle: "short" }).format(new Date(doc.updated_at))
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const starred = Boolean(doc && handlers.isStarred(doc.id));
        const menuItems = doc ? folderMenuItems(doc, handlers, t) : [];
        const canMenu = menuItems.length > 0 || Boolean(doc && handlers.onToggleStar);
        return (
          // The ⋯ trigger sits inside the card's right edge (a sibling over the
          // card, never nested in its button); the card reserves room for it.
          <li key={node.id} className="relative flex items-stretch">
            <button
              type="button"
              onClick={() => onOpenFolder(node.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-card py-3.5 pl-4 text-left transition-colors hover:bg-accent/40",
                canMenu ? "pr-12" : "pr-4",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-soft-foreground">
                <Folder aria-hidden className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-foreground">{cardTitle}</span>
                  {starred ? (
                    <Star role="img" aria-label={t("documents.home.row.starred")} className="size-3.5 shrink-0 fill-current text-brand" />
                  ) : null}
                </span>
                {meta ? <span className="truncate text-caption text-muted-foreground">{meta}</span> : null}
              </span>
            </button>
            {canMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("documents.home.row.menu", { title: cardTitle })}
                      title={t("documents.home.row.menu", { title: cardTitle })}
                      className="absolute top-1/2 right-2 -translate-y-1/2"
                    />
                  }
                >
                  <Ellipsis aria-hidden className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={() => onOpenFolder(node.id)}>
                    <FolderOpen aria-hidden className="size-4" />
                    {t("documents.home.row.open_folder")}
                  </DropdownMenuItem>
                  {doc && handlers.onToggleStar ? (
                    <DropdownMenuItem
                      className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                      onClick={() => handlers.onToggleStar?.(doc.id, starred)}
                    >
                      {starred ? <StarOff aria-hidden className="size-4" /> : <Star aria-hidden className="size-4" />}
                      {starred ? t("documents.home.row.unstar") : t("documents.home.row.star")}
                    </DropdownMenuItem>
                  ) : null}
                  {menuItems.length > 0 ? <DropdownMenuSeparator /> : null}
                  {menuItems.map((item) => (
                    <DropdownMenuItem key={item.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={item.run}>
                      <item.icon aria-hidden className="size-4" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface FolderMenuItem {
  id: string;
  label: string;
  icon: typeof Pencil;
  run: () => void;
}

/** The commands a folder already offers (the table row's vocabulary), gated by the same levels. */
export function folderMenuItems(
  doc: DocumentSummaryRow,
  handlers: Pick<LibraryRowHandlers, "onNewSubfolder" | "onRename" | "onMove" | "onShelve" | "onArchive">,
  t: (key: string) => string,
): FolderMenuItem[] {
  if (doc.archived_at) return [];
  const level = rowLevel(doc);
  const myFolder = isMyFolder(doc);
  const items: FolderMenuItem[] = [];
  if (handlers.onNewSubfolder && canMoveRow(level)) {
    items.push({ id: "new-subfolder", label: t("documents.home.row.new_subfolder"), icon: FolderPlus, run: () => handlers.onNewSubfolder?.(doc) });
  }
  if (!myFolder && handlers.onRename && canMoveRow(level)) {
    items.push({ id: "rename", label: t("documents.home.row.rename"), icon: Pencil, run: () => handlers.onRename?.(doc) });
  }
  if (!myFolder && handlers.onMove && canMoveRow(level)) {
    items.push({ id: "move", label: t("documents.tree.menu.move_to"), icon: FolderInput, run: () => handlers.onMove?.(doc) });
  }
  if (!myFolder && handlers.onShelve && canArchiveRow(level) && !isShelved(doc)) {
    // ARCHIVE-01 U-4: Lưu trữ sits beside the trash command, manage-only and
    // never on the My Folder root, as on the table row.
    items.push({ id: "shelve", label: t("documents.shelved_list.shelve"), icon: Archive, run: () => handlers.onShelve?.(doc) });
  }
  if (!myFolder && handlers.onArchive && canArchiveRow(level)) {
    // A folder's dialog says Delete, so the card says it too (FD-D6), with
    // the row's Trash2 glyph: Archive now belongs to Lưu trữ beside it.
    items.push({ id: "archive", label: t("documents.tree.menu.delete"), icon: Trash2, run: () => handlers.onArchive?.(doc) });
  }
  return items;
}

export interface DocumentsSectionsProps {
  /** `documents.home.sections` key for the folders block's heading ("folders" at the root, "subfolders" inside). */
  folderTitle: string;
  folders: DocumentTreeNode[];
  /** The count under the "Tài liệu" heading: the table's rows after the filters. */
  documentsCount: number;
  /** The documents table (DocumentsLibraryList with its own states). */
  children: React.ReactNode;
  /** TV-4: subfolder cards already fill the folder, so a folder with no
   * documents renders no "Tài liệu 0" heading and no empty-state copy. */
  hideDocuments?: boolean;
  grid: Omit<DocumentsFoldersGridProps, "folders">;
}

/** The board's two sections: folder cards, then the documents table, each titled with its count. */
export function DocumentsSections({ folderTitle, folders, documentsCount, children, hideDocuments = false, grid }: DocumentsSectionsProps) {
  const { t } = useTranslation();
  // Each section is named by its heading, count included: the page region is
  // already called "Tài liệu", and landmark names must stay unique.
  const foldersId = useId();
  const documentsId = useId();
  return (
    <>
      {folders.length > 0 ? (
        <section aria-labelledby={foldersId} className="flex flex-col gap-3">
          <h2 id={foldersId} className="text-body font-semibold text-muted-foreground">
            {t(folderTitle)} <span className="font-medium text-muted-foreground">{folders.length}</span>
          </h2>
          <DocumentsFoldersGrid {...grid} folders={folders} />
        </section>
      ) : null}
      {!hideDocuments ? (
        <section aria-labelledby={documentsId} className="flex flex-col gap-2">
          <h2 id={documentsId} className="text-body font-semibold text-muted-foreground">
            {t("documents.home.sections.documents")} <span className="font-medium text-muted-foreground">{documentsCount}</span>
          </h2>
          {children}
        </section>
      ) : null}
    </>
  );
}

/** The table's rows without folders: the folders show as cards above it. */
export function nonFolderRows(rows: LibraryRow[]): LibraryRow[] {
  return rows.filter((row) => !isFolderRow(row));
}

/** The children folders of a folder node, or the tree's roots at the home root. */
export function subfoldersOf(tree: DocumentTreeNode[], folderId: string | null): DocumentTreeNode[] {
  const nodes = folderId ? (findNode(tree, folderId)?.children ?? []) : myFolderFirst(tree);
  return nodes.filter((node) => node.kind === "folder");
}

function findNode(nodes: DocumentTreeNode[], id: string): DocumentTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inner = findNode(node.children, id);
    if (inner) return inner;
  }
  return undefined;
}

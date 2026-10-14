"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, Download, Ellipsis, ExternalLink, FolderInput, FolderOpen, FolderPlus, MonitorUp, Pencil, Star, StarOff } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { cn } from "@uniwork/ui/lib/utils";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction, type DesktopOpenOutcome } from "../office/desktop-open-action";
import { DocumentTypeIcon } from "./document-type-icon";
import { canArchiveRow, canMoveRow, rowAppOperation, rowLevel } from "./row-level";
import { sourceLinkLabelKey } from "./source-links";
import {
  formatBytes,
  isFolderRow,
  rowFormat,
  rowOrigin,
  rowSizeBytes,
  rowTitle,
  rowUpdatedAt,
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

export function LibraryRowView({ row, handlers, archived }: { row: LibraryRow; handlers: LibraryRowHandlers; archived: boolean }) {
  const { t, i18n } = useTranslation();
  const appRequest = useRef<(() => Promise<DesktopOpenOutcome>) | null>(null);
  const title = rowTitle(row) || t("documents.detail.untitled");
  const format = rowFormat(row);
  const origin = rowOrigin(row);
  const folder = isFolderRow(row);
  const doc = row.type === "document" ? row.doc : null;
  const source = row.type === "source" ? row.source : null;

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
    doc && doc.kind === "file" && doc.current_version > 0 && APP_FORMATS.has(format) && handlers.desktopOpen && !archived
      ? handlers.desktopOpen({ id: doc.id, organization_id: doc.organization_id, current_version: doc.current_version })
      : null;
  const level = rowLevel(doc);

  const primary = () => {
    if (doc && folder) handlers.onFolder(doc.id);
    else if (doc) handlers.onOpen(doc.id);
    else if (row.type === "source") handlers.onGoToSource(row);
  };

  const actions: RowAction[] = [];
  if (doc && folder) {
    actions.push({ id: "open-folder", label: t("documents.home.row.open_folder"), icon: FolderOpen, run: primary });
  } else if (doc) {
    actions.push({ id: "open", label: t("documents.home.row.open_web"), icon: ExternalLink, run: primary });
    if (desktop) {
      actions.push({ id: "open-app", label: t("documents.home.row.open_app"), icon: MonitorUp, run: () => void appRequest.current?.() });
    }
    if (handlers.onToggleStar) {
      const starred = handlers.isStarred(doc.id);
      actions.push({
        id: "star",
        label: starred ? t("documents.home.row.unstar") : t("documents.home.row.star"),
        icon: starred ? StarOff : Star,
        run: () => handlers.onToggleStar?.(doc.id, starred),
      });
    }
  }
  // Each command follows the level of THIS row (create subfolder / rename /
  // move: edit, archive: manage); the archive tab offers none of them.
  if (doc && !archived) {
    if (folder && handlers.onNewSubfolder && canMoveRow(level)) {
      actions.push({ id: "new-subfolder", label: t("documents.home.row.new_subfolder"), icon: FolderPlus, run: () => handlers.onNewSubfolder?.(doc) });
    }
    if (handlers.onRename && canMoveRow(level)) {
      actions.push({ id: "rename", label: t("documents.home.row.rename"), icon: Pencil, run: () => handlers.onRename?.(doc) });
    }
    if (handlers.onMove && canMoveRow(level)) {
      actions.push({ id: "move", label: t("documents.home.row.move"), icon: FolderInput, run: () => handlers.onMove?.(doc) });
    }
    if (handlers.onArchive && canArchiveRow(level)) {
      actions.push({ id: "archive", label: t("documents.home.row.archive"), icon: Archive, run: () => handlers.onArchive?.(doc) });
    }
  }
  if (row.type === "source") {
    actions.push(
      { id: "go-to-source", label: t(sourceLinkLabelKey(row.source.parent)), icon: ExternalLink, run: primary },
      { id: "download", label: t("documents.home.row.download"), icon: Download, run: () => handlers.onDownloadSource(row.source.id) },
    );
    // Only a file the server marks as copyable offers the save.
    if (row.source.can_save) {
      actions.push({ id: "save", label: t("documents.home.row.save_to_folder"), icon: FolderInput, run: () => handlers.onSaveSource(row) });
    }
  }

  const quick = desktop ? (
    <DesktopOpenAction
      {...desktop}
      documentId={doc!.id}
      placement="row"
      operation={rowAppOperation(level)}
      requestRef={appRequest}
    />
  ) : source ? (
    <Button type="button" variant="outline" size="xs" onClick={() => handlers.onDownloadSource(source.id)}>
      <Download aria-hidden />
      {t("documents.home.row.download")}
    </Button>
  ) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<tr />}
        data-library-row={row.id}
        className="group/row border-b border-border transition-colors last:border-b-0 hover:bg-accent/40"
      >
        <td className="px-3 py-2">
          <button type="button" onClick={primary} className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">
            <DocumentTypeIcon format={folder ? "folder" : format} className={cn("size-6 shrink-0", folder && "text-muted-foreground")} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-body text-foreground">{title}</span>
                {archived || doc?.archived_at ? (
                  <Badge variant="secondary" className="shrink-0">{t("documents.library.archived_badge")}</Badge>
                ) : null}
              </span>
              <span className="block truncate text-caption text-muted-foreground md:hidden">
                {[editor, updated, size].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        </td>
        <td className="hidden px-3 py-2 md:table-cell">
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span aria-hidden className={cn("size-1.5 rounded-full", origin === "created" || origin === "documents" ? "bg-primary" : "bg-muted-foreground")} />
            {t(`documents.home.origin.${origin}`)}
          </span>
        </td>
        <td className="hidden px-3 py-2 md:table-cell">
          {editor ? (
            <span className="flex items-center gap-2 text-body text-foreground">
              <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground">
                {initial(editor)}
              </span>
              <span className="truncate">{editor}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="hidden px-3 py-2 font-mono text-caption tabular-nums text-muted-foreground md:table-cell">{updated || "—"}</td>
        <td className="hidden px-3 py-2 font-mono text-caption tabular-nums text-muted-foreground md:table-cell">{size || "—"}</td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-end gap-1">
            {quick ? (
              // Below `md` the app command lives in the ⋯ menu so the name keeps the row.
              <div className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 max-md:hidden">
                {quick}
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
                    <DropdownMenuItem key={action.id} className="gap-2 px-2 py-2" onClick={action.run}>
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
          <ContextMenuItem key={action.id} className="gap-2 px-2 py-2" onClick={action.run}>
            <action.icon aria-hidden className="size-3.5" />
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

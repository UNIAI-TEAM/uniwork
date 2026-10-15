"use client";

import { useState, type ReactNode } from "react";
import { Ellipsis, FolderInput, FolderOpen, FolderPlus, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import { documentKeys } from "@uniwork/core/documents/keys";
import { paths } from "@uniwork/core/paths";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { FolderNameDialog } from "./folder-name-dialog";
import type { DocumentSummaryRow } from "./library-rows";
import { canArchiveRow, canMoveRow, rowLevel } from "./row-level";
import { favoriteRow, knownDocuments } from "./starred-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";
import { shouldRetryFolderDetail } from "./use-tree-reveal";

export const TREE_ROW_KEYSHORTCUTS =
  "Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight Meta+ArrowUp Meta+ArrowDown Meta+ArrowLeft Meta+ArrowRight Shift+F10 ContextMenu";

/** True for Shift+F10 or the dedicated ContextMenu key on a focused tree row. */
export function isRowMenuShortcut(event: { key: string; shiftKey?: boolean }): boolean {
  return event.key === "ContextMenu" || (Boolean(event.shiftKey) && event.key === "F10");
}

export interface TreeRowMenuActions {
  onNewSubfolder: (node: DocumentTreeNode) => void;
  onRename: (node: DocumentTreeNode) => void;
  onMoveTo: (node: DocumentTreeNode) => void;
  onDelete: (node: DocumentTreeNode) => void;
  /** Opens the folder's access report; absent where the host cannot navigate. */
  onAccessReport?: (node: DocumentTreeNode) => void;
}

export interface DocumentTreeRowMenuProps {
  wsId: string;
  node: DocumentTreeNode;
  focused?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Explicit access level ("view" | "edit" | "manage"); when omitted, read from cache/detail. */
  myLevel?: string | null;
  onOpen?: (documentId: string) => void;
  actions?: TreeRowMenuActions;
}

export function toSummaryRow(
  wsId: string,
  node: DocumentTreeNode,
  known?: Partial<DocumentSummaryRow> & { id: string },
): DocumentSummaryRow {
  const row = favoriteRow(
    {
      document_id: node.id,
      workspace_id: wsId,
      parent_id: node.parent_id ?? null,
      kind: node.kind,
      title: node.title,
      icon: node.icon ?? null,
    },
    known,
  );
  return {
    ...row,
    position: node.position,
  };
}

/**
 * Row action menu (`...`) for a folder in `DocumentTree` (addendum §3.6, FD-07):
 * visible on hover and focus, always visible on coarse pointers (≥44px target),
 * and opened by click, right-click, or Shift+F10 / ContextMenu key.
 */
export function DocumentTreeRowMenu({
  wsId,
  node,
  focused = false,
  open: controlledOpen,
  onOpenChange,
  myLevel,
  onOpen,
  actions,
}: DocumentTreeRowMenuProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const detail = useDocument(wsId, node.id, {
    enabled: isOpen && myLevel === undefined && Boolean(wsId) && Boolean(node.id),
    retry: shouldRetryFolderDetail,
  });

  const knownLevel = knownDocuments(
    queryClient.getQueriesData({ queryKey: documentKeys.workspace(wsId) }),
  ).get(node.id)?.my_level;

  const nodeLevelField = (node as { my_level?: string | null }).my_level;
  const resolvedLevel =
    myLevel ?? nodeLevelField ?? (detail.isError ? undefined : detail.data?.my_level) ?? knownLevel;
  const level = rowLevel({ my_level: resolvedLevel });
  const canEdit = canMoveRow(level);
  const canDelete = canArchiveRow(level);
  // The report lists grants, which only a manager may read (the server decides again).
  const canReport = canArchiveRow(level) && Boolean(actions?.onAccessReport);
  const title = node.title || t("documents.detail.untitled");

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-row-menu
            tabIndex={-1}
            aria-label={t("documents.home.row.menu", { title })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "ml-auto shrink-0 opacity-0 transition-opacity",
              "group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
              (focused || isOpen) && "opacity-100",
            )}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
          onClick={() => onOpen?.(node.id)}
        >
          <FolderOpen aria-hidden className="size-3.5" />
          {t("documents.tree.menu.open")}
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuItem
              className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
              onClick={() => actions?.onNewSubfolder(node)}
            >
              <FolderPlus aria-hidden className="size-3.5" />
              {t("documents.tree.menu.new_subfolder")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
              onClick={() => actions?.onRename(node)}
            >
              <Pencil aria-hidden className="size-3.5" />
              {t("documents.tree.menu.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
              onClick={() => actions?.onMoveTo(node)}
            >
              <FolderInput aria-hidden className="size-3.5" />
              {t("documents.tree.menu.move_to")}
            </DropdownMenuItem>
          </>
        ) : null}
        {canReport ? (
          <DropdownMenuItem
            className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
            onClick={() => actions?.onAccessReport?.(node)}
          >
            <ShieldCheck aria-hidden className="size-3.5" />
            {t("documents.accessReport.menu_folder")}
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
              onClick={() => actions?.onDelete(node)}
            >
              <Trash2 aria-hidden className="size-3.5" />
              {t("documents.tree.menu.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Owns the dialogs triggered from `DocumentTreeRowMenu`: subfolder creation,
 * folder rename, move picker (`useLibraryRowDialogs`), and archive confirmation.
 */
export function useTreeRowMenuDialogs({
  wsId,
  tree,
  currentId,
  onCreatedSubfolder,
}: {
  wsId: string;
  tree: DocumentTreeNode[];
  currentId: string | null;
  onCreatedSubfolder?: (parentId: string) => void;
}): { actions: TreeRowMenuActions; dialogs: ReactNode } {
  const queryClient = useQueryClient();
  const navigation = useOptionalNavigation();
  const workspace = useOptionalWorkspace()?.workspace;
  const [creatingUnder, setCreatingUnder] = useState<DocumentTreeNode | null>(null);
  const [renamingNode, setRenamingNode] = useState<DocumentTreeNode | null>(null);
  const rowDialogs = useLibraryRowDialogs({ wsId, tree, folderId: currentId });

  const resolveSummaryRow = (node: DocumentTreeNode): DocumentSummaryRow => {
    const known = knownDocuments(
      queryClient.getQueriesData({ queryKey: documentKeys.workspace(wsId) }),
    ).get(node.id);
    return toSummaryRow(wsId, node, known);
  };

  const actions: TreeRowMenuActions = {
    onNewSubfolder: (node) => setCreatingUnder(node),
    onRename: (node) => setRenamingNode(node),
    onMoveTo: (node) => rowDialogs.onMove(resolveSummaryRow(node)),
    onDelete: (node) => rowDialogs.onArchive(resolveSummaryRow(node)),
    onAccessReport:
      navigation && workspace
        ? (node) =>
            navigation.push(paths.workspace(workspace.organization_slug, workspace.slug).documentsAccessReport(node.id))
        : undefined,
  };

  const dialogs = (
    <>
      <FolderNameDialog
        open={creatingUnder !== null}
        onOpenChange={(next) => {
          if (!next) setCreatingUnder(null);
        }}
        mode="create"
        wsId={wsId}
        parentId={creatingUnder?.id ?? null}
        parentTitle={creatingUnder?.title ?? ""}
        onSuccess={() => {
          if (creatingUnder) onCreatedSubfolder?.(creatingUnder.id);
        }}
      />
      <FolderNameDialog
        open={renamingNode !== null}
        onOpenChange={(next) => {
          if (!next) setRenamingNode(null);
        }}
        mode="rename"
        wsId={wsId}
        folderId={renamingNode?.id ?? ""}
        initialName={renamingNode?.title ?? ""}
      />
      {rowDialogs.dialogs}
    </>
  );

  return { actions, dialogs };
}

"use client";

import { ChevronRight, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { isMyFolder } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { DocumentShareScopeBadge } from "./document-share-scope-badge";
import {
  DocumentTreeRowMenu, isRowMenuShortcut, TREE_ROW_KEYSHORTCUTS, type TreeRowMenuActions,
} from "./document-tree-row-menu";
import { documentIconFormat, DocumentTypeIcon } from "./document-type-icon";
import { DOCUMENTS_NAV_ICONS } from "./documents-nav-icons";
import type { TreeRow } from "./document-tree-model";

/**
 * Caps visual indent so deep branches (up to TREE_MAX_LEVEL = 20) keep a
 * readable label inside the 256px sidebar without horizontal scroll:
 * 12px/level through depth 6, 4px/level through depth 14, and 2px/level past
 * that (120px at depth 19).
 */
function treeRowPaddingLeft(depth: number): number {
  const full = Math.min(depth, 6) * 12;
  const medium = Math.min(Math.max(depth - 6, 0), 8) * 4;
  const compact = Math.max(depth - 14, 0) * 2;
  return 4 + full + medium + compact;
}

interface TreeRowItemProps {
  wsId: string;
  row: TreeRow;
  shareScope?: DocumentShareScope | null;
  starred: boolean;
  expanded: boolean;
  focused: boolean;
  current: boolean;
  tabbable: boolean;
  moving: boolean;
  dragDisabled: boolean;
  menuActions: TreeRowMenuActions;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onFocusRequest: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onOpen: () => void;
}

export function TreeRowItem({
  wsId, row, shareScope, starred, expanded, focused, current, tabbable, moving, dragDisabled,
  menuActions, registerRef, onFocusRequest, onKeyDown, onToggle, onOpen,
}: TreeRowItemProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const myFolder = isMyFolder(row.node);
  const drag = useDraggable({ id: `doc:${row.node.id}`, disabled: dragDisabled || myFolder });
  const drop = useDroppable({ id: `drop:${row.node.id}`, data: { id: row.node.id } });
  const { setNodeRef: setDragRef, isDragging } = drag;
  const { setNodeRef: setDropRef, isOver } = drop;
  // The dnd-kit `attributes` are not spread: they force role="button", which
  // is the wrong role inside a tree. Keyboard navigation is the tree's own.
  const { listeners } = drag;
  const label = (myFolder ? t("documents.home.my_folder.label") : row.node.title) || t("documents.detail.untitled");

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
        registerRef(row.node.id, el);
      }}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-selected={focused}
      aria-current={current || undefined}
      aria-busy={moving || undefined}
      aria-keyshortcuts={TREE_ROW_KEYSHORTCUTS}
      data-tree-node={row.node.id}
      tabIndex={tabbable ? 0 : -1}
      {...listeners}
      onFocus={onFocusRequest}
      onContextMenu={(event) => {
        event.preventDefault();
        onFocusRequest();
        setMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (isRowMenuShortcut(event)) {
          event.preventDefault();
          setMenuOpen(true);
          return;
        }
        if (event.target !== event.currentTarget) return;
        onKeyDown(event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-chevron], [data-row-menu]")) return;
        onOpen();
      }}
      className={cn(
        "group/row flex min-h-9 w-full cursor-pointer items-center gap-1 rounded-md pr-1 text-body",
        "pointer-coarse:min-h-11",
        "hover:bg-accent/60",
        (focused || current) && "bg-accent",
        current && "font-medium",
        isOver && "ring-2 ring-ring",
        (isDragging || moving) && "opacity-60",
      )}
      style={{ paddingLeft: `${treeRowPaddingLeft(row.depth)}px` }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          data-chevron
          tabIndex={-1}
          aria-label={
            expanded
              ? t("documents.tree.collapse", { title: row.node.title })
              : t("documents.tree.expand", { title: row.node.title })
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:-mx-2.5 pointer-coarse:size-11"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="size-6 shrink-0" />
      )}
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {myFolder ? (
          // The personal root keeps its own glyph now that it lives only in the tree.
          <DOCUMENTS_NAV_ICONS.myFolders className="size-4" />
        ) : row.node.icon ? (
          <span className="text-body leading-none">{row.node.icon}</span>
        ) : (
          <DocumentTypeIcon format={documentIconFormat(row.node.kind, row.node.title)} className="size-4" />
        )}
      </span>
      <span title={label} className="min-w-0 truncate">{label}</span>
      {starred ? (
        <Star role="img" aria-label={t("documents.home.row.starred")} className="ml-1 size-3.5 shrink-0 fill-current text-brand" />
      ) : null}
      <DocumentShareScopeBadge
        shareScope={shareScope ?? row.node.share_scope}
        compact
        focusable={false}
        className="ml-1"
      />
      <DocumentTreeRowMenu
        wsId={wsId}
        node={row.node}
        focused={focused}
        starred={starred}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpen={onOpen}
        actions={menuActions}
      />
      {moving ? <span className="sr-only">{t("documents.tree.moving")}</span> : null}
    </div>
  );
}

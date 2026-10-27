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
 * 20px/level (chevron slot 16 + gap 4) through depth 6 so each child's
 * chevron column sits under its parent's icon, capped at 120px (depth >= 6).
 */
function treeRowPaddingLeft(depth: number): number {
  return Math.min(8 + depth * 20, 120);
}

/**
 * From this depth on, the star, share-scope badge and row menu stop taking
 * width in the row: at the 224px row of a 240px sidebar the name keeps
 * 172px - indent (84px at depth 4) instead of 132px - indent, and the slots
 * appear as an overlay on hover, keyboard focus or an open menu. The indent
 * step is untouched. On coarse pointers there is no hover, so the slots stay
 * in the row there.
 */
const TREE_SLOT_OVERLAY_DEPTH = 2;

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
  const overlaySlots = row.depth >= TREE_SLOT_OVERLAY_DEPTH;

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
        "group/row relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-body",
        "pointer-coarse:min-h-11",
        overlaySlots && "pr-1 pointer-coarse:pr-2",
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
          className="relative z-10 -mr-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground before:absolute before:content-[''] before:-inset-1 pointer-coarse:before:-left-2 pointer-coarse:before:-right-5 pointer-coarse:before:-top-3.5 pointer-coarse:before:-bottom-3.5"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden data-chevron-placeholder className="-mr-1 size-4 shrink-0" />
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
      <span title={label} className="min-w-0 flex-1 truncate">{label}</span>
      <TreeRowTrailing overlay={overlaySlots} revealed={focused || menuOpen}>
        {starred ? (
          <Star
            role="img"
            aria-label={t("documents.home.row.starred")}
            className={cn("size-3.5 shrink-0 fill-current text-brand", !overlaySlots && "ml-1")}
          />
        ) : null}
        <DocumentShareScopeBadge
          shareScope={row.node.kind === "folder" ? null : (shareScope ?? row.node.share_scope)}
          compact
          focusable={false}
          className={overlaySlots ? undefined : "ml-1"}
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
      </TreeRowTrailing>
      {moving ? <span className="sr-only">{t("documents.tree.moving")}</span> : null}
    </div>
  );
}

/**
 * The row's trailing slots. In a deep row they are an absolutely positioned
 * overlay (no width in the flex row) that shows on hover, focus within, the
 * roving-focus row or an open menu; children stay in the accessibility tree.
 */
function TreeRowTrailing({
  overlay, revealed, children,
}: { overlay: boolean; revealed: boolean; children: React.ReactNode }) {
  if (!overlay) return <>{children}</>;
  return (
    <span
      data-row-trailing
      className={cn(
        "pointer-events-none absolute inset-y-0 right-1 z-10 flex items-center gap-1 rounded-md bg-accent pl-1 opacity-0 transition-opacity",
        "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
        revealed && "pointer-events-auto opacity-100",
        "pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:bg-transparent pointer-coarse:pl-0 pointer-coarse:opacity-100",
      )}
    >
      {children}
    </span>
  );
}

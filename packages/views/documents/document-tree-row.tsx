"use client";

import { ChevronRight, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { isMyFolder } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { DocumentShareScopeBadge } from "./document-share-scope-badge";
import { DocumentMinutesSourceLink } from "./document-minutes-source-link";
import {
  DocumentTreeRowMenu, isRowMenuShortcut, TREE_ROW_KEYSHORTCUTS, type TreeRowMenuActions,
} from "./document-tree-row-menu";
import { documentIconFormat, DocumentTypeIcon } from "./document-type-icon";
import { DOCUMENTS_NAV_ICONS } from "./documents-nav-icons";
import { treeRowPaddingLeft } from "./document-tree-indent";
import type { TreeRow } from "./document-tree-model";

/**
 * From this depth on the row menu stops taking width in the row: at the 224px
 * row of a 240px sidebar the name keeps 172px - indent instead of 132px -
 * indent, and the "..." button appears as an overlay on hover, keyboard focus
 * or an open menu. The star and the share-scope badge stay in the row at rest
 * (an icon each, 4px gap) so the starred / shared state is always visible; on
 * reveal they fade out under the button, which sits over the right end of the
 * row. The indent step is untouched. On coarse pointers there is no hover, so
 * the menu stays in the row there.
 */
const TREE_SLOT_OVERLAY_DEPTH = 2;

// Widths (px) behind the reveal fade of a deep name: the menu button reaches
// 24px into the row's content box (28 wide, flush with the row edge, 4px
// padding); a star takes 14 + 4 gap and a badge icon 12 + 4 gap of that.
const TREE_MENU_REACH = 24;
const TREE_STAR_SLOT = 18;
const TREE_BADGE_SLOT = 16;
const TREE_NAME_FADE = 8;

// What the button covers when revealed. Fades the star / badge out (they are
// under it) on fine pointers only; coarse pointers keep the menu in the row.
const HIDE_UNDER_MENU = [
  "pointer-fine:group-hover/row:opacity-0",
  "pointer-fine:group-focus-within/row:opacity-0",
];
const MASK_NAME_WHEN_REVEALED = [
  "pointer-fine:group-hover/row:[mask-image:var(--tree-name-mask)]",
  "pointer-fine:group-focus-within/row:[mask-image:var(--tree-name-mask)]",
];

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
  const revealed = focused || menuOpen;
  const scope = row.node.kind === "folder" ? null : (shareScope ?? row.node.share_scope);
  // How far into the name's box the revealed menu button reaches: its own
  // reach minus the star / badge slots that sit between the name and the edge.
  const fadeStart = Math.max(
    0,
    TREE_MENU_REACH - (starred ? TREE_STAR_SLOT : 0) - (scope ? TREE_BADGE_SLOT : 0),
  );

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
        if ((event.target as HTMLElement).closest("[data-chevron], [data-row-menu], [data-minutes-meeting]")) return;
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
      {row.node.kind === "page" && row.node.minutes_meeting?.id ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            title={label}
            className={cn(
              "min-w-0 truncate",
              overlaySlots && fadeStart > 0 && MASK_NAME_WHEN_REVEALED,
              overlaySlots && fadeStart > 0 && revealed && "pointer-fine:[mask-image:var(--tree-name-mask)]",
            )}
            style={
              overlaySlots && fadeStart > 0
                ? ({
                    "--tree-name-mask": `linear-gradient(to left, transparent ${fadeStart}px, black ${fadeStart + TREE_NAME_FADE}px)`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {label}
          </span>
          <DocumentMinutesSourceLink
            minutesMeeting={row.node.minutes_meeting}
            stopPropagation
            className="leading-tight"
          />
        </span>
      ) : (
        <span
          title={label}
          className={cn(
            "min-w-0 flex-1 truncate",
            overlaySlots && fadeStart > 0 && MASK_NAME_WHEN_REVEALED,
            overlaySlots && fadeStart > 0 && revealed && "pointer-fine:[mask-image:var(--tree-name-mask)]",
          )}
          style={
            overlaySlots && fadeStart > 0
              ? ({
                  "--tree-name-mask": `linear-gradient(to left, transparent ${fadeStart}px, black ${fadeStart + TREE_NAME_FADE}px)`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {label}
        </span>
      )}
      {starred ? (
        <Star
          role="img"
          aria-label={t("documents.home.row.starred")}
          className={cn(
            "size-3.5 shrink-0 fill-current text-brand",
            overlaySlots ? ["-ml-1 transition-opacity", HIDE_UNDER_MENU, revealed && "pointer-fine:opacity-0"] : "ml-1",
          )}
        />
      ) : null}
      <DocumentShareScopeBadge
        shareScope={scope}
        compact
        focusable={false}
        className={
          overlaySlots
            ? cn("-ml-1 transition-opacity [&>span]:sr-only", HIDE_UNDER_MENU, revealed && "pointer-fine:opacity-0")
            : "ml-1"
        }
      />
      <TreeRowTrailing overlay={overlaySlots} revealed={revealed}>
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
 * The row menu of a deep row: an overlay over the right end of the row (no
 * width in the flex row, no background, so it blends into every row state)
 * that shows on hover, focus within, the roving-focus row or an open menu;
 * the button stays in the accessibility tree while hidden.
 */
function TreeRowTrailing({
  overlay, revealed, children,
}: { overlay: boolean; revealed: boolean; children: React.ReactNode }) {
  if (!overlay) return <>{children}</>;
  return (
    <span
      data-row-trailing
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center opacity-0 transition-opacity",
        "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
        revealed && "pointer-events-auto opacity-100",
        "pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:opacity-100",
      )}
    >
      {children}
    </span>
  );
}

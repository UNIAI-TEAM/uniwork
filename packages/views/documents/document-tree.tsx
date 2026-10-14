"use client";

import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useDocumentTree, useMoveDocument } from "@uniwork/core/documents/hooks-collections";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { documentErrorMessage } from "./document-error-message";
import { documentIconFormat, DocumentTypeIcon } from "./document-type-icon";
import {
  findTreeNode,
  flattenTree,
  foldersOnly,
  loadMoveRevision,
  moveRefused,
  moveTooDeep,
  siblingMovePosition,
  siblingsOf,
  TREE_MAX_LEVEL,
  type TreeRow,
} from "./document-tree-model";

/* ---- rows --------------------------------------------------------------- */

interface TreeRowItemProps {
  row: TreeRow;
  expanded: boolean;
  focused: boolean;
  current: boolean;
  tabbable: boolean;
  moving: boolean;
  dragDisabled: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onFocusRequest: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onOpen: () => void;
}

function TreeRowItem({
  row,
  expanded,
  focused,
  current,
  tabbable,
  moving,
  dragDisabled,
  registerRef,
  onFocusRequest,
  onKeyDown,
  onToggle,
  onOpen,
}: TreeRowItemProps) {
  const { t } = useTranslation();
  const drag = useDraggable({ id: `doc:${row.node.id}`, disabled: dragDisabled });
  const drop = useDroppable({ id: `drop:${row.node.id}`, data: { id: row.node.id } });
  const { setNodeRef: setDragRef, isDragging } = drag;
  const { setNodeRef: setDropRef, isOver } = drop;

  // The dnd-kit `attributes` are not spread: they force role="button", which
  // is the wrong role inside a tree. Keyboard navigation is the tree's own.
  const { listeners } = drag;

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
      aria-keyshortcuts="Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight Meta+ArrowUp Meta+ArrowDown Meta+ArrowLeft Meta+ArrowRight"
      data-tree-node={row.node.id}
      tabIndex={tabbable ? 0 : -1}
      {...listeners}
      onFocus={onFocusRequest}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-chevron]")) return;
        onOpen();
      }}
      className={cn(
        "group/row flex min-h-9 w-full cursor-pointer items-center gap-1 rounded-md pr-2 text-body",
        "pointer-coarse:min-h-11",
        "hover:bg-accent/60",
        (focused || current) && "bg-accent",
        current && "font-medium",
        isOver && "ring-2 ring-ring",
        (isDragging || moving) && "opacity-60",
      )}
      style={{ paddingLeft: `${row.depth * 12 + 4}px` }}
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
        {row.node.icon ? (
          <span className="text-body leading-none">{row.node.icon}</span>
        ) : (
          <DocumentTypeIcon format={documentIconFormat(row.node.kind, row.node.title)} className="size-4" />
        )}
      </span>
      <span className="truncate">{row.node.title || t("documents.detail.untitled")}</span>
      {moving ? <span className="sr-only">{t("documents.tree.moving")}</span> : null}
    </div>
  );
}

/* ---- the tree ----------------------------------------------------------- */

export interface DocumentTreeProps {
  wsId: string;
  /** Narrows the fetch to one branch; omitted, the forest loads as one answer. */
  rootId?: string;
  /** Opens a document; Enter or a click on the row. */
  onOpen?: (documentId: string) => void;
  enabled?: boolean;
  className?: string;
  /** Show folders only (the Documents sidebar); pages and files stay in the library. */
  folders?: boolean;
  /** The open folder, drawn as current. */
  currentId?: string | null;
  /** Shown instead of the generic empty line. */
  emptyLabel?: string;
}

/**
 * The document sidebar tree: five levels from `GET …/documents/tree`, pointer
 * drag reparenting and the WAI-ARIA tree keyboard pattern (↑↓ move, → expand
 * or enter the first child, ← collapse or go to the parent, Home/End, Enter to
 * open, Space to toggle). Ctrl/⌘ + arrows reparent the focused node without a
 * pointer (↑/↓ reorder among siblings, → indent under the previous sibling,
 * ← outdent after the parent) — the non-drag alternative WCAG 2.2 SC 2.5.7
 * asks for.
 *
 * The contract answers a whole five-level forest in one call, so the default
 * load is the root branch and expansion is instant; `rootId` narrows the fetch
 * to one branch for the callers that open a deep link. The loading state is
 * the branch being fetched — a branch that has arrived is never re-fetched to
 * "expand" it.
 *
 * A drag never moves a row by itself: the drop reads the dragged document's
 * current revision from the server and calls the move endpoint; the tree only
 * changes when that answer lands and the workspace keys are invalidated. A
 * refused or failed move therefore leaves every position exactly where it was.
 */
export function DocumentTree({ wsId, rootId, onOpen, enabled = true, className, folders = false, currentId = null, emptyLabel }: DocumentTreeProps) {
  const { t } = useTranslation();
  const query = useDocumentTree(wsId, rootId, { enabled });
  const move = useMoveDocument(wsId);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<TreeRow | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const nodes = useMemo(() => {
    const forest = query.data?.documents ?? [];
    return folders ? foldersOnly(forest) : forest;
  }, [query.data, folders]);
  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const registerRef = (id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveTo = async (documentId: string, parentId: string | null, position?: number) => {
    setMovingId(documentId);
    const revealAfterMove = () => {
      // Reveal the parent and keep the moved document focused after the refetch.
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setFocusedId(documentId);
    };
    try {
      const revision = await loadMoveRevision(queryClient, wsId, documentId);
      if (!revision) {
        toast.error(t("documents.tree.move_failed"));
        return;
      }
      await move.mutateAsync({ documentId, parent_id: parentId, position, revision });
      revealAfterMove();
    } catch (error) {
      toast.error(documentErrorMessage(error, t, "documents.tree.move_failed"));
    } finally {
      setMovingId(null);
    }
  };

  /** Refusals that need no request: a cycle or a move past five levels. */
  const refuseMove = (draggedId: string, targetId: string): boolean => {
    if (moveRefused(nodes, draggedId, targetId)) return true;
    if (moveTooDeep(nodes, draggedId, targetId)) {
      toast.error(t("documents.tree.too_deep", { max: TREE_MAX_LEVEL }));
      return true;
    }
    return false;
  };

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id).replace(/^doc:/, "");
    setDragRow(rows.find((row) => row.node.id === id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const dragged = dragRow;
    setDragRow(null);
    const targetId = event.over?.data.current?.id as string | undefined;
    if (!dragged || !targetId) return;
    const draggedId = dragged.node.id;
    setFocusedId(draggedId);
    if (refuseMove(draggedId, targetId)) return;
    void moveTo(draggedId, targetId);
  };

  const rowKeyDown =
    (row: TreeRow, index: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const id = row.node.id;

      // Ctrl/Cmd + arrows move the focused node without a pointer: the
      // non-drag alternative WCAG 2.2 SC 2.5.7 asks for. ↑/↓ reorder among
      // the siblings, → becomes the previous sibling's last child, ← becomes
      // the next sibling of its parent.
      if ((event.ctrlKey || event.metaKey) && event.key.startsWith("Arrow")) {
        // One move at a time, as on the drag path: a second one would race it.
        if (movingId) {
          event.preventDefault();
          return;
        }
        const siblings = siblingsOf(nodes, row.parentId);
        const siblingIndex = siblings.findIndex((sibling) => sibling.id === id);
        if (siblingIndex < 0) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const position = siblingMovePosition(siblings, siblingIndex, event.key === "ArrowUp" ? -1 : 1);
          if (position !== null) void moveTo(id, row.parentId, position);
          return;
        }
        if (event.key === "ArrowRight") {
          const previous = siblings[siblingIndex - 1];
          if (!previous) return;
          event.preventDefault();
          if (refuseMove(id, previous.id)) return;
          void moveTo(id, previous.id);
          return;
        }
        if (event.key === "ArrowLeft") {
          if (!row.parentId) return;
          const parent = findTreeNode(nodes, row.parentId);
          if (!parent) return;
          event.preventDefault();
          // Midpoint to the parent's next sibling, so integer positions never tie.
          const uncles = siblingsOf(nodes, parent.parent_id ?? null);
          const next = uncles[uncles.findIndex((uncle) => uncle.id === parent.id) + 1];
          const position = next ? (parent.position + next.position) / 2 : parent.position + 1;
          void moveTo(id, parent.parent_id ?? null, position);
          return;
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(rows[index + 1]?.node.id);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusRow(rows[index - 1]?.node.id ?? rows[0]?.node.id);
          break;
        case "ArrowRight":
          if (row.hasChildren) {
            event.preventDefault();
            if (!expanded.has(id)) toggle(id);
            else {
              const firstChild = rows[index + 1];
              if (firstChild && firstChild.parentId === id) focusRow(firstChild.node.id);
            }
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (row.hasChildren && expanded.has(id)) toggle(id);
          else focusRow(row.parentId ?? undefined);
          break;
        case "Home":
          event.preventDefault();
          focusRow(rows[0]?.node.id);
          break;
        case "End":
          event.preventDefault();
          focusRow(rows[rows.length - 1]?.node.id);
          break;
        case "Enter":
          event.preventDefault();
          onOpen?.(id);
          break;
        case " ":
          event.preventDefault();
          if (row.hasChildren) toggle(id);
          break;
        default:
          break;
      }
    };

  if (!enabled) return null;

  if (query.isPending) {
    return (
      <div className={cn("space-y-1 p-2", className)} aria-busy="true" aria-label={t("documents.tree.loading")}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (query.isError && !query.data) {
    return (
      <div className={cn("space-y-2 p-3", className)}>
        <p className="text-caption text-muted-foreground">{t("documents.tree.error_title")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden className="size-3.5" />
          {t("documents.tree.retry")}
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className={cn("px-3 py-4 text-caption text-muted-foreground", className)}>{emptyLabel ?? t("documents.tree.empty")}</p>;
  }

  return (
    <div className={cn("min-h-0 overflow-y-auto p-2", className)} aria-busy={movingId ? true : undefined}>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div role="tree" tabIndex={-1} aria-label={t("documents.tree.aria_label")}>
          {rows.map((row, index) => (
            <TreeRowItem
              key={row.node.id}
              row={row}
              expanded={expanded.has(row.node.id)}
              focused={focusedId === row.node.id}
              current={currentId === row.node.id}
              tabbable={focusedId ? focusedId === row.node.id : index === 0}
              moving={movingId === row.node.id}
              dragDisabled={movingId !== null}
              registerRef={registerRef}
              onFocusRequest={() => setFocusedId(row.node.id)}
              onKeyDown={rowKeyDown(row, index)}
              onToggle={() => toggle(row.node.id)}
              onOpen={() => onOpen?.(row.node.id)}
            />
          ))}
        </div>
        <DragOverlay>
          {dragRow ? (
            <div className="rounded-md border bg-background px-2 py-1 text-body shadow-md">
              {dragRow.node.title || t("documents.detail.untitled")}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {movingId ? (
        <p role="status" className="px-2 py-1 text-caption text-muted-foreground">
          {t("documents.tree.moving")}
        </p>
      ) : null}
    </div>
  );
}

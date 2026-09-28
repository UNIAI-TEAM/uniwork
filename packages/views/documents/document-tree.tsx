"use client";

import { ChevronRight, File, FileText, FolderTree, RotateCw } from "lucide-react";
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
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@uniwork/core/api";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { useDocumentTree, useMoveDocument } from "@uniwork/core/documents/hooks-collections";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";

/* ---- pure tree helpers (unit-tested on their own) ----------------------- */

/** One visible row of the flattened forest, in render order. */
export interface TreeRow {
  node: DocumentTreeNode;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}

/** The visible rows: children of expanded nodes only, depth-first. */
export function flattenTree(
  nodes: DocumentTreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId: string | null = null,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth, parentId, hasChildren: node.children.length > 0 });
    if (node.children.length > 0 && expanded.has(node.id)) {
      rows.push(...flattenTree(node.children, expanded, depth + 1, node.id));
    }
  }
  return rows;
}

/** Every id under `rootId`, the root included; empty when it is not in the forest. */
export function subtreeIds(nodes: DocumentTreeNode[], rootId: string): Set<string> {
  const ids = new Set<string>();
  const collect = (node: DocumentTreeNode) => {
    ids.add(node.id);
    for (const child of node.children) collect(child);
  };
  const walk = (list: DocumentTreeNode[]): boolean => {
    for (const node of list) {
      if (node.id === rootId) {
        collect(node);
        return true;
      }
      if (walk(node.children)) return true;
    }
    return false;
  };
  walk(nodes);
  return ids;
}

/**
 * A drop is refused before any request when it would move a node onto itself
 * or into its own subtree (the cycle the server also refuses). The tree keeps
 * its position because there is nothing to undo — no optimistic move exists.
 */
export function moveRefused(
  nodes: DocumentTreeNode[],
  draggedId: string,
  targetId: string,
): boolean {
  if (!draggedId || !targetId || draggedId === targetId) return true;
  return subtreeIds(nodes, draggedId).has(targetId);
}

/** The server's tree limit: five levels, a root page counting as level one. */
export const TREE_MAX_LEVEL = 5;

/** The forest node with this id, or null when it is not in the loaded forest. */
export function findTreeNode(nodes: DocumentTreeNode[], id: string): DocumentTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findTreeNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** How many levels hang below this node (0 for a leaf). */
export function subtreeHeight(node: DocumentTreeNode): number {
  let height = 0;
  for (const child of node.children) height = Math.max(height, 1 + subtreeHeight(child));
  return height;
}

/** 1-based level of a node in the forest; null when it is not there. */
export function nodeLevel(nodes: DocumentTreeNode[], id: string): number | null {
  let level: number | null = null;
  const walk = (list: DocumentTreeNode[], depth: number) => {
    for (const node of list) {
      if (level !== null) return;
      if (node.id === id) {
        level = depth;
        return;
      }
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 1);
  return level;
}

/**
 * True when the move would push the dragged subtree past five levels. The
 * server refuses it too (422 document_too_deep); refusing here saves the
 * round-trip and says why.
 */
export function moveTooDeep(
  nodes: DocumentTreeNode[],
  draggedId: string,
  targetId: string,
): boolean {
  const dragged = findTreeNode(nodes, draggedId);
  const targetLevel = nodeLevel(nodes, targetId);
  if (!dragged || targetLevel === null) return false;
  return targetLevel + 1 + subtreeHeight(dragged) > TREE_MAX_LEVEL;
}

/**
 * The position that places `index` before (`-1`) or after (`+1`) its nearest
 * sibling: the midpoint to that sibling, or a step past the edge. Null means
 * there is no sibling in that direction.
 */
export function siblingMovePosition(
  siblings: DocumentTreeNode[],
  index: number,
  direction: -1 | 1,
): number | null {
  if (direction === -1) {
    const prev = siblings[index - 1];
    if (!prev) return null;
    const prevPrev = siblings[index - 2];
    return prevPrev ? (prevPrev.position + prev.position) / 2 : prev.position - 1;
  }
  const next = siblings[index + 1];
  if (!next) return null;
  const nextNext = siblings[index + 2];
  return nextNext ? (next.position + nextNext.position) / 2 : next.position + 1;
}

/** Direct children of `parentId` in position order (`null` = the roots). */
export function siblingsOf(nodes: DocumentTreeNode[], parentId: string | null): DocumentTreeNode[] {
  if (parentId === null) return nodes;
  return findTreeNode(nodes, parentId)?.children ?? [];
}

/**
 * The revision a move must carry, read fresh from the detail endpoint: the
 * tree payload has no revision, and a cached one could be stale (a stale base
 * is answered 422). Null means the server answer cannot be trusted as a base.
 */
export async function loadMoveRevision(
  queryClient: QueryClient,
  wsId: string,
  documentId: string,
): Promise<string | null> {
  const doc = await queryClient.fetchQuery({
    queryKey: documentKeys.detail(wsId, documentId),
    queryFn: ({ signal }) => getDocument(documentId, signal),
    // A cached copy is never fresh enough to prove a base for a write.
    staleTime: 0,
  });
  if (!doc) return null;
  // The same identity check `requireVerifiableDocument` makes: a parse that
  // dropped id/revision is not a base a write may be sent on.
  if (!doc.id || !doc.revision) return null;
  return doc.revision;
}

/* ---- rows --------------------------------------------------------------- */

interface TreeRowItemProps {
  row: TreeRow;
  expanded: boolean;
  focused: boolean;
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
        focused && "bg-accent",
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
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:size-11"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="size-6 shrink-0 pointer-coarse:size-11" />
      )}
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {row.node.icon ? (
          <span className="text-body leading-none">{row.node.icon}</span>
        ) : row.node.kind === "file" ? (
          <File className="size-3.5" />
        ) : (
          <FileText className="size-3.5" />
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
export function DocumentTree({ wsId, rootId, onOpen, enabled = true, className }: DocumentTreeProps) {
  const { t } = useTranslation();
  const query = useDocumentTree(wsId, rootId, { enabled });
  const move = useMoveDocument(wsId);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<TreeRow | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const nodes = useMemo(() => query.data?.documents ?? [], [query.data]);
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
      toast.error(apiErrorMessage(error) ?? t("documents.tree.move_failed"));
    } finally {
      setMovingId(null);
    }
  };

  /** Refusals that need no request: a cycle or a move past five levels. */
  const refuseMove = (draggedId: string, targetId: string): boolean => {
    if (moveRefused(nodes, draggedId, targetId)) return true;
    if (moveTooDeep(nodes, draggedId, targetId)) {
      toast.error(t("documents.tree.too_deep"));
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
          <RotateCw aria-hidden className="size-3.5" />
          {t("documents.tree.retry")}
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className={cn("px-3 py-4 text-caption text-muted-foreground", className)}>{t("documents.tree.empty")}</p>;
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

export interface DocumentTreeSheetProps extends DocumentTreeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The small-screen tree: the same tree inside a left sheet. */
export function DocumentTreeSheet({ open, onOpenChange, ...tree }: DocumentTreeSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-xs" closeLabel={t("common.close")}>
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-title">
            <FolderTree aria-hidden className="size-4 text-muted-foreground" />
            {t("documents.tree.sheet_title")}
          </SheetTitle>
          <SheetDescription className="mt-0.5">{t("documents.tree.sheet_description")}</SheetDescription>
        </SheetHeader>
        <DocumentTree {...tree} className="flex-1" />
      </SheetContent>
    </Sheet>
  );
}

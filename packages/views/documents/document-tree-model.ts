import type { QueryClient } from "@tanstack/react-query";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import { documentKeys } from "@uniwork/core/documents/keys";
import { isMyFolder, type DocumentTreeNode } from "@uniwork/core/types/document";

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

/**
 * The folders of a forest and the folders nested in them: a page or file is
 * dropped with its subtree, so the sidebar "Folders" section lists folders only.
 */
export function foldersOnly(nodes: DocumentTreeNode[]): DocumentTreeNode[] {
  return nodes
    .filter((node) => node.kind === "folder")
    .map((node) => ({ ...node, children: foldersOnly(node.children) }));
}

/** Places the caller's My Folder first among root nodes while keeping sibling order. */
export function myFolderFirst(nodes: DocumentTreeNode[]): DocumentTreeNode[] {
  const idx = nodes.findIndex((node) => isMyFolder(node));
  if (idx <= 0) return nodes;
  return [nodes[idx]!, ...nodes.slice(0, idx), ...nodes.slice(idx + 1)];
}

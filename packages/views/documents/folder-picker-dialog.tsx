"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, FolderRoot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import {
  findTreeNode,
  flattenTree,
  foldersOnly,
  moveRefused,
  moveTooDeep,
  nodeLevel,
  subtreeIds,
} from "./document-tree-model";

const ROOT_KEY = "__root__";

function rowKey(id: string | null): string {
  return id ?? ROOT_KEY;
}

function allFolderIds(nodes: DocumentTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: DocumentTreeNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.add(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/**
 * Caps visual indent so deep branches (up to TREE_MAX_LEVEL = 20) keep a
 * readable label and disabled reason inside the dialog without horizontal
 * overflow on narrow viewports.
 */
function pickerRowPaddingLeft(depth: number): number {
  const full = Math.min(depth, 6) * 12;
  const medium = Math.min(Math.max(depth - 6, 0), 8) * 4;
  const compact = Math.max(depth - 14, 0) * 2;
  return 4 + full + medium + compact;
}

interface PickerRow {
  key: string;
  id: string | null;
  label: string;
  depth: number;
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  root: boolean;
  reason: string | null;
  disabled: boolean;
}

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  /** Accessible label of the destination tree; defaults to `documents.home.move.picker_label`. */
  pickerLabel?: string;
  /** Label of the workspace root row; defaults to `documents.home.move.root`. */
  rootLabel?: string;
  /** The workspace forest (folders are picked from it; full forest is used for subtree height). */
  tree: DocumentTreeNode[];
  /** Preselected folder when opening (when not disabled as the current location). */
  initialFolderId: string | null;
  /** Current parent folder of the item being moved (`null` = at the root). Marks that row `aria-disabled` with `reason_current`. */
  currentFolderId?: string | null;
  /** Id of the document or folder being moved. Marks itself/its subtree with `reason_self` and too-deep targets with `reason_too_deep`. */
  movingId?: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (folderId: string | null) => void;
}

/**
 * Tree folder picker (addendum §3.6, FD-09): collapsible folder tree with
 * "Documents (gốc)" root as a target. Current location, the moved item's own
 * subtree, and targets past `TREE_MAX_LEVEL` are shown with `aria-disabled`
 * (still focusable and keyboard-reachable) and a visible text reason below the
 * name; selecting them does nothing.
 */
export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pickerLabel,
  rootLabel,
  tree,
  initialFolderId,
  currentFolderId,
  movingId,
  pending,
  error,
  onSubmit,
}: FolderPickerDialogProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const folders = useMemo(() => foldersOnly(tree), [tree]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => allFolderIds(folders));
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const disabledReason = useCallback(
    (targetId: string | null): string | null => {
      if (currentFolderId !== undefined && targetId === currentFolderId) {
        return t("documents.home.move.reason_current");
      }
      if (targetId !== null) {
        if (movingId && moveRefused(tree, movingId, targetId)) {
          return t("documents.home.move.reason_self");
        }
        if (movingId && findTreeNode(tree, movingId)) {
          if (moveTooDeep(tree, movingId, targetId)) {
            return t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL });
          }
        } else {
          const level = nodeLevel(tree, targetId);
          if (level !== null && level + 1 > TREE_MAX_LEVEL) {
            return t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL });
          }
        }
      }
      return null;
    },
    [currentFolderId, movingId, t, tree],
  );

  const initialReason = disabledReason(initialFolderId);
  const [picked, setPicked] = useState<string | null | undefined>(() =>
    initialReason === null ? initialFolderId : undefined,
  );
  const [focusedKey, setFocusedKey] = useState<string>(() =>
    rowKey(currentFolderId !== undefined ? currentFolderId : initialFolderId),
  );

  useEffect(() => {
    if (open) {
      setExpanded(allFolderIds(folders));
      setPicked(disabledReason(initialFolderId) === null ? initialFolderId : undefined);
      setFocusedKey(rowKey(currentFolderId !== undefined ? currentFolderId : initialFolderId));
    }
  }, [open, initialFolderId, currentFolderId, folders, disabledReason]);

  const rootReason = disabledReason(null);
  const rootEntry: PickerRow = {
    key: ROOT_KEY,
    id: null,
    label: rootLabel ?? t("documents.home.move.root"),
    depth: 0,
    level: 1,
    parentId: null,
    hasChildren: false,
    root: true,
    reason: rootReason,
    disabled: rootReason !== null,
  };
  const flat = flattenTree(folders, expanded);
  const folderEntries: PickerRow[] = flat.map((row) => {
    const reason = disabledReason(row.node.id);
    return {
      key: row.node.id,
      id: row.node.id,
      label: row.node.title || t("documents.detail.untitled"),
      depth: row.depth + 1,
      level: row.depth + 1,
      parentId: row.parentId,
      hasChildren: row.hasChildren,
      root: false,
      reason,
      disabled: reason !== null,
    };
  });
  const pickerRows: PickerRow[] = [rootEntry, ...folderEntries];

  const registerRef = (key: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusedKey(key);
    rowRefs.current.get(key)?.focus();
  };

  const toggle = (folderId: string) => {
    if (expanded.has(folderId) && focusedKey !== ROOT_KEY && focusedKey !== folderId && subtreeIds(folders, folderId).has(focusedKey)) {
      focusRow(folderId);
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleRowKeyDown = (row: PickerRow, index: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(pickerRows[index + 1]?.key);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(pickerRows[index - 1]?.key ?? pickerRows[0]?.key);
        break;
      case "ArrowRight":
        if (row.hasChildren && row.id) {
          event.preventDefault();
          if (!expanded.has(row.id)) {
            toggle(row.id);
          } else {
            const firstChild = pickerRows[index + 1];
            if (firstChild && firstChild.parentId === row.id) focusRow(firstChild.key);
          }
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.hasChildren && row.id && expanded.has(row.id)) {
          toggle(row.id);
        } else if (row.parentId) {
          focusRow(row.parentId);
        }
        break;
      case "Home":
        event.preventDefault();
        focusRow(pickerRows[0]?.key);
        break;
      case "End":
        event.preventDefault();
        focusRow(pickerRows[pickerRows.length - 1]?.key);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!row.disabled) setPicked(row.id);
        break;
      default:
        break;
    }
  };

  const activeStopKey =
    (pickerRows.some((row) => row.key === focusedKey) ? focusedKey : null) ??
    (picked !== undefined && pickerRows.some((row) => row.id === picked) ? rowKey(picked) : null) ??
    pickerRows[0]?.key ??
    ROOT_KEY;

  const submitBlocked = pending || picked === undefined || disabledReason(picked) !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending} closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          role="tree"
          aria-label={pickerLabel ?? t("documents.home.move.picker_label")}
          className="max-h-72 overflow-y-auto rounded-md border border-border p-1"
        >
          {pickerRows.map((row, index) => {
            const selected = picked !== undefined && picked === row.id && !row.disabled;
            const isExpanded = row.hasChildren && row.id !== null && expanded.has(row.id);
            const labelId = `${baseId}-label-${row.key}`;
            const reasonId = `${baseId}-reason-${row.key}`;
            return (
              <div
                key={row.key}
                ref={(el) => registerRef(row.key, el)}
                role="treeitem"
                aria-level={row.level}
                aria-expanded={row.hasChildren ? isExpanded : undefined}
                aria-selected={selected}
                aria-disabled={row.disabled || undefined}
                aria-labelledby={labelId}
                aria-describedby={row.reason ? reasonId : undefined}
                tabIndex={row.key === activeStopKey ? 0 : -1}
                onFocus={() => setFocusedKey(row.key)}
                onKeyDown={handleRowKeyDown(row, index)}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("[data-chevron]")) return;
                  setFocusedKey(row.key);
                  if (!row.disabled) setPicked(row.id);
                }}
                className={cn(
                  "flex min-h-9 w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-body pointer-coarse:min-h-11",
                  row.disabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-accent/60",
                  selected && "bg-accent font-medium",
                )}
                style={{ paddingLeft: `${pickerRowPaddingLeft(row.depth)}px` }}
              >
                {row.hasChildren && row.id ? (
                  <button
                    type="button"
                    data-chevron
                    tabIndex={-1}
                    aria-label={
                      isExpanded
                        ? t("documents.tree.collapse", { title: row.label })
                        : t("documents.tree.expand", { title: row.label })
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (row.id) toggle(row.id);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:-mx-2.5 pointer-coarse:size-11"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
                    />
                  </button>
                ) : (
                  <span aria-hidden className="size-6 shrink-0" />
                )}
                {row.root ? (
                  <FolderRoot aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span id={labelId} title={row.label} className="block truncate">
                    {row.label}
                  </span>
                  {row.reason ? (
                    <span id={reasonId} title={row.reason} className="block truncate text-caption text-muted-foreground">
                      {row.reason}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="px-0 pb-0">
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onOpenChange(false);
            }}
          >
            {t("documents.upload.cancel")}
          </Button>
          <Button
            type="button"
            aria-disabled={submitBlocked || undefined}
            aria-busy={pending || undefined}
            onClick={() => {
              if (!submitBlocked && picked !== undefined) onSubmit(picked);
            }}
          >
            {pending ? <Spinner aria-hidden role="presentation" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

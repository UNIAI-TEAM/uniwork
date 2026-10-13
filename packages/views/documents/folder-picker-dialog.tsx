"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, FolderRoot } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { foldersOnly } from "./document-tree-model";

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  /** The workspace forest (folders are picked from it). */
  tree: DocumentTreeNode[];
  /** Preselected: the folder the library has open, or null for the root. */
  initialFolderId: string | null;
  /** A folder the server would refuse as the target, with everything under it
   *  (the moved folder itself, its subtree, a level past the depth limit). */
  refuse?: (folderId: string) => boolean;
  pending: boolean;
  error: string | null;
  onSubmit: (folderId: string | null) => void;
}

function flatFolders(
  nodes: DocumentTreeNode[],
  refuse: ((folderId: string) => boolean) | undefined,
  depth = 0,
): { node: DocumentTreeNode; depth: number }[] {
  return nodes.flatMap((node) => (refuse?.(node.id) ? [] : [{ node, depth }, ...flatFolders(node.children, refuse, depth + 1)]));
}

/**
 * Pick a folder (or the workspace root): "Save to folder" for a file from
 * another module, and "Move" for a library row. Nothing is written until the
 * submit; the server decides and the caller shows its refusal here.
 */
export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  tree,
  initialFolderId,
  refuse,
  pending,
  error,
  onSubmit,
}: FolderPickerDialogProps) {
  const { t } = useTranslation();
  const folders = useMemo(() => flatFolders(foldersOnly(tree), refuse), [tree, refuse]);
  const [picked, setPicked] = useState<string | null>(initialFolderId);
  useEffect(() => {
    if (open) setPicked(initialFolderId);
  }, [open, initialFolderId]);

  const option = (id: string | null, label: string, depth: number, root = false) => (
      <button
        key={id ?? "root"}
        type="button"
        aria-pressed={picked === id}
        onClick={() => setPicked(id)}
        className={cn(
          "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-body hover:bg-accent/60 pointer-coarse:min-h-11",
          picked === id && "bg-accent font-medium",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {root ? <FolderRoot aria-hidden className="size-4 text-muted-foreground" /> : <Folder aria-hidden className="size-4 text-muted-foreground" />}
        <span className="truncate">{label}</span>
      </button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending} closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div role="group" aria-label={t("documents.home.save_source.picker_label")} className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
          {option(null, t("documents.home.save_source.root"), 0, true)}
          {folders.map(({ node, depth }) => option(node.id, node.title || t("documents.detail.untitled"), depth + 1))}
        </div>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="px-0 pb-0">
          <Button type="button" variant="outline" aria-disabled={pending || undefined} onClick={() => { if (!pending) onOpenChange(false); }}>
            {t("documents.upload.cancel")}
          </Button>
          <Button type="button" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={() => { if (!pending) onSubmit(picked); }}>
            {pending ? <Spinner aria-hidden role="presentation" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

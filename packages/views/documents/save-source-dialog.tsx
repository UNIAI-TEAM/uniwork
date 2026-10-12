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

export interface SaveSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The file being saved; its name is the new document's title. */
  name: string;
  /** The workspace forest (folders are picked from it). */
  tree: DocumentTreeNode[];
  /** Preselected: the folder the library has open, or null for the root. */
  initialFolderId: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (folderId: string | null) => void;
}

function flatFolders(nodes: DocumentTreeNode[], depth = 0): { node: DocumentTreeNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatFolders(node.children, depth + 1)]);
}

/**
 * "Save to folder" for a file that lives in another module: pick a folder (or
 * the workspace root) and the server copies the bytes into a new document.
 * Nothing is written until Save; the original stays where it is.
 */
export function SaveSourceDialog({ open, onOpenChange, name, tree, initialFolderId, pending, error, onSubmit }: SaveSourceDialogProps) {
  const { t } = useTranslation();
  const folders = useMemo(() => flatFolders(foldersOnly(tree)), [tree]);
  const [picked, setPicked] = useState<string | null>(initialFolderId);
  useEffect(() => {
    if (open) setPicked(initialFolderId);
  }, [open, initialFolderId]);

  const option = (id: string | null, label: string, depth: number, root = false) => (
      <button
        key={id ?? "root"}
        type="button"
        role="radio"
        aria-checked={picked === id}
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
          <DialogTitle>{t("documents.home.save_source.title")}</DialogTitle>
          <DialogDescription>{t("documents.home.save_source.description", { name })}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t("documents.home.save_source.picker_label")} className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
          {option(null, t("documents.home.save_source.root"), 0, true)}
          {folders.map(({ node, depth }) => option(node.id, node.title || t("documents.detail.untitled"), depth + 1))}
        </div>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="px-0 pb-0">
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("documents.upload.cancel")}
          </Button>
          <Button type="button" disabled={pending} aria-busy={pending || undefined} onClick={() => onSubmit(picked)}>
            {pending ? <Spinner aria-hidden role="presentation" /> : null}
            {t("documents.home.save_source.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

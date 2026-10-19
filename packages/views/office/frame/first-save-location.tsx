"use client";

import { useId } from "react";
import { Folder, FolderLock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMyFolder, type DocumentBreadcrumb, type DocumentTreeNode } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";

/** The folders from the root down to `id`, or null when the loaded forest does not hold it. */
function pathTo(nodes: DocumentTreeNode[], id: string): DocumentTreeNode[] | null {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const below = pathTo(node.children, id);
    if (below) return [node, ...below];
  }
  return null;
}

/**
 * The first-save Location text for a folder: its path from the root, My Folder
 * by its own label (the personal root keeps its lock glyph), the workspace root
 * by the Move-to root label. While the forest is still loading, the document's
 * own breadcrumbs stand in for the folder it already sits in.
 */
export function describeLocation(
  tree: DocumentTreeNode[] | undefined,
  folderId: string | null,
  fallbackCrumbs: DocumentBreadcrumb[],
  t: (key: string) => string,
): { label: string; myFolder: boolean } {
  if (folderId === null) return { label: t("documents.home.move.root"), myFolder: false };
  const nodes = tree ? pathTo(tree, folderId) : null;
  const names = nodes
    ? nodes.map((node) => (isMyFolder(node) ? t("documents.home.my_folder.label") : node.title))
    : fallbackCrumbs.map((crumb) => crumb.title);
  const label = names.map((name) => name || t("documents.detail.untitled")).join(" / ");
  return {
    label: label || t("documents.detail.untitled"),
    myFolder: isMyFolder(nodes?.[nodes.length - 1]),
  };
}

/** The Location row of the first-save dialog: where the document will be, and a way to change it. */
export function FirstSaveLocation({
  label,
  myFolder,
  disabled,
  onChange,
}: {
  label: string;
  myFolder: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const Glyph = myFolder ? FolderLock : Folder;
  return (
    <div data-testid="first-save-location" role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <span id={labelId} className="text-body leading-none font-medium">
        {t("documents.detail.first_save.location")}
      </span>
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-border py-1 pr-1 pl-2.5">
        <Glyph aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span title={label} className="min-w-0 flex-1 truncate text-body">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onChange();
          }}
        >
          {t("documents.detail.first_save.change")}
        </Button>
      </div>
    </div>
  );
}

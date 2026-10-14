"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock, FolderTree, House, Plus, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentSourceKind } from "@uniwork/core/documents/sources-schema";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { DocumentTree } from "./document-tree";
import { FolderNameDialog } from "./folder-name-dialog";

/** What the library shows: a collection, or one module's files (null = every module). */
export type LibraryView =
  | { kind: "home" }
  | { kind: "recent" }
  | { kind: "starred" }
  | { kind: "shared" }
  | { kind: "archived" }
  | { kind: "sources"; source: DocumentSourceKind | null };

export const SOURCE_KINDS: readonly DocumentSourceKind[] = ["chat", "meeting", "email", "task"];

export const SOURCE_ICONS: Record<DocumentSourceKind, LucideIcon> = {
  chat: MODULE_ICONS.chat,
  meeting: MODULE_ICONS.meetings,
  email: MODULE_ICONS.email,
  task: MODULE_ICONS.tasks,
};

export interface DocumentsSidebarProps {
  wsId: string;
  view: LibraryView;
  folderId: string | null;
  /** Number of starred documents in this workspace, once known. */
  starredCount: number | null;
  /** False when the sources API is not deployed: the section is hidden. */
  sourcesAvailable: boolean;
  /** View-only callers see no "new folder" control. */
  canCreate: boolean;
  /** A folder is being created: the "+" holds still until the server answers. */
  newFolderPending?: boolean;
  /** False while a host sheet is closed. */
  open?: boolean;
  onView: (view: LibraryView) => void;
  onFolder: (folderId: string) => void;
  onNewFolder: (title?: string) => Promise<boolean | void> | boolean | void;
  className?: string;
}

function NavItem({
  icon: Icon,
  label,
  count,
  current,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number | null;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-9 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
        current && "bg-accent font-medium",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="font-mono text-caption tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </button>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-4 flex shrink-0 items-center justify-between px-2 pb-1">
      <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

/**
 * The left navigation of the Documents home: the collections, the folder tree
 * (folders only, drag to reorganise) and the files that live in other modules.
 */
export function DocumentsSidebar({
  wsId,
  view,
  folderId,
  starredCount,
  sourcesAvailable,
  canCreate,
  newFolderPending = false,
  open = true,
  onView,
  onFolder,
  onNewFolder,
  className,
}: DocumentsSidebarProps) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);

  const isView = (kind: LibraryView["kind"]) => view.kind === kind && !(kind === "home" && folderId);

  const openCreateDialog = () => {
    if (newFolderPending) return;
    setCreateOpen(true);
  };

  return (
    <nav aria-label={t("documents.home.sidebar.label")} className={cn("flex min-h-0 flex-col overflow-y-auto p-2", className)}>
      <NavItem icon={House} label={t("documents.home.sidebar.home")} current={isView("home")} onClick={() => onView({ kind: "home" })} />
      <NavItem icon={Clock} label={t("documents.home.sidebar.recent")} current={isView("recent")} onClick={() => onView({ kind: "recent" })} />
      <NavItem icon={Star} label={t("documents.home.sidebar.starred")} count={starredCount} current={isView("starred")} onClick={() => onView({ kind: "starred" })} />
      <NavItem icon={Users} label={t("documents.home.sidebar.shared")} current={isView("shared")} onClick={() => onView({ kind: "shared" })} />

      <SectionLabel
        action={
          canCreate ? (
            <button
              type="button"
              onClick={openCreateDialog}
              aria-disabled={newFolderPending || undefined}
              aria-label={t("documents.home.folders.new")}
              title={t("documents.home.folders.new")}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11"
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
          ) : null
        }
      >
        {t("documents.home.sidebar.folders")}
      </SectionLabel>
      <DocumentTree
        wsId={wsId}
        folders
        visible={open}
        currentId={folderId}
        onOpen={onFolder}
        emptyLabel={t("documents.home.folders.empty")}
        className="shrink-0 overflow-visible p-0"
      />

      {sourcesAvailable ? (
        <>
          <SectionLabel>{t("documents.home.sidebar.elsewhere")}</SectionLabel>
          {SOURCE_KINDS.map((source) => (
            <NavItem
              key={source}
              icon={SOURCE_ICONS[source]}
              label={t(`documents.home.origin.${source}`)}
              current={view.kind === "sources" && view.source === source}
              onClick={() => onView({ kind: "sources", source })}
            />
          ))}
        </>
      ) : null}

      <FolderNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        root
        wsId={wsId}
        initialName={t("documents.home.folders.default_name")}
        pending={newFolderPending}
        onSubmit={(title) => onNewFolder(title)}
      />
    </nav>
  );
}

/** The same navigation in a left sheet below `xl`. */
export function DocumentsSidebarSheet({
  open,
  onOpenChange,
  ...sidebar
}: DocumentsSidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        initialFocus={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xs"
        closeLabel={t("common.close")}
      >
        <SheetHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-title">
            <FolderTree aria-hidden className="size-4 text-muted-foreground" />
            {t("documents.tree.sheet_title")}
          </SheetTitle>
          <SheetDescription className="mt-0.5">{t("documents.tree.sheet_description")}</SheetDescription>
        </SheetHeader>
        <DocumentsSidebar {...sidebar} open={open} className="flex-1" />
      </SheetContent>
    </Sheet>
  );
}

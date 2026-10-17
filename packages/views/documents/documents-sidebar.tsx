"use client";

import { useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FolderTree, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentSourceKind } from "@uniwork/core/documents/sources-schema";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone, type ModuleKey } from "../layout/module-tones";
import { DOCUMENTS_NAV_ICONS } from "./documents-nav-icons";
import { DocumentTree } from "./document-tree";
import { FolderNameDialog } from "./folder-name-dialog";

/** What the library shows: a collection, or one module's files (null = every module). */
export type LibraryView =
  | { kind: "home" }
  | { kind: "recent" }
  | { kind: "starred" }
  | { kind: "shared" }
  | { kind: "shelved" }
  | { kind: "archived" }
  | { kind: "sources"; source: DocumentSourceKind | null };

export const SOURCE_KINDS: readonly DocumentSourceKind[] = ["chat", "meeting", "email", "task"];

/** The module each source row stands for: it takes that module's glyph and tint. */
const SOURCE_MODULES: Record<DocumentSourceKind, ModuleKey> = {
  chat: "chat",
  meeting: "meetings",
  email: "email",
  task: "tasks",
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
  /** A host may supply its own folder tree while reusing the collection navigation. */
  folderTree?: ReactNode;
}

function NavItem({
  icon: Icon,
  module,
  label,
  count,
  current,
  onClick,
}: {
  /** A plain row: one muted line glyph, no tile. */
  icon?: LucideIcon;
  /** A row that lives in another module: drawn like the app sidebar draws it. */
  module?: ModuleKey;
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
      {module ? (
        <IconTile icon={MODULE_ICONS[module]} size="xs" variant="solid" tone={moduleTone(module)} />
      ) : Icon ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
        </span>
      ) : null}
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
  folderTree,
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
      <NavItem icon={DOCUMENTS_NAV_ICONS.home} label={t("documents.home.sidebar.home")} current={isView("home")} onClick={() => onView({ kind: "home" })} />
      <NavItem icon={DOCUMENTS_NAV_ICONS.recent} label={t("documents.home.sidebar.recent")} current={isView("recent")} onClick={() => onView({ kind: "recent" })} />
      <NavItem icon={DOCUMENTS_NAV_ICONS.starred} label={t("documents.home.sidebar.starred")} count={starredCount} current={isView("starred")} onClick={() => onView({ kind: "starred" })} />
      <NavItem icon={DOCUMENTS_NAV_ICONS.shared} label={t("documents.home.sidebar.shared")} current={isView("shared")} onClick={() => onView({ kind: "shared" })} />

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
      {folderTree ?? <DocumentTree
        wsId={wsId}
        folders
        visible={open}
        currentId={folderId}
        onOpen={onFolder}
        emptyLabel={t("documents.home.folders.empty")}
        className="shrink-0 overflow-visible p-0"
      />}

      {sourcesAvailable ? (
        <>
          <SectionLabel>{t("documents.home.sidebar.elsewhere")}</SectionLabel>
          {SOURCE_KINDS.map((source) => (
            <NavItem
              key={source}
              module={SOURCE_MODULES[source]}
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
  const popupRef = useRef<HTMLDivElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={popupRef}
        side="left"
        initialFocus={() => {
          const popup = popupRef.current;
          if (!popup) return true;
          if (sidebar.folderId) {
            return popup.querySelector<HTMLElement>('[role="treeitem"][aria-current="true"]') ?? popup;
          }
          return popup.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? true;
        }}
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

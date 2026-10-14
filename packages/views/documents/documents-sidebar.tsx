"use client";

import { useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock, FolderTree, House, Plus, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FOLDER_TITLE_MAX } from "@uniwork/core/documents";
import type { DocumentSourceKind } from "@uniwork/core/documents/sources-schema";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
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
        "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-body text-foreground transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
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
    <div className="mt-4 flex items-center justify-between px-2 pb-1">
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
  onView,
  onFolder,
  onNewFolder,
  className,
}: DocumentsSidebarProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const busy = submitting || newFolderPending;

  const isView = (kind: LibraryView["kind"]) => view.kind === kind && !(kind === "home" && folderId);

  const openCreateDialog = () => {
    if (busy) return;
    setDraftName(t("documents.home.folders.default_name"));
    setNameError(null);
    setCreateOpen(true);
  };

  const submitRootFolder = async () => {
    if (submittingRef.current || newFolderPending) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setNameError(t("documents.home.folders.name_empty"));
      return;
    }
    if (trimmed.length > FOLDER_TITLE_MAX) {
      setNameError(t("documents.home.folders.name_too_long", { max: FOLDER_TITLE_MAX }));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ok = await onNewFolder(trimmed);
      if (ok !== false) setCreateOpen(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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
              aria-disabled={busy || undefined}
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
        currentId={folderId}
        onOpen={onFolder}
        emptyLabel={t("documents.home.folders.empty")}
        className="overflow-visible p-0"
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

      <Dialog open={createOpen} onOpenChange={(next) => (busy ? undefined : setCreateOpen(next))}>
        <DialogContent className="sm:max-w-md" showCloseButton={!busy} closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("documents.home.folders.create_title_root")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRootFolder();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>{t("documents.home.folders.rename_label")}</Label>
              <Input
                id={inputId}
                value={draftName}
                placeholder={t("documents.home.folders.name_placeholder")}
                disabled={busy}
                onChange={(event) => {
                  setDraftName(event.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            </div>
            {nameError ? (
              <p role="alert" className="text-caption text-destructive">
                {nameError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!busy) setCreateOpen(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" aria-disabled={busy || undefined}>
                {t("documents.home.folders.create_submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
      <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-xs" closeLabel={t("common.close")}>
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-title">
            <FolderTree aria-hidden className="size-4 text-muted-foreground" />
            {t("documents.tree.sheet_title")}
          </SheetTitle>
          <SheetDescription className="mt-0.5">{t("documents.tree.sheet_description")}</SheetDescription>
        </SheetHeader>
        <DocumentsSidebar {...sidebar} className="flex-1" />
      </SheetContent>
    </Sheet>
  );
}

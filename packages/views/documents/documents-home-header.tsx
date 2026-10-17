"use client";

import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useUpdateDocument } from "@uniwork/core/documents/hooks";
import { isMyFolder, type Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { CollectionPageHeader } from "../layout/collection-page";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import type { LibraryRowHandlers } from "./documents-library-row";
import { folderMenuItems } from "./documents-folders-grid";
import { DocumentsSearchBox } from "./documents-search-box";
import type { UseDocumentsSearchResult } from "./use-documents-search";
import { FolderBreadcrumb } from "./folder-breadcrumb";
import { CreateMenu, QuickCreateRow, type CreateChoicesProps } from "./documents-home-create";

/**
 * The single header row of the Documents home board (Main.dc) and the open
 * folder (Folder.dc): h1 "Tài liệu của workspace", or the breadcrumb above the
 * folder name with its ⋯ menu, then search, Tải lên, Tạo mới. These views
 * have no collection header (TRASH-A3).
 */

export interface DocumentsHomeHeaderProps {
  wsId: string;
  /** The open folder, or null at the workspace root. */
  folderDoc: Document | null;
  /** The viewer may rename the open folder in the breadcrumb. */
  canRename: boolean;
  /** The caller's personal root folder id, once known, so ancestor crumbs use the i18n label. */
  myFolderId?: string | null;
  onRoot: () => void;
  onFolder: (folderId: string) => void;
  /** The commands the open folder's ⋯ menu may offer (its own level gates them). */
  folderHandlers: Pick<LibraryRowHandlers, "onNewSubfolder" | "onRename" | "onMove" | "onArchive" | "onToggleStar" | "isStarred">;
  search: UseDocumentsSearchResult;
  canCreate: boolean;
  create: CreateChoicesProps;
  /** Host extras beside the create buttons (Office launch, the access report, the mobile nav). */
  actions?: React.ReactNode;
}

export function DocumentsHomeHeader({ wsId, folderDoc, canRename, myFolderId = null, onRoot, onFolder, folderHandlers, search, canCreate, create, actions }: DocumentsHomeHeaderProps) {
  const { t } = useTranslation();
  const rename = useUpdateDocument(wsId, folderDoc?.id ?? "");
  const myFolder = isMyFolder(folderDoc);
  const folderLabel = folderDoc
    ? (myFolder ? t("documents.home.my_folder.label") : folderDoc.title) || t("documents.detail.untitled")
    : t("documents.home.sidebar.home");
  const menuItems = folderDoc ? folderMenuItems(folderDoc, folderHandlers, t) : [];
  const starred = Boolean(folderDoc && folderHandlers.isStarred(folderDoc.id));
  const canMenu = Boolean(folderDoc) && (menuItems.length > 0 || Boolean(folderHandlers.onToggleStar));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        {folderDoc ? (
          <FolderBreadcrumb
            path={[
              ...folderDoc.breadcrumbs
                .filter((crumb) => crumb.id !== folderDoc.id)
                .map(({ id, title }) => ({
                  id,
                  title: id === myFolderId ? t("documents.home.my_folder.label") : title,
                })),
              { id: folderDoc.id, title: folderLabel },
            ]}
            canRename={canRename && !myFolder}
            renaming={rename.isPending}
            onRoot={onRoot}
            onFolder={onFolder}
            onRename={(title) => {
              if (myFolder) return;
              void rename
                .mutateAsync({ patch: { revision: folderDoc.revision, title } })
                .catch((error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.folders.rename_failed")));
            }}
          />
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-title font-semibold">{folderLabel}</h1>
          {folderDoc && canMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("documents.home.folder.menu")}
                    title={t("documents.home.folder.menu")}
                    className="shrink-0"
                  />
                }
              >
                <Ellipsis aria-hidden className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                {folderHandlers.onToggleStar ? (
                  <DropdownMenuItem
                    className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                    onClick={() => folderHandlers.onToggleStar?.(folderDoc.id, starred)}
                  >
                    {t(starred ? "documents.home.row.unstar" : "documents.home.row.star")}
                  </DropdownMenuItem>
                ) : null}
                {menuItems.map((item) => (
                  <DropdownMenuItem key={item.id} className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={item.run}>
                    <item.icon aria-hidden className="size-4" />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      <DocumentsSearchBox
        search={search}
        folderPlaceholder={Boolean(folderDoc)}
        className="order-last basis-full sm:order-none sm:w-56 sm:basis-auto md:w-64"
      />
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {canCreate ? <CreateMenu {...create} /> : null}
      </div>
    </div>
  );
}

/**
 * Under the home header, for people who may create here: the Tạo nhanh strip
 * and the root-create hint at the workspace root (the "only you see it" note
 * waits on MYFOLDER-01), the info line naming the open folder inside one.
 */
export function DocumentsHomeNote({ folderTitle, create }: { folderTitle: string | null; create: CreateChoicesProps | null }) {
  const { t } = useTranslation();
  if (folderTitle !== null) {
    return <p className="text-caption text-muted-foreground">{t("documents.home.folder.info_banner", { folder: folderTitle })}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {create ? <QuickCreateRow {...create} /> : null}
      <p className="text-caption text-muted-foreground">{t("documents.home.quick_create.hint_root")}</p>
    </div>
  );
}

/** The collection header the list views (Recent, Starred, Shared, Elsewhere) and the gate states keep. */
export function DocumentsCollectionHeader({ search, children }: { search: UseDocumentsSearchResult | null; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <CollectionPageHeader
      icon={MODULE_ICONS.documents}
      tone={moduleTone("documents")}
      title={t("documents.page.title")}
      className={
        search
          ? "h-auto min-h-12 flex-wrap py-2 sm:h-12 sm:flex-nowrap sm:py-0 [&>div:last-child]:contents sm:[&>div:last-child]:flex"
          : undefined
      }
      actions={
        search ? (
          <>
            <DocumentsSearchBox search={search} className="order-last basis-full sm:order-first sm:basis-auto sm:w-48 md:w-64" />
            <div className="flex shrink-0 items-center gap-2">{children}</div>
          </>
        ) : null
      }
    />
  );
}

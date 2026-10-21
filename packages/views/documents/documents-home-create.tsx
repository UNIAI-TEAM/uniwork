"use client";

import { useState } from "react";
import { ChevronDown, FolderUp, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DocumentTypeIcon } from "./document-type-icon";
import {
  CREATE_MENU_TYPES,
  CREATE_TYPES,
  quickCreateTypes,
  type CreateMenuType,
  type CreateType,
} from "./documents-create";

export interface CreateChoicesProps {
  pending: boolean;
  unavailable: ReadonlySet<CreateType>;
  /** A create is always private; sharing is chosen in the first-save dialog or the Share dialog (UNI-2038). */
  onCreate: (type: CreateType) => void;
  /** The type this person created last here; the Tạo nhanh strip adds a pill for it when it is not one of the fixed four. */
  recentType?: CreateType | null;
  onUpload: () => void;
  /** Present when the server takes folder uploads (UNI-2052): the toolbar Upload opens a files / folder menu and the New menu gets "Tải lên thư mục". Absent = the same toolbar control uploads files at once. */
  onUploadFolder?: () => void;
  /** Present when a folder is open: adds "Mới → Thư mục" to the New menu (FD-D9). A folder is never shared, so the toggle does not apply to it (UNI-1974). */
  onNewFolder?: () => void;
}

/**
 * The "Tạo nhanh" pill strip under the home header (Main.dc): one pill per
 * create type, only at the workspace root. A type the server cannot create
 * yet stays visible, disabled with the availability hint.
 */
export function QuickCreateRow({
  pending,
  unavailable,
  onCreate,
  recentType,
}: Pick<CreateChoicesProps, "pending" | "unavailable" | "onCreate" | "recentType">) {
  const { t } = useTranslation();

  return (
    <section aria-label={t("documents.home.quick_create.label")} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-caption text-muted-foreground">{t("documents.home.quick_create.label")}</span>
      {quickCreateTypes(recentType).map((type) => {
        const off = unavailable.has(type);
        const hint = off ? t("documents.home.create.unavailable_hint") : t(`documents.home.create.${type}.hint`);
        return (
          <button
            key={type}
            type="button"
            aria-disabled={pending || off || undefined}
            title={hint}
            onClick={() => {
              if (pending || off) return;
              onCreate(type);
            }}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-3 text-caption text-foreground transition-colors hover:bg-accent/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 pointer-coarse:h-11",
            )}
          >
            <DocumentTypeIcon format={type} className="size-6" decorative />
            {t(`documents.home.create.${type}.chip`)}
            {off ? <span className="sr-only">— {hint}</span> : null}
          </button>
        );
      })}
    </section>
  );
}

/** The header "Tải lên" button plus the "Tạo mới ▾" menu with the same types, and Folder inside an open folder. */
export function CreateMenu({
  pending,
  unavailable,
  onCreate,
  onUpload,
  onUploadFolder,
  onNewFolder,
}: CreateChoicesProps) {
  const { t } = useTranslation();
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const menuTypes: readonly CreateMenuType[] = onNewFolder ? CREATE_MENU_TYPES : CREATE_TYPES;
  return (
    <>
      {/* One control from first paint: while the config has not said folder upload is available the trigger is a plain button that uploads files, then it opens the files / folder menu. The same Button node renders in both states, so focus and layout stay put (RF15). */}
      <DropdownMenu
        open={uploadMenuOpen && onUploadFolder !== undefined}
        onOpenChange={setUploadMenuOpen}
      >
        <DropdownMenuTrigger
          render={(props) =>
            onUploadFolder ? (
              <Button {...props} type="button" variant="outline" size="sm" className="hidden sm:inline-flex" />
            ) : (
              <Button
                ref={props.ref}
                type="button"
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={onUpload}
              >
                {props.children}
              </Button>
            )
          }
        >
          <Upload aria-hidden className="size-3.5" />
          {t("documents.folder_upload.menu_label")}
          {onUploadFolder ? <ChevronDown aria-hidden className="size-3.5" /> : null}
        </DropdownMenuTrigger>
        {onUploadFolder ? (
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={onUpload}>
              <Upload aria-hidden className="size-4" />
              {t("documents.folder_upload.menu_file")}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={onUploadFolder}>
              <FolderUp aria-hidden className="size-4" />
              {t("documents.folder_upload.menu_folder")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" size="sm" aria-disabled={pending || undefined} />}
        >
          <Plus aria-hidden className="size-3.5" />
          {t("documents.home.create.menu")}
          <ChevronDown aria-hidden className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          {menuTypes.map((type) =>
            type === "folder" ? (
              <div key={type}>
                <DropdownMenuItem
                  className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                  disabled={pending}
                  onClick={() => onNewFolder?.()}
                >
                  <DocumentTypeIcon format="folder" className="size-4" decorative />
                  <span className="flex-1">{t("documents.home.create.folder.menu")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </div>
            ) : (
              <div key={type}>
                <DropdownMenuItem
                  className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                  disabled={pending || unavailable.has(type)}
                  onClick={() => onCreate(type)}
                >
                  <DocumentTypeIcon format={type} className="size-4" decorative />
                  <span className="flex-1">{t(`documents.home.create.${type}.menu`)}</span>
                  <span className="font-mono text-caption text-muted-foreground">
                    {t(`documents.home.create.${type}.ext`)}
                  </span>
                </DropdownMenuItem>
                {type === "page" ? <DropdownMenuSeparator /> : null}
              </div>
            ),
          )}
          <DropdownMenuSeparator className={onUploadFolder ? undefined : "sm:hidden"} />
          <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11 sm:hidden" onClick={onUpload}>
            <Upload aria-hidden className="size-4" />
            {t("documents.home.create.upload.button")}
          </DropdownMenuItem>
          {onUploadFolder ? (
            <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={onUploadFolder}>
              <FolderUp aria-hidden className="size-4" />
              {t("documents.folder_upload.menu_folder")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

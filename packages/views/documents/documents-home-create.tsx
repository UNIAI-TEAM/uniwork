"use client";

import { ChevronDown, Plus, Upload } from "lucide-react";
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
import { CREATE_MENU_TYPES, CREATE_TYPES, type CreateMenuType, type CreateType } from "./documents-create";

export interface CreateChoicesProps {
  pending: boolean;
  unavailable: ReadonlySet<CreateType>;
  onCreate: (type: CreateType) => void;
  onUpload: () => void;
  /** Present when a folder is open: adds "Mới → Thư mục" to the New menu (FD-D9). */
  onNewFolder?: () => void;
}

/**
 * The "Tạo nhanh" pill strip under the home header (Main.dc): one pill per
 * create type, only at the workspace root. A type the server cannot create
 * yet stays visible, disabled with the availability hint.
 */
export function QuickCreateRow({ pending, unavailable, onCreate }: Pick<CreateChoicesProps, "pending" | "unavailable" | "onCreate">) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("documents.home.quick_create.label")} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-caption text-muted-foreground">{t("documents.home.quick_create.label")}</span>
      {CREATE_TYPES.map((type) => {
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
export function CreateMenu({ pending, unavailable, onCreate, onUpload, onNewFolder }: CreateChoicesProps) {
  const { t } = useTranslation();
  const menuTypes: readonly CreateMenuType[] = onNewFolder ? CREATE_MENU_TYPES : CREATE_TYPES;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={onUpload}>
        <Upload aria-hidden className="size-3.5" />
        {t("documents.home.create.upload.button")}
      </Button>
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
          <DropdownMenuSeparator className="sm:hidden" />
          <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11 sm:hidden" onClick={onUpload}>
            <Upload aria-hidden className="size-4" />
            {t("documents.home.create.upload.button")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

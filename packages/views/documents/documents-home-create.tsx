"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { DocumentTypeIcon } from "./document-type-icon";
import {
  CREATE_MENU_TYPES,
  CREATE_TYPES,
  type CreateMenuType,
  type CreateShareOptions,
  type CreateType,
} from "./documents-create";

export interface CreateShareToggleState {
  shareWithWorkspace: boolean;
  setShareWithWorkspace: (next: boolean) => void;
}

export interface CreateChoicesProps {
  pending: boolean;
  unavailable: ReadonlySet<CreateType>;
  /** True when the open folder already shares with its home workspace. */
  parentShared?: boolean;
  /**
   * One shared toggle state for the strip and the menu (TV1-15). When the
   * caller renders both controls it passes the same pair, so the "Chia sẻ
   * với workspace" label never shows two different states at once; a caller
   * that renders a lone control leaves it undefined and the control keeps
   * its own default-off state.
   */
  shareToggle?: CreateShareToggleState;
  /** Always called with the share options the toggle resolved, so a wrapped or bound handler still gets them. */
  onCreate: (type: CreateType, options: CreateShareOptions) => void;
  onUpload: () => void;
  /** Present when a folder is open: adds "Mới → Thư mục" to the New menu (FD-D9). The menu's toggle state rides along. */
  onNewFolder?: (options: CreateShareOptions) => void;
}

/**
 * The "Tạo nhanh" pill strip under the home header (Main.dc): one pill per
 * create type, only at the workspace root. A type the server cannot create
 * yet stays visible, disabled with the availability hint.
 */
export function QuickCreateRow({
  pending,
  unavailable,
  parentShared = false,
  shareToggle,
  onCreate,
}: Pick<CreateChoicesProps, "pending" | "unavailable" | "parentShared" | "shareToggle" | "onCreate">) {
  const { t } = useTranslation();
  const [localShare, setLocalShare] = useState(false);
  const shareWithWorkspace = shareToggle?.shareWithWorkspace ?? localShare;
  const setShareWithWorkspace = shareToggle?.setShareWithWorkspace ?? setLocalShare;
  const hintId = useId();
  const effectiveShare = parentShared || shareWithWorkspace;
  const sendShare = effectiveShare && !parentShared;
  const hintText = parentShared
    ? t("documents.home.create.share_workspace_inherited")
    : effectiveShare
      ? t("documents.home.create.share_workspace_hint", {
          level: t("documents.home.create.share_workspace_level_view"),
        })
      : null;

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
              setShareWithWorkspace(false);
              onCreate(type, { shareWithWorkspace: sendShare });
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
      <label className="ml-1 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 text-caption text-foreground pointer-coarse:min-h-11">
        <Switch
          size="sm"
          checked={effectiveShare}
          aria-disabled={parentShared || pending || undefined}
          aria-describedby={hintText ? hintId : undefined}
          onCheckedChange={(next) => {
            if (parentShared || pending) return;
            setShareWithWorkspace(next);
          }}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        />
        <span>{t("documents.home.create.share_workspace_toggle")}</span>
      </label>
      {/* Always mounted and one line tall, so switching the toggle neither moves the pills nor goes unannounced. */}
      <p id={hintId} role="status" className="min-h-4 w-full text-caption text-muted-foreground">
        {hintText}
      </p>
    </section>
  );
}

/** The header "Tải lên" button plus the "Tạo mới ▾" menu with the same types, and Folder inside an open folder. */
export function CreateMenu({
  pending,
  unavailable,
  parentShared = false,
  shareToggle,
  onCreate,
  onUpload,
  onNewFolder,
}: CreateChoicesProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [localShare, setLocalShare] = useState(false);
  const shareWithWorkspace = shareToggle?.shareWithWorkspace ?? localShare;
  const setShareWithWorkspace = shareToggle?.setShareWithWorkspace ?? setLocalShare;
  const hintId = useId();
  const effectiveShare = parentShared || shareWithWorkspace;
  const sendShare = effectiveShare && !parentShared;
  const hintText = parentShared
    ? t("documents.home.create.share_workspace_inherited")
    : effectiveShare
      ? t("documents.home.create.share_workspace_hint", {
          level: t("documents.home.create.share_workspace_level_view"),
        })
      : null;
  const menuTypes: readonly CreateMenuType[] = onNewFolder ? CREATE_MENU_TYPES : CREATE_TYPES;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={onUpload}>
        <Upload aria-hidden className="size-3.5" />
        {t("documents.home.create.upload.button")}
      </Button>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          // A lone menu (no shared state) keeps the default-off-per-open rule.
          if (next && !shareToggle) setShareWithWorkspace(false);
        }}
      >
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
                  onClick={() => onNewFolder?.({ shareWithWorkspace: sendShare })}
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
                  onClick={() => onCreate(type, { shareWithWorkspace: sendShare })}
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
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            closeOnClick={false}
            checked={effectiveShare}
            aria-disabled={parentShared || pending || undefined}
            aria-label={t("documents.home.create.share_workspace_toggle")}
            aria-describedby={hintId}
            onCheckedChange={(next) => {
              if (parentShared || pending) return;
              setShareWithWorkspace(next);
            }}
            className="gap-2 px-2 py-2 pointer-coarse:min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {/* TV2-04: pr-6 keeps the hint line clear of the check indicator at the item's right edge. */}
            <span className="flex flex-1 flex-col pr-6">
              <span>{t("documents.home.create.share_workspace_toggle")}</span>
              {/* Inside the item so aria-describedby resolves within it; a live region so the change is announced. */}
              <span id={hintId} role="status" className="text-caption font-normal text-muted-foreground">
                {hintText}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

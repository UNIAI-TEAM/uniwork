"use client";

import { useState } from "react";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";
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
import { RestrictedMenuItem, RestrictedToggle } from "./documents-restricted-toggle";
import { CREATE_MENU_TYPES, CREATE_TYPES, type CreateMenuType, type CreateType } from "./documents-create";

/** Which greeting the hour gets: morning until 11, afternoon until 18, evening after. */
export function greetingPart(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 4 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "afternoon";
  return "evening";
}

export interface DocumentsGreetingProps {
  name: string | null;
  /** The open folder's title; null at the workspace root. */
  folderTitle: string | null;
  /** The viewer cannot create here (a view-only folder): no "what to create" line. */
  readOnly?: boolean;
  /** Injected in tests; defaults to the current hour. */
  now?: Date;
}

/** "Good morning, An. What would you like to create today?" (user decision 5). */
export function DocumentsGreeting({ name, folderTitle, readOnly = false, now }: DocumentsGreetingProps) {
  const { t } = useTranslation();
  const part = greetingPart((now ?? new Date()).getHours());
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-title font-semibold text-foreground">
        {readOnly
          ? t(name ? `documents.home.greeting.${part}_read_only_named` : `documents.home.greeting.${part}_read_only`, { name })
          : name
            ? t(`documents.home.greeting.${part}_named`, { name })
            : t(`documents.home.greeting.${part}`)}
      </h2>
      <p className="text-body text-muted-foreground">
        {readOnly
          ? folderTitle
            ? t("documents.home.greeting.hint_read_only", { folder: folderTitle })
            : t("documents.home.greeting.hint_read_only_plain")
          : folderTitle
            ? t("documents.home.greeting.hint_folder", { folder: folderTitle })
            : t("documents.home.greeting.hint_root")}
      </p>
    </div>
  );
}

export interface CreateChoicesProps {
  pending: boolean;
  unavailable: ReadonlySet<CreateType>;
  /** `restricted` is true only when the user switched "Restricted" on (never when it is inherited). */
  onCreate: (type: CreateType, restricted: boolean) => void;
  onUpload: () => void;
  /** Present when a folder is open: adds "Mới → Thư mục" to the New menu (FD-D9). */
  onNewFolder?: (restricted: boolean) => void;
  /** The server declares `documents.create_visibility`: only then can a file be created restricted. */
  filesRestrictable: boolean;
  /** The open folder is restricted: the switch shows on and locked, and nothing is sent. */
  parentRestricted: boolean;
}

function cardTitle(type: CreateType, t: (key: string) => string): string {
  return t(`documents.home.create.${type}.card`);
}

/**
 * The create cards: one per type plus "Upload file". On a phone they are one
 * horizontal strip (390 px design); from `sm` up a grid of four columns.
 */
export function CreateCards({ pending, unavailable, onCreate, onUpload, filesRestrictable, parentRestricted }: CreateChoicesProps) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const restricted = pressed && !parentRestricted;
  // An older server would drop the field and make a workspace-wide file: block, never guess.
  const filesBlocked = restricted && !filesRestrictable;
  const card =
    "group flex min-h-24 w-36 shrink-0 flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:w-auto sm:p-4";
  return (
    <div className="flex flex-col gap-3">
      <RestrictedToggle pressed={pressed} locked={parentRestricted} onPressedChange={setPressed} />
      <ul
        aria-label={t("documents.home.create.label")}
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4"
      >
        {CREATE_TYPES.map((type) => {
          const off = unavailable.has(type) || (type !== "page" && filesBlocked);
          return (
            <li key={type} className="flex">
              <button
                type="button"
                className={cn(card, "w-36 sm:w-full")}
                aria-disabled={pending || off || undefined}
                onClick={() => {
                  if (pending || off) return;
                  onCreate(type, restricted);
                }}
              >
                <DocumentTypeIcon format={type} className="size-8" decorative />
                <span className="flex items-center gap-1.5 text-body font-medium text-foreground">
                  {cardTitle(type, t)}
                  {type === "page" ? null : (
                    <Badge variant="secondary" className="px-1.5 text-caption">
                      {t("documents.home.create.ai_badge")}
                    </Badge>
                  )}
                </span>
                <span className="text-caption text-muted-foreground">
                  {off ? t("documents.home.create.unavailable_hint") : t(`documents.home.create.${type}.hint`)}
                </span>
              </button>
            </li>
          );
        })}
        <li className="flex">
          <button type="button" className={cn(card, "w-36 sm:w-full")} onClick={onUpload}>
            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Upload aria-hidden className="size-4" />
            </span>
            <span className="text-body font-medium text-foreground">{t("documents.home.create.upload.card")}</span>
            <span className="text-caption text-muted-foreground">{t("documents.home.create.upload.hint")}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}

/** The header "New ▾" button with the same list as the cards, plus Folder inside an open folder. */
export function CreateMenu({
  pending,
  unavailable,
  onCreate,
  onUpload,
  onNewFolder,
  filesRestrictable,
  parentRestricted,
}: CreateChoicesProps) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const restricted = pressed && !parentRestricted;
  const filesBlocked = restricted && !filesRestrictable;
  const menuTypes: readonly CreateMenuType[] = onNewFolder ? CREATE_MENU_TYPES : CREATE_TYPES;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={onUpload}>
        <Upload aria-hidden className="size-3.5" />
        {t("documents.home.create.upload.card")}
      </Button>
      <DropdownMenu
        onOpenChange={(open) => {
          // The signed default is workspace: every opening starts from "off".
          if (open) setPressed(false);
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
          <RestrictedMenuItem pressed={pressed} locked={parentRestricted} onPressedChange={setPressed} />
          <DropdownMenuSeparator />
          {menuTypes.map((type) =>
            type === "folder" ? (
              <div key={type}>
                <DropdownMenuItem
                  className="gap-2 px-2 py-2 pointer-coarse:min-h-11"
                  disabled={pending}
                  onClick={() => onNewFolder?.(restricted)}
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
                  disabled={pending || unavailable.has(type) || (type !== "page" && filesBlocked)}
                  onClick={() => onCreate(type, restricted)}
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
            {t("documents.home.create.upload.card")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

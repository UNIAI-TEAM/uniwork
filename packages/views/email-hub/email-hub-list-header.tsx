"use client";

import type { Ref } from "react";
import { Archive, MailOpen, Mail, Paperclip, PenSquare, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { EmailHubAccountMenu, type EmailHubAccountMenuProps } from "./email-hub-account-menu";
import { EmailHubFolderMenu } from "./email-hub-folder-menu";
import type { EmailHubFolderNavProps } from "./email-hub-folder-sidebar";
import { emailHubFolderDef } from "./email-hub-folders";
import { emailHubFilterChipClass } from "./email-hub-ui";

/** An icon-only action with the same name as its tooltip. */
export function EmailHubIconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
  className,
}: {
  icon: typeof Mail;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("text-muted-foreground hover:text-foreground", className)}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <Icon className={cn("size-4.5", spinning && "animate-spin")} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface EmailHubBulkActions {
  count: number;
  allChecked: boolean;
  onToggleAll: (checked: boolean) => void;
  onClear: () => void;
  onMarkRead: (read: boolean) => void;
  onArchive?: () => void;
  onTrash?: () => void;
  pending: boolean;
}

function BulkBar({ bulk }: { bulk: EmailHubBulkActions }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1" role="toolbar" aria-label={t("email_hub.bulk.toolbar")}>
      <span className="inline-flex size-10 items-center justify-center">
        <Checkbox
          checked={bulk.allChecked}
          indeterminate={!bulk.allChecked}
          onCheckedChange={(value) => bulk.onToggleAll(value === true)}
          aria-label={t("email_hub.bulk.select_all")}
        />
      </span>
      <span className="mr-2 text-body font-medium tabular-nums" aria-live="polite">
        {t("email_hub.bulk.selected", { count: bulk.count })}
      </span>
      <EmailHubIconAction
        icon={MailOpen}
        label={t("email_hub.bulk.mark_read")}
        disabled={bulk.pending}
        onClick={() => bulk.onMarkRead(true)}
      />
      <EmailHubIconAction
        icon={Mail}
        label={t("email_hub.bulk.mark_unread")}
        disabled={bulk.pending}
        onClick={() => bulk.onMarkRead(false)}
      />
      {bulk.onArchive ? (
        <EmailHubIconAction icon={Archive} label={t("email_hub.archive")} disabled={bulk.pending} onClick={bulk.onArchive} />
      ) : null}
      {bulk.onTrash ? (
        <EmailHubIconAction
          icon={Trash2}
          label={t("email_hub.trash")}
          disabled={bulk.pending}
          className="hover:text-destructive"
          onClick={bulk.onTrash}
        />
      ) : null}
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={bulk.onClear}>
        {t("email_hub.bulk.clear")}
      </Button>
    </div>
  );
}

export interface EmailHubListHeaderProps {
  nav: EmailHubFolderNavProps;
  accountMenu: EmailHubAccountMenuProps;
  isScheduledFolder: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  refreshDisabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  hasAttachmentsOnly: boolean;
  onToggleAttachmentsOnly: () => void;
  countText: string | null;
  lastSyncText: string | null;
  composeDisabled: boolean;
  onCompose: () => void;
  bulk: EmailHubBulkActions | null;
  searchRef?: Ref<HTMLInputElement>;
}

/**
 * Title, search, filters and — while threads are checked — the bulk actions.
 * Below `lg` it also carries the folder menu, the mailbox switcher and
 * compose, which the sidebar holds on larger screens.
 */
export function EmailHubListHeader({
    nav,
    accountMenu,
    isScheduledFolder,
    searchInput,
    onSearchInputChange,
    refreshDisabled,
    refreshing,
    onRefresh,
    unreadOnly,
    onToggleUnreadOnly,
    hasAttachmentsOnly,
    onToggleAttachmentsOnly,
    countText,
    lastSyncText,
    composeDisabled,
    onCompose,
  bulk,
  searchRef,
}: EmailHubListHeaderProps) {
  const { t } = useTranslation();
  const folderLabel = nav.selectedLabel ?? t(emailHubFolderDef(nav.folder).labelKey);

  return (
    <header className="shrink-0 space-y-2 border-b border-border px-3 pt-3 pb-2 lg:px-4">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 lg:hidden">
          <EmailHubFolderMenu {...nav} />
        </div>
        <h2 className="hidden min-w-0 truncate px-1 text-title font-semibold lg:block">{folderLabel}</h2>
        {countText ? (
          <span className="hidden shrink-0 px-1 text-caption tabular-nums text-muted-foreground sm:inline">
            {countText}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <EmailHubIconAction
            icon={RefreshCw}
            label={t("email_hub.refresh")}
            disabled={refreshDisabled}
            spinning={refreshing}
            onClick={onRefresh}
          />
          <div className="lg:hidden">
            <EmailHubAccountMenu {...accountMenu} compact />
          </div>
          <Button
            type="button"
            variant="brand"
            size="icon-lg"
            className="lg:hidden"
            aria-label={t("email_hub.compose_label")}
            disabled={composeDisabled}
            onClick={onCompose}
          >
            <PenSquare aria-hidden />
          </Button>
        </div>
      </div>

      {bulk && bulk.count > 0 ? (
        <BulkBar bulk={bulk} />
      ) : !isScheduledFolder ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <label htmlFor="email-hub-search" className="sr-only">
              {t("email_hub.search_label")}
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchRef}
              id="email-hub-search"
              type="search"
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchInput) {
                  e.preventDefault();
                  onSearchInputChange("");
                }
              }}
              placeholder={t("email_hub.search_placeholder")}
              className="h-9 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchInput ? (
              <button
                type="button"
                className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("email_hub.search_clear")}
                onClick={() => onSearchInputChange("")}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <Kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={emailHubFilterChipClass(unreadOnly)}
              aria-pressed={unreadOnly}
              onClick={onToggleUnreadOnly}
            >
              {t("email_hub.filters.unread")}
            </button>
            <button
              type="button"
              className={emailHubFilterChipClass(hasAttachmentsOnly)}
              aria-pressed={hasAttachmentsOnly}
              onClick={onToggleAttachmentsOnly}
            >
              <Paperclip className="size-3.5" aria-hidden />
              {t("email_hub.filters.attachments")}
            </button>
          </div>
          {lastSyncText ? (
            <span className="ml-auto hidden text-caption text-muted-foreground xl:inline">{lastSyncText}</span>
          ) : null}
        </div>
      ) : null}
      {countText ? <p className="text-caption tabular-nums text-muted-foreground sm:hidden">{countText}</p> : null}
    </header>
  );
}

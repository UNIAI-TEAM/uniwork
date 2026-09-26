"use client";

import { ChevronDown, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import type { EmailHubFolderNavProps } from "./email-hub-folder-sidebar";
import { EMAIL_HUB_ALL_FOLDERS, emailHubFolderBadge, emailHubFolderDef } from "./email-hub-folders";
import { emailHubCountBadgeClass } from "./email-hub-ui";

/**
 * Folder and label picker below `lg`. The full sidebar used to stack above the
 * list inside a fixed-height frame, so on a phone the list — and the email you
 * opened — sat below a screen of folders that could not be scrolled past.
 */
export function EmailHubFolderMenu({
  folder,
  selectedLabel,
  imapLabels,
  counts,
  onFolderChange,
  onLabelChange,
}: EmailHubFolderNavProps) {
  const { t } = useTranslation();
  const current = emailHubFolderDef(folder);
  const CurrentIcon = selectedLabel ? Tag : current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-10 min-w-0 items-center gap-2 rounded-control px-2 text-title-sm font-semibold transition-colors duration-(--duration-fast) hover:bg-muted aria-expanded:bg-muted pointer-coarse:min-h-11"
        aria-label={t("email_hub.folder_menu", { folder: selectedLabel ?? t(current.labelKey) })}
      >
        <CurrentIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{selectedLabel ?? t(current.labelKey)}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70dvh] min-w-60">
        <DropdownMenuGroup>
          {EMAIL_HUB_ALL_FOLDERS.map((def) => {
            const Icon = def.icon;
            const badge = emailHubFolderBadge(def.key, counts);
            const active = folder === def.key && !selectedLabel;
            return (
              <DropdownMenuItem
                key={def.key}
                className={cn(active && "bg-brand-subtle text-brand-subtle-foreground")}
                onClick={() => {
                  onLabelChange(null);
                  onFolderChange(def.key);
                }}
              >
                <Icon aria-hidden />
                <span className="flex-1">{t(def.labelKey)}</span>
                {badge ? <span className={cn(emailHubCountBadgeClass, "bg-muted")}>{badge}</span> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        {imapLabels.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("email_hub.labels_section")}</DropdownMenuLabel>
              {imapLabels.map((label) => (
                <DropdownMenuItem
                  key={label}
                  className={cn(selectedLabel === label && "bg-brand-subtle text-brand-subtle-foreground")}
                  onClick={() => {
                    onFolderChange("INBOX");
                    onLabelChange(selectedLabel === label ? null : label);
                  }}
                >
                  <Tag aria-hidden />
                  <span className="truncate">{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown, Lock, Mail, PenSquare, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { EmailHubAccountMenu, type EmailHubAccountMenuProps } from "./email-hub-account-menu";
import {
  EMAIL_HUB_MORE_FOLDERS,
  EMAIL_HUB_PRIMARY_FOLDERS,
  emailHubFolderBadge,
  type EmailHubFolderCounts,
  type EmailHubFolderDef,
  type EmailHubFolderKey,
} from "./email-hub-folders";
import { emailHubCountBadgeClass, emailHubNavItemClass } from "./email-hub-ui";

export type { EmailHubFolderKey } from "./email-hub-folders";

const LABELS_PREVIEW = 6;

export interface EmailHubFolderNavProps {
  folder: EmailHubFolderKey;
  selectedLabel: string | null;
  imapLabels: string[];
  counts: EmailHubFolderCounts;
  onFolderChange: (folder: EmailHubFolderKey) => void;
  onLabelChange: (label: string | null) => void;
}

function FolderNavButton({
  def,
  active,
  badge,
  onClick,
}: {
  def: EmailHubFolderDef;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = def.icon;
  return (
    <li>
      <button
        type="button"
        className={emailHubNavItemClass(active)}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{t(def.labelKey)}</span>
        {badge ? (
          <span className={cn(emailHubCountBadgeClass, active ? "bg-background/70" : "bg-muted text-foreground")}>
            {badge}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Folder and label navigation, from `lg` up. Below it the list header carries `EmailHubFolderMenu`. */
export function EmailHubFolderSidebar({
  folder,
  selectedLabel,
  imapLabels,
  counts,
  onFolderChange,
  onLabelChange,
  composeDisabled,
  onCompose,
  accountMenu,
}: EmailHubFolderNavProps & {
  composeDisabled: boolean;
  onCompose: () => void;
  accountMenu: EmailHubAccountMenuProps;
}) {
  const { t } = useTranslation();
  const inMore = EMAIL_HUB_MORE_FOLDERS.some((f) => f.key === folder);
  const [moreOpen, setMoreOpen] = useState(inMore);
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const visibleLabels = labelsExpanded ? imapLabels : imapLabels.slice(0, LABELS_PREVIEW);

  const pickFolder = (key: EmailHubFolderKey) => {
    onLabelChange(null);
    onFolderChange(key);
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
      <div className="space-y-3 px-3 pt-4 pb-3">
        <h1 className="flex items-center gap-2.5 px-1 text-title font-semibold">
          <IconTile icon={Mail} tone={moduleTone("email")} size="sm" />
          {t("email_hub.title")}
        </h1>
        <EmailHubAccountMenu {...accountMenu} />
        <Button
          variant="brand"
          size="lg"
          className="w-full justify-start gap-2"
          disabled={composeDisabled}
          onClick={onCompose}
        >
          <PenSquare aria-hidden />
          {t("email_hub.compose_label")}
          <Kbd className="ml-auto bg-brand-foreground/15 text-brand-foreground">C</Kbd>
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label={t("email_hub.folders_nav")}>
        <ul className="space-y-0.5">
          {EMAIL_HUB_PRIMARY_FOLDERS.map((def) => (
            <FolderNavButton
              key={def.key}
              def={def}
              active={folder === def.key && !selectedLabel}
              badge={emailHubFolderBadge(def.key, counts)}
              onClick={() => pickFolder(def.key)}
            />
          ))}
          <li>
            <button
              type="button"
              className={emailHubNavItemClass(false)}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 transition-transform duration-(--duration-fast)",
                  !moreOpen && "-rotate-90",
                )}
                aria-hidden
              />
              <span className="flex-1 truncate text-left">
                {moreOpen ? t("email_hub.folders.less") : t("email_hub.folders.more")}
              </span>
            </button>
          </li>
          {moreOpen
            ? EMAIL_HUB_MORE_FOLDERS.map((def) => (
                <FolderNavButton
                  key={def.key}
                  def={def}
                  active={folder === def.key && !selectedLabel}
                  onClick={() => pickFolder(def.key)}
                />
              ))
            : null}
        </ul>

        <h2 className="mt-5 mb-1.5 px-2.5 text-overline text-muted-foreground">{t("email_hub.labels_section")}</h2>
        {imapLabels.length === 0 ? (
          <p className="px-2.5 text-caption text-pretty text-muted-foreground">{t("email_hub.labels_sync_hint")}</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {visibleLabels.map((label) => {
                const active = selectedLabel === label;
                return (
                  <li key={label}>
                    <button
                      type="button"
                      className={emailHubNavItemClass(active)}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        onFolderChange("INBOX");
                        onLabelChange(active ? null : label);
                      }}
                    >
                      <Tag className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate text-left">{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {imapLabels.length > LABELS_PREVIEW ? (
              <button
                type="button"
                className={cn(emailHubNavItemClass(false), "text-caption")}
                onClick={() => setLabelsExpanded((v) => !v)}
              >
                <span className="pl-6.5">
                  {labelsExpanded
                    ? t("email_hub.labels_show_less")
                    : t("email_hub.labels_show_more", { count: imapLabels.length - LABELS_PREVIEW })}
                </span>
              </button>
            ) : null}
          </>
        )}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-border px-5 py-3 text-caption text-muted-foreground">
        <Tag className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("email_hub.labels_rules")}</span>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-medium">
          <Lock className="size-3" aria-hidden />
          {t("email_hub.coming_soon")}
        </span>
      </div>
    </aside>
  );
}

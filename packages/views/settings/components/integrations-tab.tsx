"use client";

import { Lock, Mail, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEmailHubAccounts } from "@uniwork/core/email-hub/hooks";
import { paths } from "@uniwork/core/paths";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../../layout/module-tones";
import { useWorkspace } from "../../layout/workspace-context";
import { AppLink } from "../../navigation";
import { SettingsBadge, SettingsList, SettingsListItem, SettingsSection, SettingsTab } from "./settings-layout";

/**
 * Only integrations the roadmap actually commits to; each cites its line.
 * Nothing here is clickable until it ships.
 */
const PLANNED = [
  // docs/roadmap/FEATURE_ROADMAP.md A-10 (Email integration: Gmail / Microsoft
  // Graph), docs/vision/PROJECT_VISION.md §5.2 mục 18.
  { key: "mail_oauth", icon: Mail },
  // docs/roadmap/FEATURE_ROADMAP.md A-07 (Webhook ký HMAC + SDK TypeScript),
  // docs/vision/PROJECT_VISION.md (webhook ký HMAC cho sự kiện domain).
  { key: "webhooks", icon: Webhook },
] as const;

/**
 * Email Hub is the one connection that works today: each person links their
 * own Gmail, Outlook or Yahoo mailbox with an app password
 * (server/internal/emailhub/provider.go). The count is the reader's own.
 */
function EmailHubRow() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations" });
  const { workspace } = useWorkspace();
  const accounts = useEmailHubAccounts(workspace.id);
  const href = paths.workspace(workspace.organization_slug, workspace.slug).email();
  const count = accounts.data?.accounts.length ?? 0;
  // Until the list arrives (or when it fails) nothing is known about the
  // reader's mailboxes, so neither the badge nor the action claims "none".
  const known = !accounts.isLoading && !accounts.isError;

  const badge = accounts.isLoading ? (
    <Skeleton className="h-5 w-24" />
  ) : accounts.isError ? (
    <SettingsBadge tone="destructive">{t("email_hub.load_error")}</SettingsBadge>
  ) : count > 0 ? (
    <SettingsBadge tone="success">{t("email_hub.connected", { count })}</SettingsBadge>
  ) : (
    <SettingsBadge tone="muted">{t("email_hub.not_connected")}</SettingsBadge>
  );

  return (
    <SettingsListItem
      leading={<IconTile icon={Mail} tone={moduleTone("email")} size="sm" />}
      title={t("email_hub.title")}
      meta={t("email_hub.meta")}
      badge={badge}
      actions={
        <AppLink href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {known && count === 0 ? t("email_hub.connect") : t("email_hub.open")}
        </AppLink>
      }
    />
  );
}

export function IntegrationsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });

  return (
    <SettingsTab title={t("page.tabs.integrations")} description={t("integrations.description")}>
      <SettingsSection title={t("integrations.available")}>
        <SettingsList aria-label={t("integrations.available")}>
          <EmailHubRow />
        </SettingsList>
      </SettingsSection>
      <SettingsSection title={t("integrations.planned")} description={t("integrations.planned_description")}>
        <SettingsList aria-label={t("integrations.planned")}>
          {PLANNED.map(({ key, icon }) => (
            <SettingsListItem
              key={key}
              muted
              leading={<IconTile icon={icon} tone="muted" size="sm" />}
              title={t(`integrations.${key}.title`)}
              meta={t(`integrations.${key}.meta`)}
              badge={
                <SettingsBadge tone="muted" icon={<Lock aria-hidden />}>
                  {t("integrations.coming_soon")}
                </SettingsBadge>
              }
            />
          ))}
        </SettingsList>
      </SettingsSection>
    </SettingsTab>
  );
}

"use client";

import { useState } from "react";
import { Lock, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEmailHubAccounts } from "@uniwork/core/email-hub/hooks";
import { paths } from "@uniwork/core/paths";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../../layout/module-icons";
import { moduleTone } from "../../layout/module-tones";
import { useWorkspace } from "../../layout/workspace-context";
import { AppLink, useNavigation } from "../../navigation";
import { DriveIntegrationRow, type CallbackNotice } from "./drive-integration-row";
import { DriveIntegrationView } from "./drive-integration-view";
import { SettingsBadge, SettingsList, SettingsListItem, SettingsSection, SettingsTab } from "./settings-layout";

/**
 * Only integrations the roadmap actually commits to; each cites its line.
 * Nothing here is clickable until it ships.
 *
 * Google Drive shipped into the available list with UNI-2186
 * (docs/roadmap/FEATURE_ROADMAP.md C-20 / UNI-2172;
 * docs/superpowers/specs/2026-10-26-google-drive-connector-design.md §5.2).
 */
const PLANNED = [
  // docs/roadmap/FEATURE_ROADMAP.md A-07 (Webhook ký HMAC + SDK TypeScript),
  // docs/vision/PROJECT_VISION.md (webhook ký HMAC cho sự kiện domain).
  { key: "webhooks", icon: Webhook },
] as const;

/**
 * Email Hub is the one connection that works today: each person links their
 * own mailbox by signing in with Google or Microsoft
 * (server/internal/service/email_hub_oauth_callback.go), with an app password for
 * Gmail, Outlook or Yahoo (server/internal/emailhub/provider.go), or on their
 * own domain's IMAP/SMTP server (server/internal/service/email_hub_connect_server.go).
 * The count is the reader's own.
 */
function EmailHubRow() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations" });
  const { workspace } = useWorkspace();
  const accounts = useEmailHubAccounts(workspace.id);
  const href = paths.workspace(workspace.organization_slug, workspace.slug).email();
  const count = accounts.data?.accounts.length ?? 0;
  const broken = accounts.data?.accounts.filter((acc) => acc.needs_reconnect).length ?? 0;
  // Until the list arrives (or when it fails) nothing is known about the
  // reader's mailboxes, so neither the badge nor the action claims "none".
  const known = !accounts.isLoading && !accounts.isError;

  const badge = accounts.isLoading ? (
    <Skeleton className="h-5 w-24" />
  ) : accounts.isError ? (
    <SettingsBadge tone="destructive">{t("email_hub.load_error")}</SettingsBadge>
  ) : count > 0 ? (
    <SettingsBadge tone={broken > 0 ? "warning" : "success"}>
      {t("email_hub.connected", { count })}
      {broken > 0 ? t("email_hub.needs_reconnect", { count: broken }) : null}
    </SettingsBadge>
  ) : (
    <SettingsBadge tone="muted">{t("email_hub.not_connected")}</SettingsBadge>
  );

  return (
    <SettingsListItem
      leading={<IconTile icon={MODULE_ICONS.email} tone={moduleTone("email")} size="sm" />}
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

const INTEGRATION_QUERY_KEY = "integration";

export function IntegrationsTab({
  focusDriveRow,
  onDriveRowFocused,
}: {
  focusDriveRow?: boolean;
  onDriveRowFocused?: () => void;
} = {}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const navigation = useNavigation();
  const [initialDriveNotice, setInitialDriveNotice] = useState<CallbackNotice | null>(null);

  const activeIntegration = navigation.searchParams.get(INTEGRATION_QUERY_KEY);
  const connectFromUrl = navigation.searchParams.get("connect");
  const showDriveView =
    activeIntegration === "drive" && !focusDriveRow && connectFromUrl !== "drive";

  const openDriveView = (notice?: CallbackNotice) => {
    setInitialDriveNotice(notice ?? null);
    const params = new URLSearchParams(navigation.searchParams);
    params.set("tab", "integrations");
    params.set(INTEGRATION_QUERY_KEY, "drive");
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  };

  const closeDriveView = () => {
    setInitialDriveNotice(null);
    const params = new URLSearchParams(navigation.searchParams);
    params.delete(INTEGRATION_QUERY_KEY);
    if (!params.get("tab")) {
      params.set("tab", "integrations");
    }
    const qs = params.toString();
    navigation.replace(qs ? `${navigation.pathname}?${qs}` : navigation.pathname);
  };

  if (showDriveView) {
    return <DriveIntegrationView initialNotice={initialDriveNotice} onBack={closeDriveView} />;
  }

  return (
    <SettingsTab title={t("page.tabs.integrations")} description={t("integrations.description")}>
      <SettingsSection title={t("integrations.available")}>
        <SettingsList aria-label={t("integrations.available")}>
          <DriveIntegrationRow
            focusDriveRow={focusDriveRow}
            onDriveRowFocused={onDriveRowFocused}
            onOpenDriveView={openDriveView}
          />
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

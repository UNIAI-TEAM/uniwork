"use client";

import { useMemo } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubscription } from "@uniwork/core/billing";
import {
  useDocumentSettings,
  useSetDocumentPublicLinks,
} from "@uniwork/core/documents/hooks-sharing";
import { useOrgMembership } from "@uniwork/core/organizations";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { useWorkspace } from "../../layout/workspace-context";
import { QuotaMeterRow } from "./quota-meter";
import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsRow,
  SettingsSection,
  SettingsTab,
  SettingsTabSkeleton,
} from "./settings-layout";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Organization document settings (C-01 §5.3; G1-08, UNI-682): the public-links
 * switch and the real plan state behind it.
 *
 * Read and write are the same gate: an organization owner/admin sees the
 * switch and the entitlement/quota rows; anyone else gets one sentence saying
 * who can change it. The switch starts from the server's answer — an
 * untouched organization answers the default (off) — and a read that cannot be
 * trusted shows the unknown note instead of a fabricated position. The
 * entitlement (`documents.public_links`) and the `storage.bytes` quota come
 * from the subscription endpoint, never from a made-up number.
 */
export function DocumentsSettings() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.documents" });
  const { workspace } = useWorkspace();
  const membership = useOrgMembership(workspace.organization_slug);
  const isAdmin = !!membership.data && ADMIN_ROLES.has(membership.data.role);
  const subscription = useSubscription(workspace.organization_id);
  const settings = useDocumentSettings(workspace.organization_id, { enabled: isAdmin });
  const setLinks = useSetDocumentPublicLinks(workspace.organization_id);

  const entitlements = useMemo(() => subscription.data?.entitlements ?? [], [subscription.data]);
  const linksEntitlement = useMemo(
    () => entitlements.find((row) => row.feature_key === "documents.public_links"),
    [entitlements],
  );
  const storageEntitlement = useMemo(
    () => entitlements.find((row) => row.feature_key === "storage.bytes"),
    [entitlements],
  );

  if (membership.isLoading) return <SettingsTabSkeleton />;

  if (!isAdmin) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsEmpty icon={<ShieldCheck aria-hidden className="size-5" />}>
          {t("admin_only")}
        </SettingsEmpty>
      </SettingsTab>
    );
  }

  const linksKnown = settings.isSuccess && !!settings.data;
  const linksEnabled = settings.data?.public_links_enabled ?? false;

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("entitlement_title")}>
        <SettingsCard>
          <SettingsCardBody>
            <SettingsRow
              label={linksEntitlement?.name || t("entitlement_links")}
              description={linksEntitlement ? `documents.public_links` : undefined}
            >
              {linksEntitlement?.enabled ? (
                <SettingsBadge tone="success">{t("entitlement_enabled")}</SettingsBadge>
              ) : (
                <SettingsBadge tone="muted">{t("entitlement_disabled")}</SettingsBadge>
              )}
            </SettingsRow>
          </SettingsCardBody>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("quota_title")}>
        <SettingsCard>
          <SettingsCardBody>
            {storageEntitlement ? (
              <QuotaMeterRow
                label={storageEntitlement.name || t("quota_label")}
                description={t("quota_description")}
                used={storageEntitlement.current_usage ?? 0}
                limit={storageEntitlement.quota_limit ?? null}
                unit="bytes"
              />
            ) : (
              <SettingsRow label={t("quota_label")} description={t("quota_description")}>
                <span className="text-caption text-muted-foreground">{t("entitlement_disabled")}</span>
              </SettingsRow>
            )}
          </SettingsCardBody>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("links_toggle_label")}>
        <SettingsCard>
          <SettingsCardBody>
            <SettingsRow
              label={
                <span className="flex items-center gap-2">
                  <FileText aria-hidden className="size-4 text-muted-foreground" />
                  {t("links_toggle_label")}
                </span>
              }
              description={t("links_toggle_description")}
            >
              <Switch
                aria-label={t("links_toggle_label")}
                checked={linksEnabled}
                aria-busy={settings.isPending || setLinks.isPending || undefined}
                disabled={subscription.isLoading}
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
                onCheckedChange={(next) => {
                  void setLinks.mutateAsync(next === true).catch(() => undefined);
                }}
              />
            </SettingsRow>
            {!linksKnown ? (
              <p className="px-1 pb-2 text-caption text-muted-foreground">{t("links_state_unknown")}</p>
            ) : null}
            {setLinks.isError ? (
              <p role="alert" className="px-1 pb-2 text-caption text-destructive">
                {t("links_toggle_save_failed")}
              </p>
            ) : null}
            {settings.isError ? (
              <p role="alert" className="px-1 pb-2 text-caption text-destructive">
                {t("links_read_failed")}
              </p>
            ) : null}
          </SettingsCardBody>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

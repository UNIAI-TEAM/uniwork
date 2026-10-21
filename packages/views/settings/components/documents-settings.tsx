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
  SettingsEmpty,
  SettingsLoadError,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
  SettingsTabSkeleton,
  type SettingsSaveStatus,
} from "./settings-layout";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The write's state as the save indicator words it, the same one the notification matrix shows. */
const SAVE_STATUS: Record<"idle" | "pending" | "success" | "error", SettingsSaveStatus> = {
  idle: "idle",
  pending: "saving",
  success: "saved",
  error: "error",
};

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
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
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

  const linksEnabled = settings.data?.public_links_enabled ?? false;
  // The entitlement is read beside the switch; a write waits for it too.
  const busy = settings.isPending || setLinks.isPending || subscription.isLoading;

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("entitlement_title")}>
        <SettingsCard>
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
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("quota_title")}>
        <SettingsCard>
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
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("links_section")}
        action={
          <SettingsSaveState
            status={SAVE_STATUS[setLinks.status]}
            savingLabel={tSave("saving")}
            savedLabel={tSave("saved")}
            errorLabel={t("links_toggle_save_failed")}
          />
        }
      >
        <SettingsCard>
          {/* While the read runs the row keeps its shape instead of a guessed off switch. */}
          {settings.isPending ? (
            <SettingsRowSkeleton />
          ) : (
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
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-3.25"
                onCheckedChange={(next) => {
                  // One write at a time, and never before the read settles; a
                  // failed read stays writable on purpose (links_state_unknown).
                  if (busy) return;
                  void setLinks.mutateAsync(next === true).catch(() => undefined);
                }}
              />
            </SettingsRow>
          )}
          {settings.isError ? (
            <SettingsLoadError onRetry={() => void settings.refetch()}>
              {`${t("links_read_failed")} ${t("links_state_unknown")}`}
            </SettingsLoadError>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

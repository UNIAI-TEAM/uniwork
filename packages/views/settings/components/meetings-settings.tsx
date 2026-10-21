"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingSettings, useSetMeetingAutoSummary } from "@uniwork/core/meetings/settings";
import { useOrgMembership } from "@uniwork/core/organizations";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { useWorkspace } from "../../layout/workspace-context";
import {
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
 * Organization meeting settings (UNI-2026, scribe spec §4.5 D16): whether the
 * system summarizes a meeting once it ends. Same gate and same shape as the
 * document settings: owners/admins see the switch, which starts from the
 * server's answer (an untouched organization answers on); everyone else gets
 * one sentence saying who can change it.
 */
export function MeetingsSettings() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.meetings" });
  const { workspace } = useWorkspace();
  const membership = useOrgMembership(workspace.organization_slug);
  const isAdmin = !!membership.data && ADMIN_ROLES.has(membership.data.role);
  const settings = useMeetingSettings(workspace.organization_id, { enabled: isAdmin });
  const setAuto = useSetMeetingAutoSummary(workspace.organization_id);

  if (membership.isLoading) return <SettingsTabSkeleton />;

  if (!isAdmin) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsEmpty icon={<ShieldCheck aria-hidden className="size-5" />}>{t("admin_only")}</SettingsEmpty>
      </SettingsTab>
    );
  }

  const known = settings.isSuccess && !!settings.data;
  const busy = settings.isPending || setAuto.isPending;

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("auto_summary_title")}>
        <SettingsCard>
          <SettingsCardBody>
            <SettingsRow label={t("auto_summary_label")} description={t("auto_summary_description")}>
              <Switch
                aria-label={t("auto_summary_label")}
                checked={settings.data?.auto_summary_enabled ?? false}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
                onCheckedChange={(next) => {
                  // One write at a time, and never before the read settles.
                  if (busy) return;
                  void setAuto.mutateAsync(next === true).catch(() => undefined);
                }}
              />
            </SettingsRow>
            {!known ? <p className="px-1 pb-2 text-caption text-muted-foreground">{t("state_unknown")}</p> : null}
            {setAuto.isError ? (
              <p role="alert" className="px-1 pb-2 text-caption text-destructive">
                {t("save_failed")}
              </p>
            ) : null}
            {settings.isError ? (
              <p role="alert" className="px-1 pb-2 text-caption text-destructive">
                {t("read_failed")}
              </p>
            ) : null}
          </SettingsCardBody>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

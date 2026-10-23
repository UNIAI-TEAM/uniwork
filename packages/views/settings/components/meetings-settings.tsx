"use client";

import { useId } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingSettings, useSetMeetingAutoSummary } from "@uniwork/core/meetings/settings";
import { useOrgMembership } from "@uniwork/core/organizations";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { useWorkspace } from "../../layout/workspace-context";
import {
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
import { MeetingsScribePolicySection } from "./meetings-scribe-policy";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The write's state as the save indicator words it, the same one the notification matrix shows. */
const SAVE_STATUS: Record<"idle" | "pending" | "success" | "error", SettingsSaveStatus> = {
  idle: "idle",
  pending: "saving",
  success: "saved",
  error: "error",
};

/**
 * Organization meeting settings (UNI-2026, scribe spec §4.5 D16): whether the
 * system summarizes a meeting once it ends, and the AI scribe policy (UNI-1995). Same gate and same shape as the
 * document settings: owners/admins see the switch, which starts from the
 * server's answer (an untouched organization answers on); everyone else gets
 * one sentence saying who can change it.
 */
export function MeetingsSettings() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.meetings" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const { workspace } = useWorkspace();
  const membership = useOrgMembership(workspace.organization_slug);
  const isAdmin = !!membership.data && ADMIN_ROLES.has(membership.data.role);
  const settings = useMeetingSettings(workspace.organization_id, { enabled: isAdmin });
  const setAuto = useSetMeetingAutoSummary(workspace.organization_id);
  const hintId = useId();

  if (membership.isLoading) return <SettingsTabSkeleton />;

  if (!isAdmin) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsEmpty icon={<ShieldCheck aria-hidden className="size-5" />}>{t("admin_only")}</SettingsEmpty>
      </SettingsTab>
    );
  }

  const busy = settings.isPending || setAuto.isPending;
  const saveStatus: SettingsSaveStatus = SAVE_STATUS[setAuto.status];

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection
        title={t("auto_summary_title")}
        action={
          <SettingsSaveState
            status={saveStatus}
            savingLabel={tSave("saving")}
            savedLabel={tSave("saved")}
            errorLabel={t("save_failed")}
          />
        }
      >
        <SettingsCard>
          {/* While the read runs the row keeps its shape, and a failed read
              shows only the failure: an off switch would be a guess, and the
              real default is on. */}
          {settings.isPending ? (
            <SettingsRowSkeleton />
          ) : settings.isError || !settings.data ? (
            <SettingsLoadError onRetry={() => void settings.refetch()}>{t("read_failed")}</SettingsLoadError>
          ) : (
            <SettingsRow
              label={
                <span className="flex items-center gap-2">
                  <Sparkles aria-hidden className="size-4 text-muted-foreground" />
                  {t("auto_summary_label")}
                </span>
              }
              description={t("auto_summary_description")}
              descriptionId={hintId}
            >
              <Switch
                aria-label={t("auto_summary_label")}
                aria-describedby={hintId}
                checked={settings.data.auto_summary_enabled}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-3.25"
                onCheckedChange={(next) => {
                  // One write at a time.
                  if (busy) return;
                  void setAuto.mutateAsync(next === true).catch(() => undefined);
                }}
              />
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
      {settings.data ? <MeetingsScribePolicySection organizationId={workspace.organization_id} settings={settings.data} /> : null}
    </SettingsTab>
  );
}

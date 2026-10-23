"use client";

import { useId, useState } from "react";
import { RotateCcwClock, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingSettings, useSetMeetingAutoSummary, useSetMeetingTranscriptRetention } from "@uniwork/core/meetings/settings";
import { useOrgMembership } from "@uniwork/core/organizations";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { ConfirmDialog } from "../../common/form-dialog";
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

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The windows the server accepts (UNI-1995 #5); "forever" is null. */
const RETENTION_DAYS = [30, 90, 180, 365] as const;
const FOREVER = "forever";

/** The write's state as the save indicator words it, the same one the notification matrix shows. */
const SAVE_STATUS: Record<"idle" | "pending" | "success" | "error", SettingsSaveStatus> = {
  idle: "idle",
  pending: "saving",
  success: "saved",
  error: "error",
};

/**
 * Organization meeting settings (UNI-2026, scribe spec §4.5 D16): whether the
 * system summarizes a meeting once it ends. Same gate and same shape as the
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
  const setRetention = useSetMeetingTranscriptRetention(workspace.organization_id);
  const hintId = useId();
  const retentionHintId = useId();
  // A shorter window deletes for good within the hour: it waits for a confirm.
  const [shrinkTo, setShrinkTo] = useState<number | null>(null);
  const saveRetention = (days: number | null) => void setRetention.mutateAsync(days).catch(() => undefined);

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
      {/* A failed read is said once, in the section above. */}
      {settings.isError ? null : (
        <SettingsSection
          title={t("retention_title")}
          action={
            <SettingsSaveState
              status={SAVE_STATUS[setRetention.status]}
              savingLabel={tSave("saving")}
              savedLabel={tSave("saved")}
              errorLabel={t("save_failed")}
            />
          }
        >
          <SettingsCard>
            {settings.isPending || !settings.data ? (
              <SettingsRowSkeleton />
            ) : (
              <SettingsRow
                label={
                  <span className="flex items-center gap-2">
                    <RotateCcwClock aria-hidden className="size-4 text-muted-foreground" />
                    {t("retention_label")}
                  </span>
                }
                description={t("retention_description")}
                descriptionId={retentionHintId}
              >
                <div className="w-40">
                  <Select
                    aria-label={t("retention_label")}
                    value={settings.data.transcript_retention_days ? String(settings.data.transcript_retention_days) : FOREVER}
                    disabled={setRetention.isPending}
                    onValueChange={(next) => {
                      if (typeof next !== "string" || setRetention.isPending) return;
                      const days = next === FOREVER ? null : Number(next);
                      const current = settings.data?.transcript_retention_days ?? null;
                      if (days !== null && (current === null || days < current)) setShrinkTo(days);
                      else saveRetention(days);
                    }}
                    items={[
                      { value: FOREVER, label: t("retention_forever") },
                      ...RETENTION_DAYS.map((days) => ({ value: String(days), label: t("retention_days", { count: days }) })),
                    ]}
                  />
                </div>
              </SettingsRow>
            )}
          </SettingsCard>
        </SettingsSection>
      )}
      <ConfirmDialog
        open={shrinkTo !== null}
        onOpenChange={(open) => {
          if (!open) setShrinkTo(null);
        }}
        title={t("retention_shrink_title", { days: shrinkTo ?? 0 })}
        description={t("retention_shrink_description", { days: shrinkTo ?? 0 })}
        confirmLabel={t("retention_shrink_confirm")}
        icon={Trash2}
        onConfirm={() => {
          if (shrinkTo !== null) saveRetention(shrinkTo);
          setShrinkTo(null);
        }}
      />
    </SettingsTab>
  );
}

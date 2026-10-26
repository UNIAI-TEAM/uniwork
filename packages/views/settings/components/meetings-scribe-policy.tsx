"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSetMeetingScribePolicy } from "@uniwork/core/meetings/settings";
import { SCRIBE_POLICIES, scribePolicyOf, type MeetingSettings, type ScribePolicy } from "@uniwork/core/types";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { SettingsCard, SettingsCardBody, SettingsSaveState, SettingsSection, type SettingsSaveStatus } from "./settings-layout";

const SAVE_STATUS: Record<"idle" | "pending" | "success" | "error", SettingsSaveStatus> = {
  idle: "idle",
  pending: "saving",
  success: "saved",
  error: "error",
};

/**
 * The organization's AI scribe policy (UNI-1995 access): on for every meeting
 * (the default), the host turns it on, or off for the organization. Rendered
 * by MeetingsSettings once the settings are read, for owners/admins only.
 */
export function MeetingsScribePolicySection({ organizationId, settings }: { organizationId: string; settings: MeetingSettings }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.meetings" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const setPolicy = useSetMeetingScribePolicy(organizationId);
  const id = useId();
  const current = scribePolicyOf(settings.scribe_policy);
  return (
    <SettingsSection
      title={t("scribe_title")}
      description={t("scribe_policy_description")}
      action={
        <SettingsSaveState
          status={SAVE_STATUS[setPolicy.status]}
          savingLabel={tSave("saving")}
          savedLabel={tSave("saved")}
          errorLabel={t("save_failed")}
        />
      }
    >
      <SettingsCard>
        <SettingsCardBody>
          <p id={`${id}-label`} className="mb-3 text-body font-medium text-foreground">
            {t("scribe_policy_label")}
          </p>
          <RadioGroup
            aria-labelledby={`${id}-label`}
            aria-busy={setPolicy.isPending || undefined}
            value={current}
            onValueChange={(value) => {
              const next = SCRIBE_POLICIES.find((p) => p === value);
              // One write at a time.
              if (next && next !== current && !setPolicy.isPending) {
                void setPolicy.mutateAsync(next).catch(() => undefined);
              }
            }}
            className="gap-3"
          >
            {SCRIBE_POLICIES.map((p: ScribePolicy) => (
              <Label
                key={p}
                htmlFor={`${id}-${p}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 font-normal transition-colors hover:bg-surface-hover has-[[data-checked]]:border-primary has-[[data-checked]]:bg-brand-subtle"
              >
                <RadioGroupItem value={p} id={`${id}-${p}`} aria-describedby={`${id}-${p}-hint`} className="mt-0.5" />
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-body font-medium text-foreground">{t(`scribe_policy_${p}`)}</span>
                  <span id={`${id}-${p}-hint`} className="block text-caption text-muted-foreground">
                    {t(`scribe_policy_${p}_hint`)}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </SettingsCardBody>
      </SettingsCard>
    </SettingsSection>
  );
}

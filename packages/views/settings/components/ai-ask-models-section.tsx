"use client";

import { useTranslation } from "react-i18next";
import { useAskModels, useSetAskModels } from "@uniwork/core/ai";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { SettingsCard, SettingsLoadError, SettingsRow, SettingsSection, SettingsSkeletonRows } from "./settings-layout";

const MODEL_KEYS = ["haiku", "sonnet", "opus"] as const;

/** Admin switches for the models members may pick in Ask UNI; "Auto" is always on. */
export function AiAskModelsSection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const { t: ta } = useTranslation(undefined, { keyPrefix: "settings.aiAccess" });
  const models = useAskModels(orgSlug);
  const save = useSetAskModels(orgSlug);
  const enabled = models.data ?? [];

  let body;
  if (models.isPending) body = <SettingsSkeletonRows rows={3} />;
  else if (!models.data) {
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void models.refetch()} />
      </SettingsCard>
    );
  } else {
    body = (
      <SettingsCard>
        <SettingsRow label={ta("askModelsAuto")} description={ta("askModelsAutoNote")}>
          <span />
        </SettingsRow>
        {MODEL_KEYS.map((key) => {
          const name = t(`ai.models.${key}.name`);
          const on = enabled.includes(key);
          return (
            <SettingsRow
              key={key}
              label={name}
              description={t(`ai.models.${key}.description`)}
            >
              <Switch
                aria-label={name}
                checked={on}
                aria-busy={save.isPending || undefined}
                aria-disabled={save.isPending || undefined}
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
                onCheckedChange={(next) => {
                  if (save.isPending) return;
                  const list = MODEL_KEYS.filter((k) => (k === key ? next === true : enabled.includes(k)));
                  void save.mutateAsync(list).catch(() => undefined);
                }}
              />
            </SettingsRow>
          );
        })}
      </SettingsCard>
    );
  }
  return (
    <SettingsSection title={ta("askModelsTitle")} description={ta("askModelsDescription")}>
      {body}
      {models.data ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t("ai.model.opus_note")}</p> : null}
      {save.isError ? <p role="alert" className="px-1 pt-2 text-caption text-destructive">{ta("askModelsSaveFailed")}</p> : null}
    </SettingsSection>
  );
}

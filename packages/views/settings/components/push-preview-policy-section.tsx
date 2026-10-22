"use client";

import { useTranslation } from "react-i18next";
import { usePushPreviewPolicy, useSetPushPreviewPolicy } from "@uniwork/core/organizations";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { toastApiError } from "../../toast-api-error";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

/**
 * Owners and admins hide the words of every chat push in the organization
 * (audit "Security & privacy", push-preview-plaintext): the text of a push
 * passes through Expo, FCM, APNs and the browsers' push services and sits on
 * lock screens. Hidden, a push says only what kind of thing happened, naming
 * no one and nothing (an incoming call keeps the caller). Members never see
 * this section; their phone says when the organization turned it on.
 */
export function PushPreviewPolicySection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "org.push_previews" });
  const { t: tCommon } = useTranslation();
  const policy = usePushPreviewPolicy(orgSlug);
  const set = useSetPushPreviewPolicy(orgSlug);
  if (!policy.data?.can_manage) return null;
  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingsCard>
        <SettingsRow label={t("hide")} description={t("hide_hint")} size="none">
          <Switch
            aria-label={t("hide")}
            checked={policy.data.hidden}
            // Busy, not disabled, while the change runs: disabling would drop focus from the switch just pressed.
            aria-busy={set.isPending || undefined}
            className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
            onCheckedChange={(hidden) => {
              if (set.isPending) return;
              set.mutate(hidden, { onError: (err) => toastApiError(err, tCommon("common.error")) });
            }}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

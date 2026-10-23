"use client";

import { useTranslation } from "react-i18next";
import { useMobileSecurityPolicy, useSetMobileSecurityPolicy } from "@uniwork/core/organizations";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { toastApiError } from "../../toast-api-error";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

type Requirement = "require_app_lock" | "block_screen_capture";

/**
 * Owners and admins set the floor under every member's UniChat on the phone
 * (audit "Security & privacy", privacy-defaults-off): require the app lock
 * (Face ID, a fingerprint or the passcode) and block screenshots and screen
 * recording, which also hides content in the app switcher. The phone treats
 * each as a minimum the person cannot lower and says why its switch is
 * locked. Members never see this section.
 */
export function MobileSecurityPolicySection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "org.mobile_security" });
  const { t: tCommon } = useTranslation();
  const policy = useMobileSecurityPolicy(orgSlug);
  const set = useSetMobileSecurityPolicy(orgSlug);
  if (!policy.data?.can_manage) return null;
  const data = policy.data;

  const row = (field: Requirement, label: string, hint: string) => (
    <SettingsRow label={label} description={hint} size="none">
      <Switch
        aria-label={label}
        checked={data[field]}
        // Busy, not disabled, while a change runs: disabling would drop focus from the switch just pressed.
        aria-busy={set.isPending || undefined}
        className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
        onCheckedChange={(on) => {
          if (set.isPending) return;
          const change = field === "require_app_lock" ? { require_app_lock: on } : { block_screen_capture: on };
          set.mutate(change, { onError: (err) => toastApiError(err, tCommon("common.error")) });
        }}
      />
    </SettingsRow>
  );

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingsCard>
        {row("require_app_lock", t("app_lock"), t("app_lock_hint"))}
        {row("block_screen_capture", t("screen_capture"), t("screen_capture_hint"))}
      </SettingsCard>
    </SettingsSection>
  );
}

"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { usePushConfig } from "@uniwork/core/notifications";
import { usePush } from "@uniwork/core/notifications/push";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { NotificationsMatrix, type Channel } from "./notifications-matrix";
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
  type SettingsSaveStatus,
} from "./settings-layout";

/**
 * The push switch for this browser, then the kind × channel matrix. The push
 * column exists only when the server can push and this browser can receive;
 * when it cannot, one quiet line says which of the two is missing.
 */
export function NotificationsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.notifications" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const push = usePush();
  const pushConfig = usePushConfig();
  const [pushStatus, setPushStatus] = useState<SettingsSaveStatus>("idle");

  const channels: Channel[] = push.available ? ["in_app", "push", "email"] : ["in_app", "email"];
  // Only say why once the config has answered; a guess would be a small lie.
  const pushMissing =
    push.available || pushConfig.isLoading
      ? null
      : !pushConfig.data?.enabled
        ? t("push_unavailable_server")
        : t("push_unavailable_browser");

  const togglePush = async (on: boolean) => {
    if (push.isPending || push.isLoading) return;
    setPushStatus("saving");
    try {
      if (on) await push.enable();
      else await push.disable();
      setPushStatus("saved");
    } catch (err) {
      setPushStatus("error");
      const code = err instanceof Error ? err.message : "";
      toast.error(code === "push_denied" ? t("push_denied") : t("error"));
    }
  };

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      {push.available ? (
        <SettingsSection
          title={t("push_section")}
          description={t("push_description")}
          action={
            <SettingsSaveState
              status={pushStatus}
              savingLabel={tSave("saving")}
              savedLabel={tSave("saved")}
              errorLabel={tSave("error")}
            />
          }
        >
          <SettingsCard>
            <SettingsRow label={t("push_this_browser")} size="none">
              <Switch
                aria-label={t("push_this_browser")}
                checked={push.subscribed}
                // Busy, not disabled, while a change runs: disabling would drop
                // focus from the switch the reader just pressed.
                aria-busy={push.isPending || push.isLoading || undefined}
                className="aria-busy:opacity-60"
                disabled={push.permission === "denied"}
                onCheckedChange={(v) => void togglePush(v)}
              />
            </SettingsRow>
            {push.permission === "denied" ? (
              <p className="px-4 pb-3 text-caption text-warning">{t("push_denied")}</p>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <div className="space-y-3">
        <NotificationsMatrix channels={channels} />
        <div className="space-y-1.5 px-1 text-caption text-muted-foreground">
          <p className="flex items-start gap-2">
            <BellRing aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("digest_hint")}
          </p>
          {pushMissing ? (
            <p className="flex items-start gap-2">
              <BellOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {pushMissing}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsTab>
  );
}

"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellOff, BellRing, TriangleAlert } from "lucide-react";
import { usePushConfig } from "@uniwork/core/notifications";
import { usePush } from "@uniwork/core/notifications/push";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { NotificationsMatrix, type Channel } from "./notifications-matrix";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
  type SettingsSaveStatus,
} from "./settings-layout";

/**
 * The push switch for this browser, then the kind × channel matrix. The push
 * column exists only when the server can push and this browser can receive;
 * when it cannot, one quiet footnote under the matrix says which is missing.
 */
export function NotificationsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.notifications" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const push = usePush();
  const pushConfig = usePushConfig();
  const [pushStatus, setPushStatus] = useState<SettingsSaveStatus>("idle");
  // The browser refused this session even if it still reports "default" (a
  // dismissed prompt), so the reason is remembered, not only read.
  const [refused, setRefused] = useState(false);
  const deniedId = useId();
  const denied = push.permission === "denied" || refused;

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
    setRefused(false);
    // One channel per failure: a refusal is explained by the notice under the
    // switch (it is the reason, and it lasts); anything else is the inline
    // save state. Never a toast on top.
    try {
      if (on) await push.enable();
      else await push.disable();
      setPushStatus("saved");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "push_denied") {
        setRefused(true);
        setPushStatus("idle");
      } else {
        setPushStatus("error");
      }
    }
  };

  const footnotes = (
    <ul className="space-y-1.5 text-caption leading-5 text-muted-foreground">
      <li className="flex items-start gap-2">
        <BellRing aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="text-pretty">{t("digest_hint")}</span>
      </li>
      {pushMissing ? (
        <li className="flex items-start gap-2">
          <BellOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-pretty">{pushMissing}</span>
        </li>
      ) : null}
    </ul>
  );

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
                aria-describedby={denied ? deniedId : undefined}
                checked={push.subscribed}
                // Busy, not disabled, while a change runs: disabling would drop
                // focus from the switch the reader just pressed.
                aria-busy={push.isPending || push.isLoading || undefined}
                // 44px to a finger: the thumb stays small, the hit area grows.
                className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
                disabled={push.permission === "denied"}
                onCheckedChange={(v) => void togglePush(v)}
              />
            </SettingsRow>
            {/* Always mounted (hidden while empty) so a refusal that happens
                on a click is announced, not only shown. */}
            <div role="status" className="empty:hidden">
              {denied ? (
                <SettingsCardBody>
                  <p
                    id={deniedId}
                    className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-caption leading-5 text-warning-soft-foreground"
                  >
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span className="text-pretty">{t("push_denied")}</span>
                  </p>
                </SettingsCardBody>
              ) : null}
            </div>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <NotificationsMatrix channels={channels} footnotes={footnotes} />
    </SettingsTab>
  );
}

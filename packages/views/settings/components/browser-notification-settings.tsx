"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { requestWebNotificationPermission, useWebNotificationPermission } from "@uniwork/core/platform";
import { Button } from "@uniwork/ui/components/ui/button";
import { sendDesktopTestNotification } from "../../layout/desktop-notifications-prompt";
import { SettingsCard, SettingsCardBody, SettingsRow, SettingsSection } from "./settings-layout";

/** System notifications work while the tab is open even when server push is unavailable. */
export function BrowserNotificationSettings() {
  const { t } = useTranslation();
  const permission = useWebNotificationPermission();
  const [pending, setPending] = useState(false);
  const [tested, setTested] = useState(false);
  if (permission === "unsupported") return null;
  const test = () => {
    sendDesktopTestNotification(t("notifications.desktop.test_title"), t("notifications.desktop.test_body"));
    setTested(true);
  };
  const enable = async () => {
    if (pending) return;
    setPending(true);
    try { if (await requestWebNotificationPermission() === "granted") test(); }
    finally { setPending(false); }
  };
  const message = permission === "denied" ? "denied" : tested ? "check" : permission === "granted" ? "allowed" : "prompt";
  return (
    <SettingsSection title={t("notifications.browser.title")} description={t("notifications.browser.description")}>
      <SettingsCard>
        <SettingsRow label={t("settings.notifications.desktop_row")}>
          {permission === "granted" ? <Button variant="outline" size="sm" onClick={test}>{t("settings.notifications.desktop_test")}</Button>
            : permission === "default" ? <Button size="sm" aria-busy={pending || undefined} onClick={() => void enable()}>{t("notifications.desktop.enable")}</Button> : null}
        </SettingsRow>
        <SettingsCardBody><p role="status" className="text-caption text-muted-foreground text-pretty">{t(`notifications.browser.${message}`)}</p></SettingsCardBody>
      </SettingsCard>
    </SettingsSection>
  );
}

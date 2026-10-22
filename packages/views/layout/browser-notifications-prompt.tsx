"use client";

import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePush } from "@uniwork/core/notifications/push";
import { usePushConfig } from "@uniwork/core/notifications";
import { defaultStorage, getDesktopBridge, requestWebNotificationPermission, useWebNotificationPermission } from "@uniwork/core/platform";
import { Button } from "@uniwork/ui/components/ui/button";
import { sendDesktopTestNotification } from "./desktop-notifications-prompt";

const DISMISSED_KEY = "uniwork_browser_notifications_prompt";

function dismissed(): boolean {
  try { return defaultStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}

/** An invitation, never an automatic browser permission dialog. */
export function BrowserNotificationsPrompt() {
  const { t } = useTranslation();
  const permission = useWebNotificationPermission();
  const push = usePush();
  const config = usePushConfig();
  const [closed, setClosed] = useState(dismissed);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [pushFailed, setPushFailed] = useState(false);
  if (getDesktopBridge() || closed || permission === "unsupported" || (permission !== "default" && !checking)) return null;

  const close = () => {
    try { defaultStorage.setItem(DISMISSED_KEY, "1"); } catch { /* A blocked store only prevents remembering dismissal. */ }
    setClosed(true);
  };
  const enable = async () => {
    if (pending) return;
    setPending(true);
    setPushFailed(false);
    try {
      // Keep this first: browsers require the permission request to come from the click.
      const next = await requestWebNotificationPermission();
      setChecking(true);
      if (next !== "granted") return;
      sendDesktopTestNotification(t("notifications.desktop.test_title"), t("notifications.desktop.test_body"));
      const server = config.data ?? (await config.refetch()).data;
      if (server?.enabled && !push.subscribed) {
        try { await push.enable(server.public_key); } catch { setPushFailed(true); }
      }
    } finally { setPending(false); }
  };
  const message = pushFailed ? "background_failed" : !checking ? "prompt" : permission === "granted" ? "check" : "denied";
  return (
    <section aria-label={t("notifications.browser.title")} className="order-first grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-border bg-info-soft px-4 py-2 text-info-soft-foreground sm:flex sm:items-center">
      <BellRing aria-hidden className="size-4 shrink-0" />
      <p role="status" className="min-w-0 text-label text-pretty sm:flex-1">{t(`notifications.browser.${message}`)}</p>
      {!checking || permission === "default" ? (
        <Button size="sm" className="col-start-2 row-start-2 justify-self-start" aria-busy={pending || undefined} onClick={() => void enable()}>{t("notifications.desktop.enable")}</Button>
      ) : <Button size="sm" className="col-start-2 row-start-2 justify-self-start" onClick={close}>{t("common.done")}</Button>}
      <Button variant="ghost" size="icon-sm" className="col-start-3 row-start-1" aria-label={t("common.close")} onClick={close}><X aria-hidden /></Button>
    </section>
  );
}

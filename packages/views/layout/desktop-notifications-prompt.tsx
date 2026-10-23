"use client";

import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  defaultStorage,
  getDesktopBridge,
  getWebNotificationPermission,
  requestWebNotificationPermission,
  showWebNotification,
  type WebNotificationPermission,
} from "@uniwork/core/platform";
import { Button } from "@uniwork/ui/components/ui/button";

const DISMISSED_KEY = "uniwork_desktop_notifications_prompt";

const SHELL_OS = new Set(["macos", "windows", "linux"]);

function wasDismissed(): boolean {
  try {
    return defaultStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One system notification; on macOS the first an app shows is also what makes
 * the OS ask for permission. A click only brings the window back: the click
 * handler navigates nowhere on an empty href.
 */
export function sendDesktopTestNotification(title: string, body: string): void {
  showWebNotification({
    slug: "",
    itemId: "desktop-notifications-test",
    issueKey: "desktop-notifications-test",
    href: "",
    title,
    body,
  });
}

/**
 * The UniChat shell, once per computer: a bar above the app that asks for
 * notification permission while the person is looking. Without it, chat
 * banners never show — only the dock/taskbar badge does — because
 * `showWebNotification` requires permission "granted". macOS often asks only
 * when the first banner fires; Windows keeps "default" until
 * `requestPermission` runs, so this bar calls it explicitly on Windows/Linux.
 */
export function DesktopNotificationsPrompt() {
  const { t } = useTranslation(undefined, { keyPrefix: "notifications.desktop" });
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: "common" });
  const [step, setStep] = useState<"ask" | "check" | "closed">(() => (wasDismissed() ? "closed" : "ask"));
  const [permission, setPermission] = useState<WebNotificationPermission>(() => getWebNotificationPermission());
  const bridge = getDesktopBridge();
  const os = bridge?.appInfo.os;
  // Already allowed before this bar appeared — nothing to ask. After "Turn on"
  // succeeds, stay through the check step until the person dismisses it.
  if (!os || !SHELL_OS.has(os) || step === "closed" || (permission === "granted" && step === "ask")) return null;

  const close = () => {
    try {
      defaultStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage refused: the bar comes back on the next launch, nothing worse.
    }
    setStep("closed");
  };
  const enable = () => {
    void (async () => {
      const next = await requestWebNotificationPermission();
      setPermission(next);
      if (next !== "granted") {
        setStep("check");
        return;
      }
      sendDesktopTestNotification(t("test_title"), t("test_body"));
      setStep("check");
    })();
  };
  const openSettings = bridge.openNotificationSettings;
  const checkCopy = os === "macos" ? t("check") : t("check_windows");

  return (
    // order-first: rendered after the page, shown above it, pushing it down instead of covering its header.
    <div
      role="region"
      aria-label={t("prompt")}
      data-window-drag
      className="order-first flex shrink-0 items-center gap-3 border-b border-border bg-info-soft py-1.5 pr-1.5 pl-4 text-info-soft-foreground"
    >
      <BellRing aria-hidden className="size-4 shrink-0" />
      <p role="status" className="min-w-0 flex-1 text-label text-pretty">
        {step === "ask" ? t("prompt") : checkCopy}
      </p>
      {step === "ask" ? (
        <Button size="sm" onClick={enable}>
          {t("enable")}
        </Button>
      ) : (
        <>
          {openSettings ? (
            <Button size="sm" variant="outline" onClick={() => void openSettings()}>
              {t("open_settings")}
            </Button>
          ) : null}
          <Button size="sm" onClick={close}>
            {tCommon("done")}
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon-sm" onClick={close} aria-label={tCommon("close")}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

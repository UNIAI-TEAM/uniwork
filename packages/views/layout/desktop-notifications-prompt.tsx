"use client";

import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { defaultStorage, getDesktopBridge, showWebNotification } from "@uniwork/core/platform";
import { Button } from "@uniwork/ui/components/ui/button";

const DISMISSED_KEY = "uniwork_desktop_notifications_prompt";

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
 * The UniChat shell on macOS, once per computer: a bar above the app that
 * asks for notifications while the person is looking. Left alone, macOS asks
 * only when the first message arrives as a banner, usually while they look
 * elsewhere, and a missed or refused prompt silences every banner with nothing
 * the app can read back (Electron reports a refused notification as shown).
 * So "Turn on" sends a test notification, which raises the OS prompt now, and
 * the bar then says what to do if nothing appeared. Windows shows
 * notifications without asking; Settings › Notifications has the same test
 * and settings link for both.
 */
export function DesktopNotificationsPrompt() {
  const { t } = useTranslation(undefined, { keyPrefix: "notifications.desktop" });
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: "common" });
  const [step, setStep] = useState<"ask" | "check" | "closed">(() => (wasDismissed() ? "closed" : "ask"));
  const bridge = getDesktopBridge();
  if (bridge?.appInfo.os !== "macos" || step === "closed") return null;

  const close = () => {
    try {
      defaultStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage refused: the bar comes back on the next launch, nothing worse.
    }
    setStep("closed");
  };
  const enable = () => {
    sendDesktopTestNotification(t("test_title"), t("test_body"));
    setStep("check");
  };
  const openSettings = bridge.openNotificationSettings;

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
        {step === "ask" ? t("prompt") : t("check")}
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

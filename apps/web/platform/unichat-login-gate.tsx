"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

type Phase = "idle" | "opening" | "waiting" | "failed";

/**
 * `/login` inside the UniChat shell, shaped like a messenger's first screen
 * (Telegram, Viber, WhatsApp desktop): the mark, one line, one button. The web
 * form signs in by cookie, which the shell's main-process session never sees,
 * so the button starts the shell's PKCE login in the system browser instead.
 * Nothing opens until the person asks: a browser popping up at launch or right
 * after a sign-out reads as a bug.
 */
export function UniChatLoginGate() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  // The shell refuses deliberately (no keyring, /auth/desktop/start down, browser
  // would not open); the rejection is the only signal, so it becomes one line.
  // A second press while the browser is open re-opens the same sign-in page.
  const login = () => {
    setPhase("opening");
    getDesktopBridge()
      ?.session.login()
      .then(
        () => setPhase("waiting"),
        () => setPhase("failed"),
      );
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <UniChatIcon size={96} decorative />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display-sm font-bold text-foreground">{t("auth.desktop.unichat_login_title")}</h1>
          <p className="text-body text-muted-foreground">{t("auth.desktop.unichat_login_hint")}</p>
        </div>
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          {phase === "waiting" ? (
            <>
              <p role="status" className="text-body text-foreground">{t("auth.desktop.unichat_login_waiting")}</p>
              <Button type="button" variant="outline" size="lg" className="w-full" onClick={login}>
                {t("auth.desktop.unichat_login_reopen")}
              </Button>
            </>
          ) : (
            <Button type="button" size="lg" className="w-full" aria-disabled={phase === "opening"} onClick={login}>
              {phase === "opening" ? <Spinner data-icon="inline-start" /> : null}
              {t("auth.desktop.unichat_login_button")}
            </Button>
          )}
          {phase === "failed" ? <p role="alert" className="text-body text-destructive">{t("auth.desktop.unichat_login_failed")}</p> : null}
        </div>
      </div>
    </main>
  );
}

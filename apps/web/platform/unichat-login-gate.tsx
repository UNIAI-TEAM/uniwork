"use client";

import { Globe } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

/** The gate's one action: a 280px, 44px pill. */
const PILL = "h-11 w-70 max-w-full rounded-full text-body font-semibold";

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
  // Canvas DeskGateStates (A): mark, 26px welcome, one line, then the one action as a 44px pill.
  return (
    <main data-window-drag className="flex min-h-dvh items-center justify-center bg-background px-12 py-8">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <UniChatIcon size={96} decorative />
        <h1 className="mt-7 font-display text-display-sm leading-8 font-extrabold tracking-[-0.01em] text-foreground">
          {t("auth.desktop.unichat_login_title")}
        </h1>
        <p className="mt-2 max-w-95 text-body-lg text-muted-foreground">{t("auth.desktop.unichat_login_hint")}</p>
        {phase === "waiting" ? (
          <>
            <p
              role="status"
              className="mt-8 flex items-center gap-2.5 rounded-[14px] bg-muted px-4.5 py-3 text-body text-foreground"
            >
              <Spinner className="size-4.5 text-brand" />
              {t("auth.desktop.unichat_login_waiting")}
            </p>
            <Button type="button" variant="secondary" className={cn(PILL, "mt-3.5")} onClick={login}>
              <Globe aria-hidden className="size-4.5" />
              {t("auth.desktop.unichat_login_reopen")}
            </Button>
          </>
        ) : (
          <Button type="button" className={cn(PILL, "mt-8")} aria-disabled={phase === "opening"} onClick={login}>
            {phase === "opening" ? <Spinner data-icon="inline-start" /> : null}
            {t("auth.desktop.unichat_login_button")}
          </Button>
        )}
        {phase === "failed" ? (
          <p role="alert" className="mt-3 text-body text-destructive">
            {t("auth.desktop.unichat_login_failed")}
          </p>
        ) : null}
      </div>
    </main>
  );
}

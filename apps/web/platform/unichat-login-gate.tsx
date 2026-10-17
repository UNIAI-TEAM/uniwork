"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
import { Button } from "@uniwork/ui/components/ui/button";
import { Bezel } from "@uniwork/views/layout/brand-surface";

// The shell refuses deliberately (no keyring, /auth/desktop/start down, browser
// would not open); the rejection is the only signal, so it becomes one line.
const login = (setFailed: (failed: boolean) => void) => {
  setFailed(false);
  getDesktopBridge()
    ?.session.login()
    .catch(() => setFailed(true));
};

/**
 * `/login` inside the UniChat shell: the web form signs in by cookie, which
 * the shell's main-process session never sees, so the page starts the shell's
 * PKCE login in the system browser instead and offers a retry.
 */
export function UniChatLoginGate() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useEffect(() => login(setFailed), []);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6">
      <Bezel>
        <section className="flex w-full max-w-xl flex-col gap-6 p-6 sm:p-9">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-display font-bold text-foreground">{t("auth.desktop.unichat_login_title")}</h1>
            <p className="text-body text-muted-foreground">{t("auth.desktop.unichat_login_hint")}</p>
            {failed ? <p role="alert" className="text-body text-destructive">{t("auth.desktop.unichat_login_failed")}</p> : null}
          </div>
          <div className="flex sm:justify-end">
            <Button type="button" onClick={() => login(setFailed)}>{t("auth.desktop.unichat_login_button")}</Button>
          </div>
        </section>
      </Bezel>
    </main>
  );
}

"use client";
import { useTranslation } from "react-i18next";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/** Full-screen "signing in with Google…" shown while the callback page resolves the session. */
export function AuthCallbackView() {
  const { t } = useTranslation();
  return (
    <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
      <div role="status" className="flex items-center gap-3 text-body">
        <Spinner />
        <span>{t("auth.google.signingIn")}</span>
      </div>
    </main>
  );
}

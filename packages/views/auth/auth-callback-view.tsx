"use client";
import { useTranslation } from "react-i18next";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/** Full-screen "signing in with Google…" shown while the callback page resolves the session. */
export function AuthCallbackView() {
  const { t } = useTranslation();
  return (
    <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
      <div role="status" className="flex items-center gap-3 text-body">
        {/* The text is the announcement; the icon must not add a second
            (English) status of its own. */}
        <Spinner role="presentation" aria-label={undefined} aria-hidden />
        {/* The only content on the page doubles as its heading. */}
        <h1 className="text-body font-normal">{t("auth.google.signingIn")}</h1>
      </div>
    </main>
  );
}

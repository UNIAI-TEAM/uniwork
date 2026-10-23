"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // The digest is the only handle the server log gives us for this render;
    // never render the raw error message to the user.
    console.error("app render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <main
      data-testid="app-error"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h1 className="text-title font-semibold text-foreground">{t("errors.render_title")}</h1>
      <p className="text-body text-muted-foreground">{t("errors.render_description")}</p>
      <Button type="button" variant="outline" onClick={reset}>
        {t("common.retry")}
      </Button>
    </main>
  );
}

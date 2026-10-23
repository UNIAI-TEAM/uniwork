"use client";

import { useTranslation } from "react-i18next";
import { AppLink } from "@uniwork/views/navigation";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main
      data-testid="app-not-found"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h1 className="text-title font-semibold text-foreground">{t("errors.not_found_title")}</h1>
      <p className="text-body text-muted-foreground">{t("errors.not_found_description")}</p>
      <AppLink href="/" className="text-body text-brand underline">
        {t("errors.back_home")}
      </AppLink>
    </main>
  );
}

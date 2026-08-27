"use client";

import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsTab } from "./settings-layout";

export function IntegrationsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });

  return (
    <SettingsTab
      title={t("page.tabs.integrations")}
      description={t("integrations.emptyDescription")}
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <Plug className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-body font-medium text-foreground">{t("integrations.emptyTitle")}</p>
        <p className="max-w-md text-body text-muted-foreground">{t("integrations.emptyDescription")}</p>
      </div>
    </SettingsTab>
  );
}

"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The UNI panel's title row; `action` is the generate button the host sees. */
export function MeetingCopilotHeader({ action }: { action?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-start justify-between gap-2 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
        <h2 className="text-pretty text-title-sm font-semibold text-foreground">{t("meetings.aiCopilot")}</h2>
      </div>
      {action}
    </div>
  );
}

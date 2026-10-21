"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The UNI panel's title row; `action` is the generate button the host sees.
 * The selected "UNI" tab right above already names the panel on screen, so
 * the heading stays for screen-reader navigation only.
 */
export function MeetingCopilotHeader({ action }: { action?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="sr-only">{t("meetings.aiCopilot")}</h2>
      {action ? <div className="flex shrink-0 justify-end pb-2">{action}</div> : null}
    </>
  );
}

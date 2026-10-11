"use client";

import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice } from "../../common/notice";

/**
 * Why a document is in the standard (G3) editor although its module has a web frame: the frame's own
 * files did not load. A flag that is off, or the reader's own choice, needs no notice, and a file over
 * the module's size cap (Sheets) never reaches the G3 editor: it gets the too-large notice.
 */
export function FrameFallbackNotice({ module }: { module: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  return (
    <div className="shrink-0 px-4 pt-3" data-testid="office-frame-fallback-notice" data-reason="load" data-office-module={module}>
      <Notice tone="info" icon={Info} layout="inline">{t("fallback_notice")}</Notice>
    </div>
  );
}

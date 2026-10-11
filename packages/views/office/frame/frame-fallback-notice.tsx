"use client";

import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice } from "../../common/notice";

/**
 * Why a document is in the standard (G3) editor although its module has a web frame: the frame's own
 * files did not load (`load`), or the file is over the module's size cap (`size`, Sheets). A flag that
 * is off, or the reader's own choice, needs no notice.
 */
export type FrameFallbackReason = "load" | "size";

export function FrameFallbackNotice({ reason, module }: { reason: FrameFallbackReason; module: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  return (
    <div className="shrink-0 px-4 pt-3" data-testid="office-frame-fallback-notice" data-reason={reason} data-office-module={module}>
      <Notice tone="info" icon={Info} layout="inline">{t(reason === "size" ? "fallback_notice_size" : "fallback_notice")}</Notice>
    </div>
  );
}

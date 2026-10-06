"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Download, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";
import { isOfficeTooLarge, type OfficeTooLargeSignal } from "@uniwork/core/office";
import { useOfficeFormatName } from "./editor-slot";

/**
 * UNI-956: the web keeps its byte bounds, so a file past them is edited in
 * UniWork Office desktop (no size cap there). The host provides the launch
 * action (the same ticket flow as the header split button) and the document's
 * own file download; every format's too-large open failure renders this one
 * notice. Without a provider only the message shows.
 */
export interface OfficeTooLargeValue {
  desktopAction?: ReactNode;
  onDownload?: () => void | Promise<void>;
}

const TooLargeContext = createContext<OfficeTooLargeValue>({});

export function OfficeTooLargeProvider({ value, children }: { value: OfficeTooLargeValue; children: ReactNode }) {
  return <TooLargeContext.Provider value={value}>{children}</TooLargeContext.Provider>;
}

export function OfficeTooLargeNotice({ format }: { format: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.too_large" });
  const formatName = useOfficeFormatName();
  const { desktopAction, onDownload } = useContext(TooLargeContext);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    setFailed(false);
    try { await onDownload(); } catch { setFailed(true); } finally { setDownloading(false); }
  };
  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="office-too-large">
      <Notice tone="warning" icon={FileWarning} layout="inline" live="assertive" className="w-full max-w-xl">
        <div className="space-y-2">
          <p className="text-body font-semibold">{t("title")}</p>
          <p>{t("description", { format: formatName(format) })}</p>
          <div className="flex flex-wrap items-center gap-2">
            {desktopAction}
            {onDownload ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void download()} aria-disabled={downloading || undefined}>
                <Download aria-hidden />
                {t("download")}
              </Button>
            ) : null}
          </div>
          {failed ? <p className="text-caption text-destructive">{t("download_failed")}</p> : null}
        </div>
      </Notice>
    </section>
  );
}

/** The failure class a thrown open error maps to: a size refusal keeps its own
 * class so the host shows the notice rather than a generic engine error. */
export function openFailureClassOf(error: unknown): "too_large" | "engine_error" {
  return isOfficeTooLarge(error as OfficeTooLargeSignal | null) ? "too_large" : "engine_error";
}

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Download, FileExclamationPoint } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OpenRefusedReason } from "@uniwork/core/office/docs-frame-protocol";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";
import { useOfficeFormatName } from "./format-name";
import { useDocsFrameRefusedReason } from "./frame/docs-frame-refusal";

/**
 * UNI-956 / UNI-1866: a file the web editor refuses (`open_refused` or `too_large`)
 * is opened in UniWork Office desktop or downloaded. The host provides the launch
 * action (the same ticket flow as the header split button) and the document's
 * own file download; the refusal notice and every frame failure render them
 * (`OfficeFileActions`). Without a provider only the message shows.
 */
export interface OfficeTooLargeValue {
  desktopAction?: ReactNode;
  onDownload?: () => void | Promise<void>;
}

const TooLargeContext = createContext<OfficeTooLargeValue>({});

export function OfficeTooLargeProvider({ value, children }: { value: OfficeTooLargeValue; children: ReactNode }) {
  return <TooLargeContext.Provider value={value}>{children}</TooLargeContext.Provider>;
}

/**
 * Whether the host offers "Open in UniWork Office" beside Download. Copy that
 * names the app uses its download-only wording when it does not (a reader who
 * may not edit, or desktop open turned off).
 */
export function useOfficeDesktopActionAvailable(): boolean {
  return Boolean(useContext(TooLargeContext).desktopAction);
}

/**
 * "Open in UniWork Office" and "Download" from the host's provider: the way to
 * keep working on a file the web cannot open. Renders nothing without them.
 */
export function OfficeFileActions({ leading }: { leading?: ReactNode }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.too_large" });
  const { desktopAction, onDownload } = useContext(TooLargeContext);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    setFailed(false);
    try { await onDownload(); } catch { setFailed(true); } finally { setDownloading(false); }
  };
  if (!leading && !desktopAction && !onDownload) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        {desktopAction}
        {onDownload ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void download()} aria-disabled={downloading || undefined}>
            <Download aria-hidden />
            {t("download")}
          </Button>
        ) : null}
      </div>
      {failed ? <p className="text-caption text-destructive">{t("download_failed")}</p> : null}
    </>
  );
}

function refusalDescriptionKey(
  reason: OpenRefusedReason | null | undefined,
  desktop: boolean,
):
  | "description"
  | "description_download_only"
  | "engine_out_of_memory"
  | "engine_out_of_memory_download_only"
  | "too_complex"
  | "too_complex_download_only" {
  if (reason === "engine_out_of_memory") {
    return desktop ? "engine_out_of_memory" : "engine_out_of_memory_download_only";
  }
  if (reason === "too_complex") {
    return desktop ? "too_complex" : "too_complex_download_only";
  }
  return desktop ? "description" : "description_download_only";
}

export function OfficeTooLargeNotice({ format, reason }: { format: string; reason?: OpenRefusedReason | null }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.too_large" });
  const formatName = useOfficeFormatName();
  const desktop = useOfficeDesktopActionAvailable();
  const contextReason = useDocsFrameRefusedReason();
  const effectiveReason = reason ?? contextReason;
  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="office-too-large">
      <Notice tone="warning" icon={FileExclamationPoint} layout="inline" live="assertive" className="w-full max-w-xl sm:w-fit">
        <div className="space-y-2">
          <p className="text-body font-semibold">{t("title")}</p>
          <p>{t(refusalDescriptionKey(effectiveReason, desktop), { format: formatName(format) })}</p>
          <OfficeFileActions />
        </div>
      </Notice>
    </section>
  );
}

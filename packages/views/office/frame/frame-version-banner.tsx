"use client";

import { RotateCcwClock, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import { DesktopOpenAction } from "../desktop-open-action";
import type { FrameDesktopOpenProps } from "./frame-desktop-open";

/**
 * The strip above a read-only version view (UNI-2033): it says which version this is, offers the
 * same version in the desktop app (the ticket carries `version` and the comment) and the way back.
 */
export function FrameVersionBanner({ documentId, versionNo, desktopOpen, onBackToCurrent }: {
  documentId: string;
  versionNo: number;
  desktopOpen?: FrameDesktopOpenProps;
  onBackToCurrent?: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "documents.collab" });
  return (
    <div data-testid="office-version-view-banner">
      <Notice tone="info" icon={RotateCcwClock} layout="strip">
        {/* The actions live inside the message column so a phone width wraps them under the text instead of squeezing it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span>{t("collabVersionViewBanner", { n: versionNo })}</span>
          <div className="flex flex-wrap items-center gap-2">
            {desktopOpen ? <DesktopOpenAction {...desktopOpen} documentId={documentId} placement="inline" operation="view" version={versionNo} /> : null}
            {onBackToCurrent ? <Button type="button" size="sm" variant="outline" onClick={onBackToCurrent}>{t("collabVersionViewBack")}</Button> : null}
          </div>
        </div>
      </Notice>
    </div>
  );
}

/** A version the document does not have (or whose bytes are gone): one sentence and the way back. */
export function FrameVersionUnavailable({ onBackToCurrent, className }: { onBackToCurrent?: () => void; className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "documents.collab" });
  return (
    <div className={className} data-testid="office-version-view-unavailable" role="alert">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-body font-semibold">{t("collabVersionViewUnavailable")}</p>
        {onBackToCurrent ? <Button type="button" variant="outline" size="sm" onClick={onBackToCurrent}>{t("collabVersionViewBack")}</Button> : null}
      </div>
    </div>
  );
}

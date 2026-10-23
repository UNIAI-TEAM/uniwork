"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeWebFlagEnabled } from "@uniwork/core/documents/office-enabled";
import type { OfficeModule, OpenRefusedReason } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocsFrameFailure } from "./docs-frame-failure";
import { DocsFrameRefusalContext, DocsFrameRefusedReasonContext } from "./docs-frame-refusal";

export interface OfficeModuleOpenSwitchProps {
  module: OfficeModule;
  organizationId: string | undefined;
  /** `<OfficeModuleFrame>` — mounted once the module's flag is not off. */
  frame: ReactNode;
  /**
   * Shown instead of the frame when it refuses the file (`open_refused` or `too_large`)
   * (the refusal / open-in-the-app notice).
   */
  tooLarge?: ReactNode;
}

/** The module's web editor is not offered here: no build installed, or its flag is off. */
export function OfficeFrameUnavailable({ module, reason }: { module: OfficeModule; reason: "disabled" | "not_installed" }) {
  return (
    <DocsFrameFailure
      module={module}
      failure={reason === "not_installed" ? { code: "unsupported", message: "frame_not_installed" } : null}
      code={reason === "disabled" ? "feature_disabled" : "unsupported"}
      onRetry={() => undefined}
    />
  );
}

/**
 * Whether a document opens in its genoffice module frame (UNI-1013, generalised
 * by UNI-1014): yes unless the module's flag (`office_docs_web`,
 * `office_pdf_web`, …) is off for the document's organization, which shows the
 * unavailable notice with "Open in UniWork Office" and "Download". An answer
 * that could not be read mounts the frame: the server refuses the token if the
 * flag is off, and the frame shows the same notice. Nothing mounts while the
 * answer is loading, and once the frame is up a later flag change does not
 * unmount it under unsaved edits; the next open reads the new answer.
 */
export function OfficeModuleOpenSwitch({ module, organizationId, frame, tooLarge }: OfficeModuleOpenSwitchProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const state = useOfficeWebFlagEnabled(officeModuleSpec(module).flag, organizationId);
  const [frameMounted, setFrameMounted] = useState(false);
  // The frame refused to open the file (`open_refused` or `too_large`): the refusal notice replaces it.
  const [refused, setRefused] = useState<{ refused: boolean; reason?: OpenRefusedReason }>({ refused: false });
  if ((state === "on" || state === "unknown") && !frameMounted) setFrameMounted(true);

  if (refused.refused && tooLarge) {
    return <DocsFrameRefusedReasonContext.Provider value={refused.reason}>{tooLarge}</DocsFrameRefusedReasonContext.Provider>;
  }
  if (frameMounted || state === "on" || state === "unknown") {
    return (
      <DocsFrameRefusalContext.Provider value={(reason) => setRefused({ refused: true, reason })}>
        {frame}
      </DocsFrameRefusalContext.Provider>
    );
  }
  if (state === "loading") {
    return (
      <div className="space-y-3 p-4" role="status" aria-live="polite" data-testid="docx-open-switch-loading" data-office-module={module}>
        <Skeleton className="h-[min(55vh,32rem)] min-h-48 w-full" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }
  return <OfficeFrameUnavailable module={module} reason="disabled" />;
}

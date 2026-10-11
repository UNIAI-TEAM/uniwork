"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeWebFlagEnabled } from "@uniwork/core/documents/office-enabled";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocsFrameRefusalContext } from "./docs-frame-refusal";
import { FrameFallbackNotice } from "./frame-fallback-notice";

export interface OfficeModuleOpenSwitchProps {
  module: OfficeModule;
  organizationId: string | undefined;
  /** `<OfficeModuleFrame>` — mounted only on a settled "on" of the module's flag. */
  frame: ReactNode;
  /** The G3 editor, the default until the frame is accepted. */
  fallback: ReactNode;
  /**
   * Shown instead of the G3 editor when the frame says the file is over the module's size cap
   * (the too-large / open-in-the-app notice). A module without a size cap never asks for it.
   */
  tooLarge?: ReactNode;
}

/**
 * Which editor a document opens in (UNI-1013, generalised by UNI-1014): the
 * genoffice frame of its module when the module's flag (`office_docs_web`,
 * `office_pdf_web`, …) is on for the document's organization, the G3 editor
 * otherwise (off, or an answer that could not be read), and also when the
 * server refuses the frame's token because the flag is off (the page's cached
 * answer was stale). Neither mounts while the answer is loading, and once the
 * frame is up a later flag change does not swap editors under unsaved edits;
 * the next open reads the new answer.
 */
export function OfficeModuleOpenSwitch({ module, organizationId, frame, fallback, tooLarge }: OfficeModuleOpenSwitchProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const state = useOfficeWebFlagEnabled(officeModuleSpec(module).flag, organizationId);
  const [frameMounted, setFrameMounted] = useState(false);
  // The frame was refused (flag off, size cap) or could not load: the G3 editor takes over and says
  // why when the frame did not load; a file over the size cap shows `tooLarge` and no editor.
  const [refused, setRefused] = useState<{ reason: "load" | "size" | null } | null>(null);
  if (state === "on" && !frameMounted) setFrameMounted(true);

  if (refused) {
    if (refused.reason === "size" && tooLarge) return <>{tooLarge}</>;
    if (refused.reason !== "load") return fallback;
    return (
      <>
        <FrameFallbackNotice module={module} />
        {fallback}
      </>
    );
  }
  if (frameMounted || state === "on") {
    return <DocsFrameRefusalContext.Provider value={(reason) => setRefused({ reason: reason ?? null })}>{frame}</DocsFrameRefusalContext.Provider>;
  }
  if (state === "loading") {
    return (
      <div className="space-y-3 p-4" role="status" aria-live="polite" data-testid="docx-open-switch-loading" data-office-module={module}>
        <Skeleton className="h-[min(55vh,32rem)] min-h-48 w-full" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }
  return fallback;
}

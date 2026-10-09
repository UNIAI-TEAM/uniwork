"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeDocsWebEnabled } from "@uniwork/core/documents/office-enabled";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocsFrameRefusalContext } from "./docs-frame-refusal";

export interface DocxOpenSwitchProps {
  organizationId: string | undefined;
  /** `<OfficeDocsFrame>` — mounted only on a settled `office_docs_web` on. */
  docsFrame: ReactNode;
  /** The G3 editor, the default until the frame is accepted. */
  fallback: ReactNode;
}

/**
 * Which editor a .docx opens in (UNI-1013): the genoffice Docs frame when
 * `office_docs_web` is on for the document's organization, the G3 editor
 * otherwise (off, or an answer that could not be read), and also when the
 * server refuses the frame's token because the flag is off (the page's cached
 * answer was stale). Neither mounts while
 * the answer is loading, and once the frame is up a later flag change does not
 * swap editors under unsaved edits; the next open reads the new answer.
 */
export function DocxOpenSwitch({ organizationId, docsFrame, fallback }: DocxOpenSwitchProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const state = useOfficeDocsWebEnabled(organizationId);
  const [frameMounted, setFrameMounted] = useState(false);
  // The server refused the frame's token (flag off for this organization): the G3 editor takes over.
  const [refused, setRefused] = useState(false);
  if (state === "on" && !frameMounted) setFrameMounted(true);

  if (refused) return fallback;
  if (frameMounted || state === "on") {
    return <DocsFrameRefusalContext.Provider value={() => setRefused(true)}>{docsFrame}</DocsFrameRefusalContext.Provider>;
  }
  if (state === "loading") {
    return (
      <div className="space-y-3 p-4" role="status" aria-live="polite" data-testid="docx-open-switch-loading">
        <Skeleton className="h-[min(55vh,32rem)] min-h-48 w-full" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }
  return fallback;
}

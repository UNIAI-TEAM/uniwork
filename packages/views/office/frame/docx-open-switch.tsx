"use client";

import type { ReactNode } from "react";
import { OfficeModuleOpenSwitch } from "./office-module-open-switch";

export interface DocxOpenSwitchProps {
  organizationId: string | undefined;
  /** `<OfficeDocsFrame>` — mounted only on a settled `office_docs_web` on. */
  docsFrame: ReactNode;
  /** The G3 editor, the default until the frame is accepted. */
  fallback: ReactNode;
}

/** Which editor a .docx opens in (UNI-1013): `OfficeModuleOpenSwitch` for docs. */
export function DocxOpenSwitch({ organizationId, docsFrame, fallback }: DocxOpenSwitchProps) {
  return <OfficeModuleOpenSwitch module="docs" organizationId={organizationId} frame={docsFrame} fallback={fallback} />;
}

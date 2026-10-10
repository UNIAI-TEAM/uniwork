"use client";

import { OfficeModuleFrame, type OfficeModuleFrameControls, type OfficeModuleFrameProps } from "./office-module-frame";

export type OfficeDocsFrameControls = OfficeModuleFrameControls;
export type OfficeDocsFrameProps = Omit<OfficeModuleFrameProps, "module">;

/** The genoffice Docs editor (GO-D2, UNI-1013): `OfficeModuleFrame` for docs. */
export function OfficeDocsFrame(props: OfficeDocsFrameProps) {
  return <OfficeModuleFrame module="docs" {...props} />;
}

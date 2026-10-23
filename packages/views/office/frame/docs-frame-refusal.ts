import { createContext, useContext } from "react";
import type { OpenRefusedReason } from "@uniwork/core/office/docs-frame-protocol";

/**
 * Set by `OfficeModuleOpenSwitch` around a module frame: the frame calls it when
 * the document cannot be opened on the web (`open_refused` or `too_large`), so
 * the switch shows the refusal / open-in-the-app notice instead of an error.
 */
export type DocsFrameRefusal = (reason?: OpenRefusedReason) => void;

export const DocsFrameRefusalContext = createContext<DocsFrameRefusal | null>(null);

export function useDocsFrameRefusal(): DocsFrameRefusal | null {
  return useContext(DocsFrameRefusalContext);
}

export const DocsFrameRefusedReasonContext = createContext<OpenRefusedReason | undefined>(undefined);

export function useDocsFrameRefusedReason(): OpenRefusedReason | undefined {
  return useContext(DocsFrameRefusedReasonContext);
}

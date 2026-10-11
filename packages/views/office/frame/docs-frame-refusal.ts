import { createContext, useContext } from "react";

/**
 * Set by `OfficeModuleOpenSwitch` around a module frame: the frame calls it when
 * the document is over its module's size cap (Sheets: the server refused the
 * token with 413, or the frame answered its open with `too_large`), so the
 * switch shows the too-large / open-in-the-app notice instead of an error.
 */
export type DocsFrameRefusal = () => void;

export const DocsFrameRefusalContext = createContext<DocsFrameRefusal | null>(null);

export function useDocsFrameRefusal(): DocsFrameRefusal | null {
  return useContext(DocsFrameRefusalContext);
}

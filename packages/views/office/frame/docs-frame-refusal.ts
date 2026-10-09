import { createContext, useContext } from "react";

/**
 * Set by `OfficeModuleOpenSwitch` around a module frame: the frame calls it when the
 * server refuses to mint its token because its module's flag is off for the
 * document's organization (the answer the page's cached config has not caught
 * up with yet), so the switch can show the G3 editor instead of an error.
 */
export const DocsFrameRefusalContext = createContext<(() => void) | null>(null);

export function useDocsFrameRefusal(): (() => void) | null {
  return useContext(DocsFrameRefusalContext);
}

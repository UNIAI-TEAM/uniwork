import { createContext, useContext } from "react";

/**
 * Set by `DocxOpenSwitch` around the Docs frame: the frame calls it when the
 * server refuses to mint its token because `office_docs_web` is off for the
 * document's organization (the answer the page's cached config has not caught
 * up with yet), so the switch can show the G3 editor instead of an error.
 */
export const DocsFrameRefusalContext = createContext<(() => void) | null>(null);

export function useDocsFrameRefusal(): (() => void) | null {
  return useContext(DocsFrameRefusalContext);
}

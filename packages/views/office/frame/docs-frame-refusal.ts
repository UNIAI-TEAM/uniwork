import { createContext, useContext } from "react";

/**
 * Set by `OfficeModuleOpenSwitch` around a module frame: the frame calls it when the
 * server refuses to mint its token because its module's flag is off for the
 * document's organization (the answer the page's cached config has not caught
 * up with yet), or - for a module with a size cap (Sheets) - because the
 * document is too large for the frame, so the switch can show the G3 editor
 * instead of an error.
 *
 * `reason: "load"` says the switch happened because the frame's own files did
 * not load, `"size"` because the file is over the module's size cap: in both
 * the G3 host explains it (inline notice) instead of changing editor without
 * a word. No reason = a flag or the reader's own choice, which need no explanation.
 */
export type DocsFrameRefusal = (reason?: "load" | "size") => void;

export const DocsFrameRefusalContext = createContext<DocsFrameRefusal | null>(null);

export function useDocsFrameRefusal(): DocsFrameRefusal | null {
  return useContext(DocsFrameRefusalContext);
}

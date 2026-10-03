import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A4: link commands and state fields. */
export type DocxLinksCommands = object;
/** Reserved for task A4: link state fields. */
export type DocxLinksFormatState = object;

// Placeholder — owned by task A4 (wave A).
export function createLinksCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxLinksCommands, DocxLinksFormatState> {
  return { commands: {}, readState: () => ({}) };
}

import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A13: header/footer commands and state fields. */
export type DocxHeaderFooterCommands = object;
/** Reserved for task A13: header/footer state fields. */
export type DocxHeaderFooterFormatState = object;

// Placeholder — owned by task A13 (wave A).
export function createHeaderFooterCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxHeaderFooterCommands, DocxHeaderFooterFormatState> {
  return { commands: {}, readState: () => ({}) };
}

import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A11: symbol/equation insert commands and state fields. */
export type DocxInsertCommands = object;
/** Reserved for task A11: symbol/equation insert state fields. */
export type DocxInsertFormatState = object;

// Placeholder — owned by task A11 (wave A).
export function createInsertCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxInsertCommands, DocxInsertFormatState> {
  return { commands: {}, readState: () => ({}) };
}

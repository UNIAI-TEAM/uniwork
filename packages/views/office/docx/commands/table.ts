import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A10: table-editing commands and state fields. */
export type DocxTableCommands = object;
/** Reserved for task A10: table-editing state fields. */
export type DocxTableFormatState = object;

// Placeholder — owned by task A10 (wave A).
export function createTableCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxTableCommands, DocxTableFormatState> {
  return { commands: {}, readState: () => ({}) };
}

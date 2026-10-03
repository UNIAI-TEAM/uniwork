import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A3: paragraph-formatting commands and state fields. */
export type DocxParagraphCommands = object;
/** Reserved for task A3: paragraph-formatting state fields. */
export type DocxParagraphFormatState = object;

// Placeholder — owned by task A3 (wave A).
export function createParagraphCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxParagraphCommands, DocxParagraphFormatState> {
  return { commands: {}, readState: () => ({}) };
}

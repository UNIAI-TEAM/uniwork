import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A2: character-formatting commands and state fields. */
export type DocxCharacterCommands = object;
/** Reserved for task A2: character-formatting state fields. */
export type DocxCharacterFormatState = object;

// Placeholder — owned by task A2 (wave A).
export function createCharacterCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxCharacterCommands, DocxCharacterFormatState> {
  return { commands: {}, readState: () => ({}) };
}

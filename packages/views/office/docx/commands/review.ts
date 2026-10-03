import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Reserved for task A12: track-changes commands and state fields. */
export type DocxReviewCommands = object;
/** Reserved for task A12: track-changes state fields. */
export type DocxReviewFormatState = object;

// Placeholder — owned by task A12 (wave A).
export function createReviewCommands(_context: DocxCommandFactoryContext): DocxCommandArea<DocxReviewCommands, DocxReviewFormatState> {
  return { commands: {}, readState: () => ({}) };
}

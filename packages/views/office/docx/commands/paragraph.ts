import {
  applyParagraphStyle,
  setLineSpacing,
  setParagraphAlign,
  setSpaceAfterPt,
  setSpaceBeforePt,
  stepParagraphIndent,
  type DocxParagraphCommands,
} from "../paragraph/paragraph-commands";
import { readParagraphState, type DocxParagraphFormatState } from "../paragraph/paragraph-format";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxParagraphCommands } from "../paragraph/paragraph-commands";
export type { DocxParagraphFormatState } from "../paragraph/paragraph-format";

/** A3: the paragraph area's factory. The command and state logic lives in
 * ../paragraph/, next to the controls that use it. */
export function createParagraphCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxParagraphCommands, DocxParagraphFormatState> {
  const getEditor = () => context.getEditor();
  return {
    commands: {
      setParagraphAlign: (align) => setParagraphAlign(getEditor(), align),
      stepParagraphIndent: (direction) => stepParagraphIndent(getEditor(), direction),
      setLineSpacing: (multiple) => setLineSpacing(getEditor(), multiple),
      setSpaceBeforePt: (pt) => setSpaceBeforePt(getEditor(), pt),
      setSpaceAfterPt: (pt) => setSpaceAfterPt(getEditor(), pt),
      applyParagraphStyle: (style) => applyParagraphStyle(getEditor(), style),
    },
    readState: readParagraphState,
  };
}

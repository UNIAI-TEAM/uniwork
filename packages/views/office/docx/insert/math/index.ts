import { toMathML } from "./latex-mathml";
import { toOmml } from "./latex-omml";
import { parseLatex } from "./latex-parser";
import { LatexParseError } from "./latex-types";

export interface InlineEquationAttrs {
  /** The exact <m:oMath> fragment the save path stores verbatim. */
  omml: string;
  /** MathML for the editor node view and the dialog preview. */
  mathml: string;
  /** Original input, kept so the node can identify editor-created formulas. */
  latex: string;
  /** Flat token strip (word count / fallback text). */
  text: string;
}

export interface InlineEquationContent {
  type: "docInlineMath";
  attrs: InlineEquationAttrs;
}

/**
 * Compile LaTeX into the attrs of the vendored inline math node (task A11):
 * the same node type the renderer/save path already round-trips as a
 * Run.math <m:oMath>, so an inserted equation needs no new engine op.
 * Throws LatexParseError for input outside the supported subset.
 */
export function compileInlineEquation(latex: string): InlineEquationAttrs {
  const trimmed = latex.trim();
  if (trimmed === "") throw new LatexParseError("Formula is empty");
  const nodes = parseLatex(trimmed);
  const { omml, text } = toOmml(nodes);
  if (omml === "") throw new LatexParseError("Formula is empty");
  return { omml: `<m:oMath>${omml}</m:oMath>`, mathml: toMathML(nodes), latex: trimmed, text };
}

/** The insertContent payload for the inline equation node. */
export function inlineEquationContent(latex: string): InlineEquationContent {
  return { type: "docInlineMath", attrs: compileInlineEquation(latex) };
}

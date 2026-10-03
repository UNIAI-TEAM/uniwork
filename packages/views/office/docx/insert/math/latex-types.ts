/** Raised when the LaTeX input falls outside the supported subset. */
export class LatexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatexParseError";
  }
}

export interface LatexRunNode {
  kind: "run";
  text: string;
  /** true = \text/\mathrm/\operatorname: an upright literal run. */
  plain: boolean;
}

/** A ``{...}`` group; transparent when emitted, but it binds as one atom. */
export interface LatexGroupNode {
  kind: "group";
  body: LatexNode[];
}

export type LatexFractionKind = "bar" | "noBar" | "lin" | "skw";

export interface LatexFractionNode {
  kind: "fraction";
  type: LatexFractionKind;
  num: LatexNode[];
  den: LatexNode[];
}

export interface LatexScriptNode {
  kind: "script";
  base: LatexNode[];
  sub: LatexNode[] | null;
  sup: LatexNode[] | null;
}

export interface LatexRadicalNode {
  kind: "radical";
  /** null = \sqrt{x}; an array = \sqrt[n]{x}. */
  degree: LatexNode[] | null;
  body: LatexNode[];
}

export interface LatexDelimiterNode {
  kind: "delimiter";
  beg: string;
  end: string;
  body: LatexNode[];
}

export interface LatexNaryNode {
  kind: "nary";
  chr: string;
  limLoc: "undOvr" | "subSup";
  sub: LatexNode[] | null;
  sup: LatexNode[] | null;
  body: LatexNode[];
}

export interface LatexAccentNode {
  kind: "accent";
  chr: string;
  body: LatexNode[];
}

export interface LatexBarNode {
  kind: "bar";
  pos: "top" | "bot";
  body: LatexNode[];
}

export interface LatexGroupCharNode {
  kind: "groupChar";
  chr: string;
  pos: "top" | "bot";
  body: LatexNode[];
}

export interface LatexMatrixNode {
  kind: "matrix";
  beg: string;
  end: string;
  /** rows -> cells -> nodes; empty rows are dropped while parsing. */
  rows: LatexNode[][][];
}

/** \lim_{...}: an operator with an under-limit. */
export interface LatexLimitNode {
  kind: "limit";
  limit: LatexNode[];
}

export type LatexNode =
  | LatexRunNode
  | LatexGroupNode
  | LatexFractionNode
  | LatexScriptNode
  | LatexRadicalNode
  | LatexDelimiterNode
  | LatexNaryNode
  | LatexAccentNode
  | LatexBarNode
  | LatexGroupCharNode
  | LatexMatrixNode
  | LatexLimitNode;

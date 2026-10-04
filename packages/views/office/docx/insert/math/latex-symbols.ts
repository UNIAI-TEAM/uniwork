/**
 * The LaTeX subset tables for the equation insert dialog (task A11, UNI-924).
 * Ported from the vendored GenOffice math module
 * (packages/office-upstream/upstream/packages/docx-engine/src/math.ts,
 * Apache-2.0 via UNI-684): the vendored browser seam does not export its
 * LaTeX->OMML helpers, so the insert path carries its own UniWork-owned port
 * with the same supported subset. Read-only reference:
 * genoffice/apps/docs/src/renderer/editor/equation.ts.
 */

/** \name -> glyph; aliases (\le and \leq) share a glyph. */
export const LATEX_SYMBOLS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "⋅",
  ast: "*",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  partial: "∂",
  nabla: "∇",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  wedge: "∧",
  vee: "∨",
  neg: "¬",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  ldots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  circ: "∘",
  degree: "°",
  bullet: "∙",
  star: "⋆",
  emptyset: "∅",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  therefore: "∴",
  because: "∵",
};

/** \sin, \ln, ... render as a plain (upright) run. */
export const LATEX_FUNCTIONS: ReadonlySet<string> = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "arcsin",
  "arccos",
  "arctan",
  "ln",
  "log",
  "exp",
  "max",
  "min",
  "sup",
  "inf",
  "arg",
  "det",
  "gcd",
  "deg",
  "dim",
  "ker",
  "mod",
]);

export interface NaryOperator {
  chr: string;
  /** Where the limits sit: above/below (\sum) or as scripts (\int). */
  limLoc: "undOvr" | "subSup";
}

export const NARY_OPERATORS: Readonly<Record<string, NaryOperator>> = {
  sum: { chr: "∑", limLoc: "undOvr" },
  prod: { chr: "∏", limLoc: "undOvr" },
  coprod: { chr: "∐", limLoc: "undOvr" },
  bigcup: { chr: "⋃", limLoc: "undOvr" },
  bigcap: { chr: "⋂", limLoc: "undOvr" },
  int: { chr: "∫", limLoc: "subSup" },
  iint: { chr: "∬", limLoc: "subSup" },
  iiint: { chr: "∭", limLoc: "subSup" },
  oint: { chr: "∮", limLoc: "subSup" },
};

export const ACCENT_CHARS: Readonly<Record<string, string>> = {
  hat: "\u0302",
  bar: "\u0304",
  vec: "\u20D7",
  dot: "\u0307",
  ddot: "\u0308",
  tilde: "\u0303",
  check: "\u030C",
  breve: "\u0306",
};

export interface MatrixDelimiters {
  beg: string;
  end: string;
}

/** null = a bare matrix without delimiters. */
export const MATRIX_DELIMITERS: Readonly<Record<string, MatrixDelimiters | null>> = {
  matrix: null,
  pmatrix: { beg: "(", end: ")" },
  bmatrix: { beg: "[", end: "]" },
  Bmatrix: { beg: "{", end: "}" },
  vmatrix: { beg: "|", end: "|" },
  Vmatrix: { beg: "‖", end: "‖" },
  cases: { beg: "{", end: "" },
};

/** \left/\right delimiters; "" (``.'') renders nothing. */
export const LEFT_RIGHT_CHARS: Readonly<Record<string, string>> = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "|": "|",
  ".": "",
  "\\{": "{",
  "\\}": "}",
  "\\|": "‖",
  "\\langle": "⟨",
  "\\rangle": "⟩",
  "\\lfloor": "⌊",
  "\\rfloor": "⌋",
  "\\lceil": "⌈",
  "\\rceil": "⌉",
};

/**
 * Symbol picker catalog (task A11): the common Unicode glyph sets Word groups
 * under Insert > Symbol, each with an i18n name that doubles as the search
 * text. Names live under office.docx.symbols.names.* in en/vi.
 */

export type DocxSymbolCategoryId = "currency" | "arrows" | "math" | "punctuation" | "greek";

export interface DocxSymbolDefinition {
  char: string;
  nameKey: string;
}

export interface DocxSymbolCategory {
  id: DocxSymbolCategoryId;
  labelKey: string;
  symbols: readonly DocxSymbolDefinition[];
}

function symbol(char: string, name: string): DocxSymbolDefinition {
  return { char, nameKey: `office.docx.symbols.names.${name}` };
}

function category(id: DocxSymbolCategoryId, symbols: readonly DocxSymbolDefinition[]): DocxSymbolCategory {
  return { id, labelKey: `office.docx.symbols.categories.${id}`, symbols };
}

export const DOCX_SYMBOL_CATEGORIES = [
  category("currency", [
    symbol("$", "dollar"),
    symbol("€", "euro"),
    symbol("₫", "dong"),
    symbol("¥", "yen"),
    symbol("£", "pound"),
    symbol("₩", "won"),
    symbol("₽", "ruble"),
    symbol("₹", "rupee"),
    symbol("฿", "baht"),
    symbol("¢", "cent"),
  ]),
  category("arrows", [
    symbol("←", "leftArrow"),
    symbol("→", "rightArrow"),
    symbol("↔", "leftRightArrow"),
    symbol("⇐", "doubleLeftArrow"),
    symbol("⇒", "doubleRightArrow"),
    symbol("⇔", "doubleLeftRightArrow"),
    symbol("↑", "upArrow"),
    symbol("↓", "downArrow"),
    symbol("↕", "upDownArrow"),
    symbol("↗", "upRightArrow"),
    symbol("↘", "downRightArrow"),
    symbol("↙", "downLeftArrow"),
  ]),
  category("math", [
    symbol("±", "plusMinus"),
    symbol("∓", "minusPlus"),
    symbol("×", "times"),
    symbol("÷", "divide"),
    symbol("≠", "notEqual"),
    symbol("≈", "approxEqual"),
    symbol("≤", "lessOrEqual"),
    symbol("≥", "greaterOrEqual"),
    symbol("∞", "infinity"),
    symbol("∑", "summation"),
    symbol("∏", "product"),
    symbol("∫", "integral"),
    symbol("√", "squareRoot"),
    symbol("∂", "partial"),
    symbol("∇", "nabla"),
    symbol("°", "degree"),
  ]),
  category("punctuation", [
    symbol("–", "enDash"),
    symbol("—", "emDash"),
    symbol("…", "ellipsis"),
    symbol("‘", "leftSingleQuote"),
    symbol("’", "rightSingleQuote"),
    symbol("“", "leftDoubleQuote"),
    symbol("”", "rightDoubleQuote"),
    symbol("·", "middleDot"),
    symbol("•", "bullet"),
    symbol("§", "section"),
    symbol("¶", "pilcrow"),
    symbol("‰", "perMille"),
  ]),
  category("greek", [
    symbol("α", "alpha"),
    symbol("β", "beta"),
    symbol("γ", "gamma"),
    symbol("δ", "delta"),
    symbol("ε", "epsilon"),
    symbol("ζ", "zeta"),
    symbol("η", "eta"),
    symbol("θ", "theta"),
    symbol("ι", "iota"),
    symbol("κ", "kappa"),
    symbol("λ", "lambda"),
    symbol("μ", "mu"),
    symbol("ν", "nu"),
    symbol("ξ", "xi"),
    symbol("ο", "omicron"),
    symbol("π", "pi"),
    symbol("ρ", "rho"),
    symbol("σ", "sigma"),
    symbol("τ", "tau"),
    symbol("υ", "upsilon"),
    symbol("φ", "phi"),
    symbol("χ", "chi"),
    symbol("ψ", "psi"),
    symbol("ω", "omega"),
    symbol("Γ", "upperGamma"),
    symbol("Δ", "upperDelta"),
    symbol("Θ", "upperTheta"),
    symbol("Λ", "upperLambda"),
    symbol("Π", "upperPi"),
    symbol("Σ", "upperSigma"),
    symbol("Φ", "upperPhi"),
    symbol("Ω", "upperOmega"),
  ]),
] as const;

/** Search across every category by localized name or the glyph itself. */
export function filterDocxSymbols(
  query: string,
  translate: (key: string) => string,
): DocxSymbolDefinition[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: DocxSymbolDefinition[] = [];
  for (const group of DOCX_SYMBOL_CATEGORIES) {
    for (const entry of group.symbols) {
      const name = translate(entry.nameKey).toLowerCase();
      if (name.includes(needle) || entry.char === query.trim()) matches.push(entry);
    }
  }
  return matches;
}

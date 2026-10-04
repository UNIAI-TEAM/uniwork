import {
  ACCENT_CHARS,
  LATEX_FUNCTIONS,
  LATEX_SYMBOLS,
  LEFT_RIGHT_CHARS,
  MATRIX_DELIMITERS,
  NARY_OPERATORS,
  type MatrixDelimiters,
} from "./latex-symbols";
import { LatexParseError, type LatexNode, type LatexRadicalNode } from "./latex-types";

/**
 * Recursive-descent parser for the practical LaTeX subset the equation dialog
 * accepts. Ported from the vendored GenOffice parser
 * (packages/office-upstream/.../docx-engine/src/math.ts) with the same
 * grammar and error conditions; it returns an AST so the OMML and MathML
 * emitters share one parse.
 */

interface Parser {
  src: string;
  pos: number;
}

function peek(p: Parser): string {
  return p.src[p.pos] ?? "";
}

function skipSpaces(p: Parser): void {
  while (/\s/.test(peek(p))) p.pos++;
}

/** \name control sequence at the cursor (cursor just after the backslash). */
function readControlName(p: Parser): string {
  const match = /^[A-Za-z]+/.exec(p.src.slice(p.pos));
  if (match) {
    p.pos += match[0].length;
    return match[0];
  }
  const ch = p.src[p.pos] ?? "";
  p.pos++;
  return ch;
}

/** Raw text of a {..} group (for \text and \begin names), braces balanced. */
function readBraceText(p: Parser): string {
  skipSpaces(p);
  if (peek(p) !== "{") throw new LatexParseError("Expected { here");
  p.pos++;
  let depth = 1;
  let out = "";
  while (p.pos < p.src.length) {
    const ch = p.src[p.pos++];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return out;
    }
    if (depth > 0) out += ch;
  }
  throw new LatexParseError("Missing matching }");
}

/** Required {...} group, or — LaTeX semantics — exactly one token. */
function parseGroup(p: Parser): LatexNode[] {
  skipSpaces(p);
  if (peek(p) === "{") {
    p.pos++;
    const body = parseSequence(p, () => peek(p) === "}");
    if (peek(p) !== "}") throw new LatexParseError("Missing matching }");
    p.pos++;
    return body;
  }
  if (peek(p) === "\\") {
    p.pos++;
    return [parseControl(p)];
  }
  const ch = peek(p);
  if (ch === "" || "{}^_&".includes(ch)) throw new LatexParseError("An argument is required here");
  p.pos++;
  return [{ kind: "run", text: ch, plain: false }];
}

/** Sequence until `stop` says done; applies ^/_ scripts to the previous atom. */
function parseSequence(p: Parser, stop: () => boolean): LatexNode[] {
  const nodes: LatexNode[] = [];
  for (;;) {
    skipSpaces(p);
    if (p.pos >= p.src.length || stop()) break;
    const ch = peek(p);
    if (ch === "^" || ch === "_") {
      p.pos++;
      const script = parseGroup(p);
      const other = peek(p);
      const base = nodes.pop();
      if ((other === "^" || other === "_") && other !== ch) {
        p.pos++;
        const second = parseGroup(p);
        const sub = ch === "_" ? script : second;
        const sup = ch === "^" ? script : second;
        nodes.push({ kind: "script", base: base ? [base] : [], sub, sup });
      } else if (ch === "^") {
        nodes.push({ kind: "script", base: base ? [base] : [], sub: null, sup: script });
      } else {
        nodes.push({ kind: "script", base: base ? [base] : [], sub: script, sup: null });
      }
      continue;
    }
    nodes.push(parseAtom(p));
  }
  return nodes;
}

/** One atom: control sequence, group, or a run of ordinary characters. */
function parseAtom(p: Parser): LatexNode {
  skipSpaces(p);
  const ch = peek(p);
  if (ch === "") return { kind: "run", text: "", plain: false };
  if (ch === "{") {
    p.pos++;
    const body = parseSequence(p, () => peek(p) === "}");
    if (peek(p) !== "}") throw new LatexParseError("Missing matching }");
    p.pos++;
    return { kind: "group", body };
  }
  if (ch === "}") throw new LatexParseError("Unexpected }");
  if (ch === "\\") {
    p.pos++;
    return parseControl(p);
  }
  let text = "";
  while (p.pos < p.src.length && !"\\{}^_&".includes(peek(p)) && peek(p) !== "\n") {
    text += p.src[p.pos++];
  }
  if (text === "") throw new LatexParseError(`Cannot parse: "${ch}"`);
  // A following script binds to the last character only ("ab^2" = a·b²):
  // rewind so it becomes its own atom on the next pass.
  const chars = [...text];
  const last = chars[chars.length - 1];
  if (last !== undefined && (peek(p) === "^" || peek(p) === "_") && chars.length > 1) {
    p.pos -= last.length;
    return { kind: "run", text: chars.slice(0, -1).join(""), plain: false };
  }
  return { kind: "run", text, plain: false };
}

function parseNary(p: Parser, chr: string, limLoc: "undOvr" | "subSup"): LatexNode {
  let sub: LatexNode[] | null = null;
  let sup: LatexNode[] | null = null;
  for (let k = 0; k < 2; k++) {
    skipSpaces(p);
    const ch = peek(p);
    if (ch === "_" && sub === null) {
      p.pos++;
      sub = parseGroup(p);
    } else if (ch === "^" && sup === null) {
      p.pos++;
      sup = parseGroup(p);
    } else break;
  }
  // Operand: the next {...} group when present, else the nary stands alone.
  skipSpaces(p);
  const body = peek(p) === "{" ? parseGroup(p) : [];
  return { kind: "nary", chr, limLoc, sub, sup, body };
}

function parseMatrix(p: Parser, env: string, delims: MatrixDelimiters | null): LatexNode {
  const rows: LatexNode[][][] = [[]];
  for (;;) {
    const cell = parseSequence(
      p,
      () => peek(p) === "&" || p.src.startsWith("\\\\", p.pos) || p.src.startsWith("\\end", p.pos),
    );
    const currentRow = rows[rows.length - 1];
    if (currentRow) currentRow.push(cell);
    if (peek(p) === "&") {
      p.pos++;
    } else if (p.src.startsWith("\\\\", p.pos)) {
      p.pos += 2;
      rows.push([]);
    } else if (p.src.startsWith("\\end", p.pos)) {
      p.pos += 4;
      const closing = readBraceText(p);
      if (closing !== env) throw new LatexParseError(`\\end{${closing}} does not match \\begin{${env}}`);
      break;
    } else {
      throw new LatexParseError(`\\begin{${env}} is missing \\end{${env}}`);
    }
  }
  const kept = rows.filter((row) => row.length > 1 || (row[0]?.length ?? 0) > 0);
  return { kind: "matrix", beg: delims?.beg ?? "", end: delims?.end ?? "", rows: kept };
}

function readDelimiter(p: Parser): string {
  skipSpaces(p);
  if (peek(p) === "\\") {
    const start = p.pos;
    p.pos++;
    const name = readControlName(p);
    const key = "\\" + name;
    if (key in LEFT_RIGHT_CHARS) return LEFT_RIGHT_CHARS[key] as string;
    p.pos = start;
    throw new LatexParseError(`Unsupported delimiter: \\${name}`);
  }
  const ch = peek(p);
  if (ch in LEFT_RIGHT_CHARS) {
    p.pos++;
    return LEFT_RIGHT_CHARS[ch] as string;
  }
  throw new LatexParseError(`Unsupported delimiter: "${ch}"`);
}

function parseSqrt(p: Parser): LatexRadicalNode {
  skipSpaces(p);
  let degree: LatexNode[] | null = null;
  if (peek(p) === "[") {
    // Ordinary-char runs do not stop at ']', so isolate the degree source
    // up to the closing bracket and parse it as its own sequence.
    p.pos++;
    const close = p.src.indexOf("]", p.pos);
    if (close === -1) throw new LatexParseError("Missing matching ]");
    const degreeParser: Parser = { src: p.src.slice(p.pos, close), pos: 0 };
    degree = parseSequence(degreeParser, () => degreeParser.pos >= degreeParser.src.length);
    p.pos = close + 1;
  }
  const body = parseGroup(p);
  return { kind: "radical", degree, body };
}

function parseControl(p: Parser): LatexNode {
  const name = readControlName(p);
  const symbol = LATEX_SYMBOLS[name];
  if (symbol !== undefined) return { kind: "run", text: symbol, plain: false };
  const nary = NARY_OPERATORS[name];
  if (nary) return parseNary(p, nary.chr, nary.limLoc);
  const accent = ACCENT_CHARS[name];
  if (accent) return { kind: "accent", chr: accent, body: parseGroup(p) };
  if (LATEX_FUNCTIONS.has(name)) return { kind: "run", text: name, plain: true };
  switch (name) {
    case "frac":
    case "dfrac":
    case "tfrac":
      return { kind: "fraction", type: "bar", num: parseGroup(p), den: parseGroup(p) };
    case "binom": {
      const top = parseGroup(p);
      const bottom = parseGroup(p);
      return {
        kind: "delimiter",
        beg: "(",
        end: ")",
        body: [{ kind: "fraction", type: "noBar", num: top, den: bottom }],
      };
    }
    case "sqrt":
      return parseSqrt(p);
    case "overline":
      return { kind: "bar", pos: "top", body: parseGroup(p) };
    case "underline":
      return { kind: "bar", pos: "bot", body: parseGroup(p) };
    case "underbrace":
      return { kind: "groupChar", chr: "⏟", pos: "bot", body: parseGroup(p) };
    case "overbrace":
      return { kind: "groupChar", chr: "⏞", pos: "top", body: parseGroup(p) };
    case "text":
    case "mathrm":
    case "operatorname":
      return { kind: "run", text: readBraceText(p), plain: true };
    case "lim": {
      skipSpaces(p);
      if (peek(p) === "_") {
        p.pos++;
        return { kind: "limit", limit: parseGroup(p) };
      }
      return { kind: "run", text: "lim", plain: true };
    }
    case "left": {
      const beg = readDelimiter(p);
      const body = parseSequence(p, () => p.src.startsWith("\\right", p.pos));
      if (!p.src.startsWith("\\right", p.pos)) throw new LatexParseError("\\left is missing a matching \\right");
      p.pos += "\\right".length;
      const end = readDelimiter(p);
      return { kind: "delimiter", beg, end, body };
    }
    case "begin": {
      const env = readBraceText(p);
      if (!(env in MATRIX_DELIMITERS)) throw new LatexParseError(`Unsupported environment: \\begin{${env}}`);
      return parseMatrix(p, env, MATRIX_DELIMITERS[env] ?? null);
    }
    case ",":
    case ";":
    case " ":
    case "quad":
    case "qquad":
      return { kind: "run", text: " ", plain: false };
    case "\\":
      throw new LatexParseError("\\\\ is only allowed inside matrix environments");
    case "{":
      return { kind: "run", text: "{", plain: false };
    case "}":
      return { kind: "run", text: "}", plain: false };
    case "%":
    case "&":
    case "$":
    case "#":
    case "_":
    case "^":
      return { kind: "run", text: name, plain: false };
    default:
      throw new LatexParseError(`Unsupported command: \\${name}`);
  }
}

/** Parse LaTeX into the shared AST; throws LatexParseError on unsupported syntax. */
export function parseLatex(latex: string): LatexNode[] {
  const parser: Parser = { src: latex, pos: 0 };
  const nodes = parseSequence(parser, () => parser.pos >= parser.src.length);
  if (parser.pos < parser.src.length) {
    throw new LatexParseError(`Cannot parse: "${parser.src.slice(parser.pos, parser.pos + 12)}"`);
  }
  return nodes;
}

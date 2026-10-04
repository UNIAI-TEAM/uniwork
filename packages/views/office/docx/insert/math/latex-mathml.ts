import type { LatexNode } from "./latex-types";

/**
 * AST -> MathML Core for the inline preview. Mirrors the element shapes the
 * vendored OMML->MathML converter emits (docx-engine math.ts, mmlOf and
 * runTextToMml) so an inserted equation displays through the same MathML host
 * the vendored docInlineMath node view uses.
 */

// The XML-illegal control characters the vendored writer strips before escaping.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXmlText(text: string): string {
  return text
    .replace(ILLEGAL_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const OPERATOR_CHARS = new Set(
  "+-−=<>±∓×÷·⋅∙*/!%&|,;:()[]{}′″∞→←↔⇒⇐⇔∈∉⊂⊃∪∩∀∃∧∨¬≤≥≠≈≡∼∝⊥∥°∂∇",
);

function mo(ch: string, extra = ""): string {
  return `<mo${extra}>${escapeXmlText(ch)}</mo>`;
}

/** Classify a normal run into mn / mi / mo / mtext tokens. */
function runToMathML(text: string, plain: boolean): string {
  if (plain) {
    if (text === "") return "";
    // A lone plain letter would otherwise take the italic single-char default.
    return `<mi${[...text].length === 1 ? ' mathvariant="normal"' : ""}>${escapeXmlText(text)}</mi>`;
  }
  let out = "";
  let i = 0;
  const chars = [...text];
  while (i < chars.length) {
    const ch = chars[i] as string;
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < chars.length && /[0-9.]/.test(chars[i] as string)) num += chars[i++];
      out += `<mn>${num}</mn>`;
    } else if (/[A-Za-z\u0370-\u03FF\u{1D400}-\u{1D7FF}]/u.test(ch)) {
      out += `<mi>${escapeXmlText(ch)}</mi>`;
      i++;
    } else if (ch === " ") {
      i++;
    } else if (OPERATOR_CHARS.has(ch)) {
      // Parens inside a plain run are literal; a math hyphen-minus is a real minus.
      const glyph = ch === "-" ? "\u2212" : ch;
      out += "()[]{}|".includes(ch) ? mo(ch, ' stretchy="false"') : mo(glyph);
      i++;
    } else {
      out += `<mtext>${escapeXmlText(ch)}</mtext>`;
      i++;
    }
  }
  return out;
}

/** mmlSlot: a script/script-like slot is always an mrow. */
function slot(nodes: readonly LatexNode[]): string {
  return `<mrow>${nodes.map(mathmlOf).join("")}</mrow>`;
}

function delimit(body: string, beg: string, end: string): string {
  const open = beg === "" ? "" : mo(beg, ' stretchy="true"');
  const close = end === "" ? "" : mo(end, ' stretchy="true"');
  return `<mrow>${open}${body}${close}</mrow>`;
}

function mathmlOf(node: LatexNode): string {
  switch (node.kind) {
    case "run":
      return runToMathML(node.text, node.plain);
    case "group":
      return node.body.map(mathmlOf).join("");
    case "script": {
      const base = slot(node.base);
      if (node.sub && node.sup) return `<msubsup>${base}${slot(node.sub)}${slot(node.sup)}</msubsup>`;
      if (node.sub) return `<msub>${base}${slot(node.sub)}</msub>`;
      return `<msup>${base}${slot(node.sup ?? [])}</msup>`;
    }
    case "fraction": {
      const attrs =
        node.type === "noBar" ? ' linethickness="0"' : node.type === "lin" || node.type === "skw" ? ' bevelled="true"' : "";
      return `<mfrac${attrs}>${slot(node.num)}${slot(node.den)}</mfrac>`;
    }
    case "radical":
      if (node.degree === null) return `<msqrt>${slot(node.body)}</msqrt>`;
      return `<mroot>${slot(node.body)}${slot(node.degree)}</mroot>`;
    case "delimiter":
      return delimit(slot(node.body), node.beg, node.end);
    case "nary": {
      const op = mo(node.chr, ' stretchy="false"');
      let scripted = op;
      if (node.sub && node.sup) {
        const tag = node.limLoc === "undOvr" ? "munderover" : "msubsup";
        scripted = `<${tag}>${op}${slot(node.sub)}${slot(node.sup)}</${tag}>`;
      } else if (node.sub) {
        const tag = node.limLoc === "undOvr" ? "munder" : "msub";
        scripted = `<${tag}>${op}${slot(node.sub)}</${tag}>`;
      } else if (node.sup) {
        const tag = node.limLoc === "undOvr" ? "mover" : "msup";
        scripted = `<${tag}>${op}${slot(node.sup)}</${tag}>`;
      }
      return `<mrow>${scripted}${slot(node.body)}</mrow>`;
    }
    case "accent":
      return `<mover accent="true">${slot(node.body)}${mo(node.chr)}</mover>`;
    case "bar": {
      const line = node.pos === "top" ? "\u00AF" : "\u005F";
      const tag = node.pos === "top" ? "mover" : "munder";
      return `<${tag}>${slot(node.body)}${mo(line, ' stretchy="true"')}</${tag}>`;
    }
    case "groupChar": {
      const tag = node.pos === "top" ? "mover" : "munder";
      return `<${tag}>${slot(node.body)}${mo(node.chr, ' stretchy="true"')}</${tag}>`;
    }
    case "matrix": {
      const table = node.rows
        .map((row) => `<mtr>${row.map((cell) => `<mtd>${slot(cell)}</mtd>`).join("")}</mtr>`)
        .join("");
      const body = `<mtable>${table}</mtable>`;
      if (node.beg === "" && node.end === "") return body;
      return delimit(body, node.beg, node.end);
    }
    case "limit":
      return `<munder>${slot([{ kind: "run", text: "lim", plain: true }])}${slot(node.limit)}</munder>`;
  }
}

/** Full inline MathML document for the preview and the node's mathml attr. */
export function toMathML(nodes: readonly LatexNode[]): string {
  return `<math display="inline"><mrow>${nodes.map(mathmlOf).join("")}</mrow></math>`;
}

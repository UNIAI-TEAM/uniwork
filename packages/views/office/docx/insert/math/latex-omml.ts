import type { LatexNode } from "./latex-types";

/**
 * AST -> OMML (the children of <m:oMath>), mirroring the element shapes the
 * vendored GenOffice writer round-trips (docx-engine math.ts, mathParagraphXml
 * and the Run.math path in generate.ts). The emitted fragment is what
 * packages/office-engine stores verbatim and what the save path writes back.
 */

export interface OmmlResult {
  omml: string;
  /** Visible <m:t> text in document order (the node's flat fallback text). */
  text: string;
}

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

function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/"/g, "&quot;");
}

/** mathRun: an empty text emits nothing (a plain run carries <m:sty m:val="p">). */
function mathRunXml(text: string, plain: boolean): string {
  if (text === "") return "";
  const rPr = plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : "";
  return `<m:r>${rPr}<m:t xml:space="preserve">${escapeXmlText(text)}</m:t></m:r>`;
}

function nodesXml(nodes: readonly LatexNode[], tokens: string[]): string {
  return nodes.map((node) => nodeXml(node, tokens)).join("");
}

function fractionXml(type: string, num: string, den: string): string {
  const pr = type === "bar" ? "" : `<m:fPr><m:type m:val="${escapeXmlAttr(type)}"/></m:fPr>`;
  return `<m:f>${pr}<m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
}

function matrixXml(node: Extract<LatexNode, { kind: "matrix" }>, tokens: string[]): string {
  const body = node.rows
    .map((row) => `<m:mr>${row.map((cell) => `<m:e>${nodesXml(cell, tokens)}</m:e>`).join("")}</m:mr>`)
    .join("");
  const matrix = `<m:m>${body}</m:m>`;
  if (node.beg === "" && node.end === "") return matrix;
  return (
    "<m:d><m:dPr>" +
    `<m:begChr m:val="${escapeXmlAttr(node.beg)}"/><m:endChr m:val="${escapeXmlAttr(node.end)}"/>` +
    `</m:dPr><m:e>${matrix}</m:e></m:d>`
  );
}

function nodeXml(node: LatexNode, tokens: string[]): string {
  switch (node.kind) {
    case "run":
      if (node.text !== "") tokens.push(node.text);
      return mathRunXml(node.text, node.plain);
    case "group":
      return nodesXml(node.body, tokens);
    case "script": {
      const base = `<m:e>${nodesXml(node.base, tokens)}</m:e>`;
      const sub = node.sub ? `<m:sub>${nodesXml(node.sub, tokens)}</m:sub>` : "";
      const sup = node.sup ? `<m:sup>${nodesXml(node.sup, tokens)}</m:sup>` : "";
      if (sub !== "" && sup !== "") return `<m:sSubSup>${base}${sub}${sup}</m:sSubSup>`;
      if (sub !== "") return `<m:sSub>${base}${sub}</m:sSub>`;
      return `<m:sSup>${base}${sup}</m:sSup>`;
    }
    case "fraction":
      return fractionXml(node.type, nodesXml(node.num, tokens), nodesXml(node.den, tokens));
    case "radical": {
      const inner = `<m:e>${nodesXml(node.body, tokens)}</m:e>`;
      if (node.degree === null) {
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${inner}</m:rad>`;
      }
      return `<m:rad><m:deg>${nodesXml(node.degree, tokens)}</m:deg>${inner}</m:rad>`;
    }
    case "delimiter":
      return (
        "<m:d><m:dPr>" +
        `<m:begChr m:val="${escapeXmlAttr(node.beg)}"/><m:endChr m:val="${escapeXmlAttr(node.end)}"/>` +
        `</m:dPr><m:e>${nodesXml(node.body, tokens)}</m:e></m:d>`
      );
    case "nary": {
      const pr =
        `<m:naryPr><m:chr m:val="${escapeXmlAttr(node.chr)}"/><m:limLoc m:val="${node.limLoc}"/>` +
        (node.sub === null ? '<m:subHide m:val="1"/>' : "") +
        (node.sup === null ? '<m:supHide m:val="1"/>' : "") +
        "</m:naryPr>";
      const sub = node.sub === null ? "" : `<m:sub>${nodesXml(node.sub, tokens)}</m:sub>`;
      const sup = node.sup === null ? "" : `<m:sup>${nodesXml(node.sup, tokens)}</m:sup>`;
      return `<m:nary>${pr}${sub}${sup}<m:e>${nodesXml(node.body, tokens)}</m:e></m:nary>`;
    }
    case "accent":
      return (
        `<m:acc><m:accPr><m:chr m:val="${escapeXmlAttr(node.chr)}"/></m:accPr>` +
        `<m:e>${nodesXml(node.body, tokens)}</m:e></m:acc>`
      );
    case "bar":
      return (
        `<m:bar><m:barPr><m:pos m:val="${node.pos}"/></m:barPr>` +
        `<m:e>${nodesXml(node.body, tokens)}</m:e></m:bar>`
      );
    case "groupChar":
      return (
        `<m:groupChr><m:groupChrPr><m:chr m:val="${escapeXmlAttr(node.chr)}"/>` +
        `<m:pos m:val="${node.pos}"/></m:groupChrPr>` +
        `<m:e>${nodesXml(node.body, tokens)}</m:e></m:groupChr>`
      );
    case "matrix":
      return matrixXml(node, tokens);
    case "limit":
      tokens.push("lim");
      return `<m:limLow><m:e>${mathRunXml("lim", true)}</m:e><m:lim>${nodesXml(node.limit, tokens)}</m:lim></m:limLow>`;
  }
}

/** Serialize the AST and collect its flat token text in one pass. */
export function toOmml(nodes: readonly LatexNode[]): OmmlResult {
  const tokens: string[] = [];
  const omml = nodesXml(nodes, tokens);
  return { omml, text: tokens.join("") };
}

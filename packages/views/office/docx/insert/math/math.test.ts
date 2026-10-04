import { describe, expect, it } from "vitest";
import { compileInlineEquation, inlineEquationContent } from "./index";
import { LatexParseError } from "./latex-types";

const RUN = (text: string, plain = false) =>
  `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<m:t xml:space="preserve">${text}</m:t></m:r>`;

describe("compileInlineEquation: OMML for the supported subset", () => {
  it("wraps symbol runs in the <m:oMath> fragment the save path stores", () => {
    expect(compileInlineEquation("\\alpha")).toEqual({
      omml: `<m:oMath>${RUN("α")}</m:oMath>`,
      mathml: '<math display="inline"><mrow><mi>α</mi></mrow></math>',
      latex: "\\alpha",
      text: "α",
    });
  });

  it("builds superscripts, subscripts and combined scripts", () => {
    expect(compileInlineEquation("x^2").omml).toBe(
      `<m:oMath><m:sSup><m:e>${RUN("x")}</m:e><m:sup>${RUN("2")}</m:sup></m:sSup></m:oMath>`,
    );
    expect(compileInlineEquation("a_i").omml).toBe(
      `<m:oMath><m:sSub><m:e>${RUN("a")}</m:e><m:sub>${RUN("i")}</m:sub></m:sSub></m:oMath>`,
    );
    expect(compileInlineEquation("x_i^2").omml).toBe(
      `<m:oMath><m:sSubSup><m:e>${RUN("x")}</m:e><m:sub>${RUN("i")}</m:sub><m:sup>${RUN("2")}</m:sup></m:sSubSup></m:oMath>`,
    );
  });

  it("binds a script to the last character of an ordinary run", () => {
    expect(compileInlineEquation("ab^2").omml).toBe(
      `<m:oMath>${RUN("a")}<m:sSup><m:e>${RUN("b")}</m:e><m:sup>${RUN("2")}</m:sup></m:sSup></m:oMath>`,
    );
  });

  it("builds fractions and binomials", () => {
    expect(compileInlineEquation("\\frac{a}{b}").omml).toBe(
      `<m:oMath><m:f><m:num>${RUN("a")}</m:num><m:den>${RUN("b")}</m:den></m:f></m:oMath>`,
    );
    expect(compileInlineEquation("\\binom{n}{k}").omml).toBe(
      "<m:oMath><m:d><m:dPr><m:begChr m:val=\"(\"/><m:endChr m:val=\")\"/></m:dPr><m:e>" +
        `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${RUN("n")}</m:num><m:den>${RUN("k")}</m:den></m:f>` +
        "</m:e></m:d></m:oMath>",
    );
  });

  it("builds roots with and without a degree", () => {
    expect(compileInlineEquation("\\sqrt{x}").omml).toBe(
      `<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${RUN("x")}</m:e></m:rad></m:oMath>`,
    );
    expect(compileInlineEquation("\\sqrt[3]{x}").omml).toBe(
      `<m:oMath><m:rad><m:deg>${RUN("3")}</m:deg><m:e>${RUN("x")}</m:e></m:rad></m:oMath>`,
    );
  });

  it("builds n-ary operators with limits and their hiding flags", () => {
    expect(compileInlineEquation("\\sum_{k=0}^{n}").omml).toBe(
      `<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>` +
        `<m:sub>${RUN("k=0")}</m:sub><m:sup>${RUN("n")}</m:sup><m:e></m:e></m:nary></m:oMath>`,
    );
    expect(compileInlineEquation("\\int_a^b").omml).toBe(
      `<m:oMath><m:nary><m:naryPr><m:chr m:val="∫"/><m:limLoc m:val="subSup"/></m:naryPr>` +
        `<m:sub>${RUN("a")}</m:sub><m:sup>${RUN("b")}</m:sup><m:e></m:e></m:nary></m:oMath>`,
    );
  });

  it("builds \\left...\\right delimiters around their body", () => {
    expect(compileInlineEquation("\\left(a\\right)").omml).toBe(
      `<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e>${RUN("a")}</m:e></m:d></m:oMath>`,
    );
  });

  it("builds accents, bars, braces and plain text runs", () => {
    expect(compileInlineEquation("\\hat{x}").omml).toBe(
      `<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e>${RUN("x")}</m:e></m:acc></m:oMath>`,
    );
    expect(compileInlineEquation("\\overline{x}").omml).toBe(
      `<m:oMath><m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${RUN("x")}</m:e></m:bar></m:oMath>`,
    );
    expect(compileInlineEquation("\\underbrace{x}").omml).toBe(
      `<m:oMath><m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/></m:groupChrPr><m:e>${RUN("x")}</m:e></m:groupChr></m:oMath>`,
    );
    expect(compileInlineEquation("\\text{hello world}").omml).toBe(`<m:oMath>${RUN("hello world", true)}</m:oMath>`);
  });

  it("builds matrices with their environment delimiters", () => {
    const omml = compileInlineEquation("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}").omml;
    expect(omml).toBe(
      "<m:oMath><m:d><m:dPr><m:begChr m:val=\"(\"/><m:endChr m:val=\")\"/></m:dPr><m:e><m:m>" +
        `<m:mr><m:e>${RUN("a")}</m:e><m:e>${RUN("b")}</m:e></m:mr>` +
        `<m:mr><m:e>${RUN("c")}</m:e><m:e>${RUN("d")}</m:e></m:mr>` +
        "</m:m></m:e></m:d></m:oMath>",
    );
  });

  it("builds \\lim with its under-limit", () => {
    expect(compileInlineEquation("\\lim_{x \\to 0}").omml).toBe(
      `<m:oMath><m:limLow><m:e>${RUN("lim", true)}</m:e><m:lim>${RUN("x ")}${RUN("→")}${RUN("0")}</m:lim></m:limLow></m:oMath>`,
    );
  });

  it("keeps the flat token text for each construct", () => {
    expect(compileInlineEquation("\\frac{a}{b}").text).toBe("ab");
    expect(compileInlineEquation("\\frac{a}{b}+\\pi").text).toBe("ab+π");
    expect(compileInlineEquation("\\left(a\\right)").text).toBe("a");
  });
});

describe("compileInlineEquation: MathML preview", () => {
  it("emits inline MathML with scripts, numbers and operators classified", () => {
    expect(compileInlineEquation("x^2").mathml).toBe(
      '<math display="inline"><mrow><msup><mrow><mi>x</mi></mrow><mrow><mn>2</mn></mrow></msup></mrow></math>',
    );
    expect(compileInlineEquation("x=1").mathml).toBe(
      '<math display="inline"><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>',
    );
  });

  it("emits fraction, root and delimiter structures", () => {
    expect(compileInlineEquation("\\frac{a}{b}").mathml).toBe(
      '<math display="inline"><mrow><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac></mrow></math>',
    );
    expect(compileInlineEquation("\\sqrt{x}").mathml).toBe(
      '<math display="inline"><mrow><msqrt><mrow><mi>x</mi></mrow></msqrt></mrow></math>',
    );
    expect(compileInlineEquation("\\left(a\\right)").mathml).toBe(
      '<math display="inline"><mrow><mrow><mo stretchy="true">(</mo><mrow><mi>a</mi></mrow><mo stretchy="true">)</mo></mrow></mrow></math>',
    );
  });
});

describe("compileInlineEquation: input handling", () => {
  it("rejects empty input and unsupported syntax", () => {
    expect(() => compileInlineEquation("")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("   ")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("\\unknown")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("{x")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("x}")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("\\left(x")).toThrow(LatexParseError);
    expect(() => compileInlineEquation("\\\\")).toThrow(LatexParseError);
  });

  it("trims the latex attr and returns the insertContent payload", () => {
    const content = inlineEquationContent("  x^2  ");
    expect(content.type).toBe("docInlineMath");
    expect(content.attrs.latex).toBe("x^2");
    expect(content.attrs.omml.startsWith("<m:oMath>")).toBe(true);
    expect(content.attrs.mathml.startsWith('<math display="inline">')).toBe(true);
  });
});

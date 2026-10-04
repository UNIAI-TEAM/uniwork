import { describe, expect, it } from "vitest";
import { matchFunctions } from "./function-catalog";
import { completeFunctionName, functionTokenAt } from "./hint-match";

/** `caret` marked with `|` in the draft, e.g. "=SU|M(A1)". */
function at(marked: string) {
  const caret = marked.indexOf("|");
  if (caret < 0) throw new Error("no caret marker");
  return { draft: marked.replace("|", ""), caret };
}

describe("functionTokenAt", () => {
  it("finds the name token after the formula start and inside nested calls", () => {
    expect(functionTokenAt("=SU", 3)).toEqual({ prefix: "SU", start: 1, end: 3 });
    expect(functionTokenAt("=SUM(A1,AVER", 12)).toEqual({ prefix: "AVER", start: 8, end: 12 });
    expect(functionTokenAt("=IF(A1,SU", 9)).toEqual({ prefix: "SU", start: 7, end: 9 });
    expect(functionTokenAt("=SUM(A1)*MA", 11)).toEqual({ prefix: "MA", start: 9, end: 11 });
  });

  it("reads the token from the caret, and shows nothing once the name is complete", () => {
    const { draft, caret } = at("=SU|M(A1)");
    expect(functionTokenAt(draft, caret)).toEqual({ prefix: "SUM", start: 1, end: 4 });
    // The name is followed by "(": the call is complete, so there is nothing
    // left to suggest.
    expect(functionTokenAt("=SUM(A1)", 2)).toBeNull();
    // A space before the "(" still marks a complete call (`=SUM (A1`).
    expect(functionTokenAt("=SUM (A1", 3)).toBeNull();
    expect(functionTokenAt("=SUM (A1", 4)).toBeNull();
  });

  it("refuses a bare =, a value and a non-formula draft", () => {
    expect(functionTokenAt("=", 1)).toBeNull();
    expect(functionTokenAt("=123", 4)).toBeNull();
    expect(functionTokenAt("SUM(A1)", 6)).toBeNull();
  });

  it("never hints inside a string literal, including doubled quotes", () => {
    expect(functionTokenAt('=CONCATENATE("SU', 15)).toBeNull();
    expect(functionTokenAt('=IF(A1="x",SU', 13)).toEqual({ prefix: "SU", start: 11, end: 13 });
    // `""` inside the literal does not close it, so the name after it is text.
    expect(functionTokenAt('=IF(A1="a""SU",B1)', 14)).toBeNull();
  });

  it("allows spaces between the opener and the name", () => {
    expect(functionTokenAt("=SUM( SU", 8)).toEqual({ prefix: "SU", start: 6, end: 8 });
  });

  it("yields no suggestions for a name-shaped token that matches no function", () => {
    // "A1" sits in a name position, so it is a token - but no catalog function
    // starts with it, so the popup stays closed.
    for (const [draft, caret] of [["=SUM(A1", 7], ["=A1+SUM", 3], ["=A1B2", 5]] as const) {
      const token = functionTokenAt(draft, caret);
      expect(token).not.toBeNull();
      expect(matchFunctions(token!.prefix)).toEqual([]);
    }
  });
});

describe("completeFunctionName", () => {
  it("replaces the typed fragment with NAME( and keeps the rest of the draft", () => {
    const token = functionTokenAt("=SU", 3);
    if (!token) throw new Error("missing token");
    expect(completeFunctionName("=SU", token, "sum")).toEqual({ value: "=SUM(", caret: 5 });
    const nested = functionTokenAt("=IF(A1,AVER", 12);
    if (!nested) throw new Error("missing token");
    expect(completeFunctionName("=IF(A1,AVER", nested, "average")).toEqual({
      value: "=IF(A1,AVERAGE(",
      caret: 15,
    });
  });
});

import { describe, expect, it } from "vitest";
import { planTextToColumns, splitText, textToColumnsStep, type TextToColumnsOptions } from "./text-to-columns";

const NONE: TextToColumnsOptions = { tab: false, semicolon: false, comma: false, space: false, other: "", consecutive: false };
const comma: TextToColumnsOptions = { ...NONE, comma: true };

describe("splitText", () => {
  it("splits on every chosen delimiter", () => {
    expect(splitText("a,b;c\td e", { ...NONE, comma: true, semicolon: true, tab: true, space: true })).toEqual(["a", "b", "c", "d", "e"]);
    expect(splitText("a|b,c", { ...NONE, other: "|" })).toEqual(["a", "b,c"]);
  });
  it("returns the text whole without a delimiter and nothing for blank", () => {
    expect(splitText("a,b", NONE)).toEqual(["a,b"]);
    expect(splitText("", comma)).toEqual([]);
  });
  it("keeps empty fields unless consecutive delimiters collapse", () => {
    expect(splitText("a,,b,", comma)).toEqual(["a", "", "b", ""]);
    expect(splitText("a,,b,", { ...comma, consecutive: true })).toEqual(["a", "b", ""]);
  });
  it("honours the double-quote text qualifier", () => {
    expect(splitText('"a,b",c', comma)).toEqual(["a,b", "c"]);
    expect(splitText('"say ""hi""",c', comma)).toEqual(['say "hi"', "c"]);
    expect(splitText('"open,c', comma)).toEqual(['"open,c']);
  });
});

describe("planTextToColumns", () => {
  const cell = (value: string | number | boolean | null) => ({ value });
  it("plans pieces, width and drops trailing blank rows", () => {
    const plan = planTextToColumns([[cell("a,b")], [cell("c,d,e")], [null], [cell("")]], comma);
    expect(plan.rows).toEqual([["a", "b"], ["c", "d", "e"]]);
    expect(plan.width).toBe(3);
    expect(plan.overwrite).toBe(false);
  });
  it("stringifies numbers and booleans", () => {
    expect(planTextToColumns([[cell(12)], [cell(true)]], comma).rows).toEqual([["12"], ["TRUE"]]);
  });
  it("flags data in a destination cell that will be written", () => {
    const source = [[cell("a,b")], [cell("c")]];
    expect(planTextToColumns(source, comma, [[cell("x")], [null]]).overwrite).toBe(true);
    // Row 2 has one piece: its B cell is untouched, so data there is fine.
    expect(planTextToColumns(source, comma, [[null], [cell("x")]]).overwrite).toBe(false);
  });
});

describe("textToColumnsStep", () => {
  it("writes typed pieces and {} holes at the source column", () => {
    const step = textToColumnsStep("u", "s", { startRow: 1, startColumn: 2 }, [["12", "x"], ["y"]], 2);
    expect(step.id).toBe("sheet.command.set-range-values");
    const params = step.params as { range: unknown; value: Record<string, Record<string, Record<string, unknown>>> };
    expect(params.range).toEqual({ startRow: 1, endRow: 2, startColumn: 2, endColumn: 3 });
    expect(params.value["1"]?.["2"]).toMatchObject({ v: 12 });
    expect(params.value["1"]?.["3"]).toMatchObject({ v: "x" });
    expect(params.value["2"]?.["2"]).toMatchObject({ v: "y" });
    expect(params.value["2"]?.["3"]).toEqual({});
  });
});

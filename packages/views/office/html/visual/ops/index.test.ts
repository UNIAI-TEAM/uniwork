import { describe, expect, it } from "vitest";
import {
  HtmlOpError,
  insertAt,
  patchSet,
  replaceRange,
  type HtmlAttribute,
  type HtmlElementEntry,
  type HtmlOpContext,
  type HtmlOpErrorCode,
  type HtmlTarget,
  type HeadingLevel,
  type ImageAlign,
  type ImageFit,
  type ImageSizeUnit,
  type ImageStyle,
  type ImageStyleInput,
  type InsertPosition,
  type MoveDestination,
  type MoveDirection,
  type PatchOrigin,
  type ResolvedDestination,
  type SourceRange,
  type StrReplaceOptions,
  type TablePresetOptions,
  type TextPresetOptions,
  type WrapTextOptions,
} from "./index";
import { buildFixtureParseMap } from "./test-fixture";

// The barrel's public surface, pinned at the type level the way
// packages/views/office/common/find/find.test.ts pins its own. These are the
// shapes H4-H8 (ribbon, selection bridge, float toolbar, style panel) build
// against, so a change here is a contract change, not an implementation detail.

const RANGE: SourceRange = [0, 0];
const TARGET: HtmlTarget = { sid: 1 };
const CONTEXT: HtmlOpContext = { text: "", map: buildFixtureParseMap("<p>x</p>", 0), version: 0 };
const ORIGIN: PatchOrigin = "inspector";
const POSITION: InsertPosition = { at: 0 };
const DESTINATION: MoveDestination = { appendTo: { sid: 1 } };
const DIRECTION: MoveDirection = "up";
const RESOLVED: ResolvedDestination = { offset: 0, element: CONTEXT.map.elements[0]! };
const STR_OPTIONS: StrReplaceOptions = { all: true };
const WRAP_OPTIONS: WrapTextOptions = { attributes: 'class="x"' };
const TEXT_OPTIONS: TextPresetOptions = { text: "x" };
const TABLE_OPTIONS: TablePresetOptions = { rows: 1, columns: 1 };
const LEVEL: HeadingLevel = 2;
const FIT: ImageFit = "cover";
const ALIGN: ImageAlign = "center";
const UNIT: ImageSizeUnit = "%";
const STYLE: ImageStyle = { width: 1 };
const STYLE_INPUT: ImageStyleInput = { width: 1, aspectRatio: 1 };
const CODE: HtmlOpErrorCode = "no_op";
const ATTR: HtmlAttribute = { name: "a", value: "b", nameStart: 0, nameEnd: 1, valueStart: 2, valueEnd: 3, end: 4, quote: '"' };
const ENTRY: HtmlElementEntry = CONTEXT.map.elements[0]!;

describe("ops barrel surface", () => {
  it("exposes the low-level patch builders the ops share", () => {
    expect(patchSet(3, [], ORIGIN, "x")).toEqual({ patches: [], baseVersion: 3, origin: "inspector", label: "x" });
    expect(insertAt(3, 2, "<p>", ORIGIN, "ins").patches).toEqual([{ from: 2, to: 2, text: "<p>" }]);
    expect(replaceRange(3, 1, 2, "x", ORIGIN, "rep").patches).toEqual([{ from: 1, to: 2, text: "x" }]);
  });

  it("pins the public type shapes", () => {
    expect(RANGE).toEqual([0, 0]);
    expect(TARGET).toEqual({ sid: 1 });
    expect(CONTEXT.version).toBe(0);
    expect(ORIGIN).toBe("inspector");
    expect(POSITION).toEqual({ at: 0 });
    expect(DESTINATION).toEqual({ appendTo: { sid: 1 } });
    expect(DIRECTION).toBe("up");
    expect(RESOLVED.offset).toBe(0);
    expect(STR_OPTIONS.all).toBe(true);
    expect(WRAP_OPTIONS.attributes).toBe('class="x"');
    expect(TEXT_OPTIONS.text).toBe("x");
    expect(TABLE_OPTIONS.rows).toBe(1);
    expect(LEVEL).toBe(2);
    expect(FIT).toBe("cover");
    expect(ALIGN).toBe("center");
    expect(UNIT).toBe("%");
    expect(STYLE.width).toBe(1);
    expect(STYLE_INPUT.aspectRatio).toBe(1);
    expect(CODE).toBe("no_op");
    expect(ATTR.name).toBe("a");
    expect(ENTRY.tag).toBe("p");
  });

  it("raises a typed error with a branchable code", () => {
    const error = new HtmlOpError("element_not_found", "missing", { sid: 9 });
    expect(error.code).toBe("element_not_found");
    expect(error.fields).toEqual({ sid: 9 });
    expect(error).toBeInstanceOf(Error);
  });
});

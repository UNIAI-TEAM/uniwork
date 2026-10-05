// Section edits — the five vendored section ops, pinned three ways:
//   1. a vendored guard reads slide-ops.ts with node:fs and proves every op
//      kind the builder emits is registered there (the binding cannot drift);
//   2. exact op objects for one representative edit per kind;
//   3. refusals for every invalid input class the contract names.
// Plus the pure positional grouping helper the sorter UI consumes.
//
// Round-trip note: the model-level edit -> savePptx -> reopen proof runs in
// the wire round that registers these kinds in model.ts; this file only pins
// the builder surface those registrations consume.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSectionOps,
  groupSlidesIntoSections,
  type OpenedPptxLike,
  type PptxSectionInfo,
  type SectionEdit,
} from "../src/pptx";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const openedWith = (slideCount: number): OpenedPptxLike => ({
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: Array.from({ length: slideCount }, () => ({ elements: [] })),
  },
});

const section = (id: string, name: string, slideIndices: number[]): PptxSectionInfo => ({
  id,
  name,
  slideIndices,
});

describe("vendored binding", () => {
  const source = readFileSync(
    new URL("../../office-upstream/upstream/packages/pptx-ops/src/ops/slide-ops.ts", import.meta.url),
    "utf8",
  );

  it("every op kind the builder emits is registered in slide-ops.ts", () => {
    const everyKind: SectionEdit[] = [
      { op: "add_section", atSlideIndex: 0, name: "Intro" },
      { op: "rename_section", id: "{A}", name: "Intro" },
      { op: "remove_section", id: "{A}" },
      { op: "move_section", id: "{A}", dir: "down" },
      { op: "set_sections", sections: [section("{A}", "Intro", [0])] },
    ];
    const opened = openedWith(2);
    const emitted = new Set<string>();
    for (const edit of everyKind) {
      for (const op of buildSectionOps(opened, 960, edit)) emitted.add(op.op);
    }
    expect([...emitted].sort()).toEqual([
      "addSection",
      "moveSection",
      "removeSection",
      "renameSection",
      "setSections",
    ]);
    for (const op of emitted) {
      // slide-ops.ts registers the five section ops through the sectionOp(name,
      // apply) helper (slide-ops.ts:621-636), so the registry name appears as
      // sectionOp('<op>', ...) — not as a literal `name: '<op>'` property.
      expect(source).toMatch(new RegExp("sectionOp\\(\\s*'" + op + "'"));
    }
  });
});

describe("buildSectionOps op shapes", () => {
  it("emits the exact vendored op object for every kind", () => {
    const opened = openedWith(3);
    expect(buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 1, name: "Intro" })).toEqual([
      { op: "addSection", atSlideIndex: 1, name: "Intro" },
    ]);
    expect(buildSectionOps(opened, 960, { op: "rename_section", id: "{A}", name: "New" })).toEqual([
      { op: "renameSection", id: "{A}", name: "New" },
    ]);
    expect(buildSectionOps(opened, 960, { op: "remove_section", id: "{A}" })).toEqual([
      { op: "removeSection", id: "{A}" },
    ]);
    expect(buildSectionOps(opened, 960, { op: "move_section", id: "{A}", dir: "up" })).toEqual([
      { op: "moveSection", id: "{A}", dir: "up" },
    ]);
    const sections = [section("{A}", "Intro", [0, 1]), section("{B}", "Body", [2])];
    expect(buildSectionOps(opened, 960, { op: "set_sections", sections })).toEqual([
      { op: "setSections", sections },
    ]);
  });

  it("set_sections with an empty array is a valid clear (op shape, not an edit)", () => {
    expect(buildSectionOps(openedWith(2), 960, { op: "set_sections", sections: [] })).toEqual([
      { op: "setSections", sections: [] },
    ]);
  });

  it("emits no target/extra fields — the op is the vendored shape only", () => {
    const [op] = buildSectionOps(openedWith(2), 960, { op: "remove_section", id: "{A}" });
    expect(op).toEqual({ op: "removeSection", id: "{A}" });
    expect(Object.keys(op ?? {})).toEqual(["op", "id"]);
  });
});

describe("buildSectionOps refusals", () => {
  it("add_section refuses a missing slide as no_slide", () => {
    const opened = openedWith(3);
    expect(errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 3, name: "x" }))).toBe(
      "no_slide",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: -1, name: "x" }))).toBe(
      "no_slide",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 0.5, name: "x" }))).toBe(
      "no_slide",
    );
    expect(errCode(() => buildSectionOps(openedWith(0), 960, { op: "add_section", atSlideIndex: 0, name: "x" }))).toBe(
      "no_slide",
    );
  });

  it("refuses empty or whitespace-only ids and names", () => {
    const opened = openedWith(3);
    expect(errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 0, name: "" }))).toBe(
      "bad_section_name",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 0, name: "   " }))).toBe(
      "bad_section_name",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "rename_section", id: "", name: "x" }))).toBe(
      "bad_section_id",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "rename_section", id: "{A}", name: "" }))).toBe(
      "bad_section_name",
    );
    expect(errCode(() => buildSectionOps(opened, 960, { op: "remove_section", id: " " }))).toBe("bad_section_id");
    expect(errCode(() => buildSectionOps(opened, 960, { op: "move_section", id: "", dir: "up" }))).toBe(
      "bad_section_id",
    );
  });

  it("move_section refuses a direction that is not up/down", () => {
    expect(
      errCode(() =>
        buildSectionOps(openedWith(3), 960, { op: "move_section", id: "{A}", dir: "sideways" as "up" }),
      ),
    ).toBe("bad_section_dir");
  });

  it("set_sections refuses a malformed sections payload as bad_sections", () => {
    const opened = openedWith(3);
    const bad = (sections: unknown): string =>
      errCode(() => buildSectionOps(opened, 960, { op: "set_sections", sections } as SectionEdit));
    expect(bad("nope")).toBe("bad_sections");
    expect(bad([null])).toBe("bad_sections");
    expect(bad([{ id: "{A}", name: "x" }])).toBe("bad_sections");
    expect(bad([{ id: "{A}", name: "x", slideIndices: "0" }])).toBe("bad_sections");
    expect(bad([{ id: "{A}", name: "x", slideIndices: [3] }])).toBe("bad_sections");
    expect(bad([{ id: "{A}", name: "x", slideIndices: [-1] }])).toBe("bad_sections");
    expect(bad([{ id: "{A}", name: "x", slideIndices: [1.5] }])).toBe("bad_sections");
  });

  it("set_sections validates entry identity before ranges", () => {
    const opened = openedWith(3);
    const bad = (sections: unknown): string =>
      errCode(() => buildSectionOps(opened, 960, { op: "set_sections", sections } as SectionEdit));
    expect(bad([{ id: "", name: "x", slideIndices: [0] }])).toBe("bad_section_id");
    expect(bad([{ id: "{A}", name: " ", slideIndices: [0] }])).toBe("bad_section_name");
  });

  it("refuses an unregistered edit kind (JS caller) instead of ignoring it", () => {
    expect(errCode(() => buildSectionOps(openedWith(2), 960, { op: "bogus" } as unknown as SectionEdit))).toBe(
      "bad_section_op",
    );
  });

  it("never mutates the deck while refusing", () => {
    const opened = openedWith(3);
    const before = JSON.stringify(opened.deck.slides);
    errCode(() => buildSectionOps(opened, 960, { op: "add_section", atSlideIndex: 9, name: "x" }));
    expect(JSON.stringify(opened.deck.slides)).toBe(before);
  });
});

describe("groupSlidesIntoSections", () => {
  it("keeps the whole deck unsectioned when there are no sections", () => {
    expect(groupSlidesIntoSections([], 3)).toEqual([{ id: null, name: "", start: 0, end: 3 }]);
    expect(groupSlidesIntoSections([], 0)).toEqual([]);
  });

  it("normalizes [start, next start) spans positionally", () => {
    expect(groupSlidesIntoSections([section("{A}", "Intro", [0, 1]), section("{B}", "Body", [2])], 4)).toEqual([
      { id: "{A}", name: "Intro", start: 0, end: 2 },
      { id: "{B}", name: "Body", start: 2, end: 4 },
    ]);
  });

  it("puts the leading slides in an unsectioned group", () => {
    expect(groupSlidesIntoSections([section("{A}", "Intro", [2, 3])], 5)).toEqual([
      { id: null, name: "", start: 0, end: 2 },
      { id: "{A}", name: "Intro", start: 2, end: 5 },
    ]);
  });

  it("resolves overlapping and stale indices positionally", () => {
    // b overlaps a; each start is still its smallest known index.
    expect(groupSlidesIntoSections([section("{A}", "A", [0, 3]), section("{B}", "B", [2, 3])], 4)).toEqual([
      { id: "{A}", name: "A", start: 0, end: 2 },
      { id: "{B}", name: "B", start: 2, end: 4 },
    ]);
    // a stale index past the deck clamps to the deck end: a becomes an empty tail group.
    expect(groupSlidesIntoSections([section("{A}", "A", [9])], 3)).toEqual([
      { id: null, name: "", start: 0, end: 3 },
      { id: "{A}", name: "A", start: 3, end: 3 },
    ]);
  });

  it("lets an empty section inherit the next section's start", () => {
    expect(
      groupSlidesIntoSections([section("{A}", "A", [0]), section("{B}", "B", []), section("{C}", "C", [2])], 4),
    ).toEqual([
      { id: "{A}", name: "A", start: 0, end: 2 },
      { id: "{B}", name: "B", start: 2, end: 2 },
      { id: "{C}", name: "C", start: 2, end: 4 },
    ]);
  });

  it("is pure — the input sections are not rewritten", () => {
    const sections = [section("{A}", "A", [3, 1])];
    const snapshot = JSON.stringify(sections);
    groupSlidesIntoSections(sections, 4);
    expect(JSON.stringify(sections)).toBe(snapshot);
  });
});

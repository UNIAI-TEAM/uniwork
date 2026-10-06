// A5e (UNI-927) - speaker-notes + comment edit-builder tests.
//
// Vendored guard first: every op these builders can emit must exist in
// slide-ops.ts as `name: '<op>'`. Op objects are compared strictly (absent
// fields stay absent) and refusals branch on typed PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNotesCommentOps,
  PptxEngineError,
  type NotesCommentEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides - enough for slide-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s1", elements: [] },
      { id: "s2", elements: [] },
    ],
  },
};

const build = (edit: NotesCommentEdit) => buildNotesCommentOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("notes/comment vendored guard", () => {
  it("emits only op names registered in the vendored slide-ops source", () => {
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    // The exact registry entries A5e binds to (slide-ops.ts:664, :679, :700).
    for (const op of ["setNotes", "addComment", "deleteComment"]) {
      expect(slideOps).toContain("name: '" + op + "'");
    }
  });

  it("pins the notes/comments section to the vendored apply functions", () => {
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    expect(slideOps).toContain("setSlideNotes(ctx.opened, index, String(op.text))");
    expect(slideOps).toContain("addSlideComment(ctx.opened, index, {");
    expect(slideOps).toContain("deleteSlideComment(ctx.opened, index, {");
  });
});

describe("set_notes op building", () => {
  it("builds the exact setNotes op for a non-empty text", () => {
    expect(build({ op: "set_notes", slideIndex: 1, text: "Speaker notes here" })).toStrictEqual([
      { op: "setNotes", target: { slide: 1 }, text: "Speaker notes here" },
    ]);
  });

  it("keeps an empty string (clears the notes body) and multi-line text", () => {
    expect(build({ op: "set_notes", slideIndex: 0, text: "" })[0]).toStrictEqual({
      op: "setNotes",
      target: { slide: 0 },
      text: "",
    });
    expect(build({ op: "set_notes", slideIndex: 0, text: "one\ntwo" })[0]).toStrictEqual({
      op: "setNotes",
      target: { slide: 0 },
      text: "one\ntwo",
    });
  });
});

describe("add_comment op building", () => {
  it("builds the exact addComment op for text + author", () => {
    expect(build({ op: "add_comment", slideIndex: 1, text: "Please review", author: "An Nguyen" })).toStrictEqual([
      { op: "addComment", target: { slide: 1 }, text: "Please review", author: "An Nguyen" },
    ]);
  });

  it("preserves whitespace-only text and author verbatim (non-empty)", () => {
    expect(build({ op: "add_comment", slideIndex: 0, text: " ", author: " " })[0]).toStrictEqual({
      op: "addComment",
      target: { slide: 0 },
      text: " ",
      author: " ",
    });
  });
});

describe("delete_comment op building", () => {
  it("builds the exact deleteComment op for an authorId/idx pair", () => {
    expect(build({ op: "delete_comment", slideIndex: 0, authorId: 2, idx: 3 })).toStrictEqual([
      { op: "deleteComment", target: { slide: 0 }, authorId: 2, idx: 3 },
    ]);
  });

  it("keeps zero as a valid authorId/idx (the pair is the ref)", () => {
    expect(build({ op: "delete_comment", slideIndex: 1, authorId: 0, idx: 0 })[0]).toStrictEqual({
      op: "deleteComment",
      target: { slide: 1 },
      authorId: 0,
      idx: 0,
    });
  });
});

describe("notes/comment refusals", () => {
  it("refuses a missing slide with no_slide for every kind", () => {
    expect(errCode(() => build({ op: "set_notes", slideIndex: 9, text: "x" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_notes", slideIndex: -1, text: "x" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_notes", slideIndex: 0.5, text: "x" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "add_comment", slideIndex: 9, text: "x", author: "a" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "delete_comment", slideIndex: 9, authorId: 1, idx: 1 }))).toBe("no_slide");
    expect(errCode(() => build({ op: "delete_comment", slideIndex: -1, authorId: 1, idx: 1 }))).toBe("no_slide");
  });

  it("refuses non-string notes text with bad_notes_text (empty is allowed)", () => {
    const textEdit = (text: unknown): NotesCommentEdit =>
      ({ op: "set_notes", slideIndex: 0, text }) as NotesCommentEdit;
    for (const text of [undefined, null, 7, true, { toString: () => "x" }]) {
      expect(errCode(() => build(textEdit(text)))).toBe("bad_notes_text");
    }
  });

  it("refuses missing or empty comment text with bad_comment_text", () => {
    const textEdit = (text: unknown): NotesCommentEdit =>
      ({ op: "add_comment", slideIndex: 0, text, author: "a" }) as NotesCommentEdit;
    for (const text of ["", undefined, null, 7]) {
      expect(errCode(() => build(textEdit(text)))).toBe("bad_comment_text");
    }
  });

  it("refuses missing or empty comment author with bad_comment_author", () => {
    const authorEdit = (author: unknown): NotesCommentEdit =>
      ({ op: "add_comment", slideIndex: 0, text: "x", author }) as NotesCommentEdit;
    for (const author of ["", undefined, null, 7]) {
      expect(errCode(() => build(authorEdit(author)))).toBe("bad_comment_author");
    }
  });

  it("refuses non-number authorId/idx with bad_comment_ref", () => {
    const refEdit = (authorId: unknown, idx: unknown): NotesCommentEdit =>
      ({ op: "delete_comment", slideIndex: 0, authorId, idx }) as NotesCommentEdit;
    expect(errCode(() => build(refEdit("2", 1)))).toBe("bad_comment_ref");
    expect(errCode(() => build(refEdit(2, "1")))).toBe("bad_comment_ref");
    expect(errCode(() => build(refEdit(undefined, 1)))).toBe("bad_comment_ref");
    expect(errCode(() => build(refEdit(2, undefined)))).toBe("bad_comment_ref");
    expect(errCode(() => build(refEdit(null, null)))).toBe("bad_comment_ref");
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "add_comment", slideIndex: 0, text: "", author: "a" } as unknown as NotesCommentEdit);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("bad_comment_text");
  });
});
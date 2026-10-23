// parsePdfOps: envelope edits[] -> PdfEditRequest, and the typed refusals
// (malformed args, out-of-range values, unknown/unsupported ops, caps).
import { describe, expect, it } from "vitest";

import { parsePdfOps, PdfOpError } from "./ops";

const refusal = (edits: unknown[]): PdfOpError => {
  try {
    parsePdfOps(edits);
  } catch (e) {
    expect(e).toBeInstanceOf(PdfOpError);
    return e as PdfOpError;
  }
  throw new Error("expected parsePdfOps to refuse");
};

const rect = [0, 0, 10, 10];

describe("parsePdfOps envelope", () => {
  it("returns an empty request for no edits", () => {
    expect(parsePdfOps([])).toEqual({});
  });

  it("refuses a non-object item and a missing op name", () => {
    expect(refusal([42]).message).toBe("<item>.: object required");
    expect(refusal([{}]).field).toBe("op");
    expect(refusal([null]).opName).toBe("<item>");
    expect(refusal([[]]).opName).toBe("<item>");
  });

  it("caps the number of ops per job at 1000", () => {
    const many = Array.from({ length: 1001 }, () => ({ op: "flattenForms" }));
    expect(refusal(many).opName).toBe("<edits>");
    expect(parsePdfOps(many.slice(0, 1000)).flattenForms).toBe(true);
  });

  it("marks an unknown op and the OCR ops as unsupported rather than malformed", () => {
    const unknown = refusal([{ op: "teleport" }]);
    expect(unknown.unsupported).toBe(true);
    expect(unknown.message).toContain("unknown op for pdf");
    for (const op of ["ocr", "ocrPage"]) {
      const e = refusal([{ op }]);
      expect(e.unsupported).toBe(true);
      expect(e.message).toContain("ocr is not a capability");
    }
    expect(refusal([{ op: "deletePage" }]).unsupported).toBe(false);
  });

  it("merges target and attributes, with attributes winning", () => {
    const req = parsePdfOps([
      { op: "deletePage", target: { pageIndex: 1 }, attributes: { pageIndex: 3 } },
    ]);
    expect(req.deletedPages).toEqual([3]);
  });
});

describe("page-level ops", () => {
  it("expands rotatePages into one rotation per page and checks the direction", () => {
    expect(parsePdfOps([{ op: "rotatePages", attributes: { pages: [0, 2], dir: -90 } }]).rotations).toEqual([
      { pageIndex: 0, delta: -90 },
      { pageIndex: 2, delta: -90 },
    ]);
    expect(refusal([{ op: "rotatePages", attributes: { pages: [0], dir: 45 } }]).field).toBe("dir");
    expect(refusal([{ op: "rotatePages", attributes: { pages: "0", dir: 90 } }]).field).toBe("pages");
    expect(refusal([{ op: "rotatePages", attributes: { pages: [1.5], dir: 90 } }]).message).toContain(
      "integer required",
    );
  });

  it("accepts a null order as 'no reorder' and refuses a non-array order", () => {
    expect(parsePdfOps([{ op: "setPageOrder", attributes: { order: null } }]).pageOrder).toBeUndefined();
    expect(parsePdfOps([{ op: "setPageOrder", attributes: { order: [2, 0, 1] } }]).pageOrder).toEqual([2, 0, 1]);
    expect(refusal([{ op: "setPageOrder", attributes: { order: "0,1" } }]).field).toBe("order");
    expect(refusal([{ op: "setPageOrder", attributes: {} }]).field).toBe("order");
  });

  it("reads metadata from a nested or flat shape and refuses non-string fields", () => {
    expect(parsePdfOps([{ op: "setMetadata", attributes: { metadata: { title: "T" } } }]).metadata?.title).toBe("T");
    expect(parsePdfOps([{ op: "setMetadata", attributes: { author: "A", keywords: "" } }]).metadata).toMatchObject({
      author: "A",
      keywords: "",
    });
    expect(refusal([{ op: "setMetadata", attributes: { title: 5 } }]).field).toBe("title");
  });

  it("refuses an integer that is not safe and a non-finite number", () => {
    expect(refusal([{ op: "deletePage", attributes: { pageIndex: 2 ** 60 } }]).message).toContain("integer required");
    expect(refusal([{ op: "deletePage", attributes: { pageIndex: Number.NaN } }]).message).toContain("number required");
    expect(refusal([{ op: "deletePage", attributes: { pageIndex: "1" } }]).message).toContain("number required");
  });

  it("caps list sizes at 10000 items", () => {
    const pages = Array.from({ length: 10_001 }, (_, i) => i);
    expect(refusal([{ op: "rotatePages", attributes: { pages, dir: 90 } }]).message).toContain("at most 10000 items");
  });
});

describe("annotation deletes", () => {
  const annot = { pageIndex: 0, objNum: 7, subtype: "note", rect, contents: "hi" };

  it("parses the flat and the upstream nested annot shape", () => {
    const flat = parsePdfOps([{ op: "deleteSavedAnnot", attributes: annot }]).annotDeletes;
    const nested = parsePdfOps([{ op: "deleteSavedAnnot", attributes: { annot } }]).annotDeletes;
    expect(flat).toEqual([annot]);
    expect(nested).toEqual(flat);
  });

  it("refuses an unknown subtype and a malformed rect", () => {
    expect(refusal([{ op: "deleteSavedAnnot", attributes: { ...annot, subtype: "stamp" } }]).message).toContain(
      "unknown subtype",
    );
    expect(refusal([{ op: "deleteSavedAnnot", attributes: { ...annot, rect: [1, 2, 3] } }]).field).toBe("rect");
    expect(refusal([{ op: "deleteSavedAnnot", attributes: { ...annot, objNum: 1.5 } }]).field).toBe("objNum");
  });
});

describe("markups and drawings", () => {
  const quad = [0, 10, 10, 10, 0, 0, 10, 0];
  const markup = { pageIndex: 0, type: "highlight", color: [1, 1, 0], quads: [quad] };

  it("parses a markup, flat or nested under `markup`", () => {
    const expected = [{ pageIndex: 0, type: "highlight", color: [1, 1, 0], quads: [quad] }];
    expect(parsePdfOps([{ op: "addMarkup", attributes: markup }]).markups).toEqual(expected);
    expect(parsePdfOps([{ op: "addMarkup", attributes: { markup } }]).markups).toEqual(expected);
  });

  it("refuses bad markup type, empty or short quads and out-of-range colour", () => {
    expect(refusal([{ op: "addMarkup", attributes: { ...markup, type: "squiggle" } }]).field).toBe("type");
    expect(refusal([{ op: "addMarkup", attributes: { ...markup, quads: [] } }]).field).toBe("quads");
    expect(refusal([{ op: "addMarkup", attributes: { ...markup, quads: [[1, 2, 3]] } }]).field).toBe("quads[0]");
    expect(refusal([{ op: "addMarkup", attributes: { ...markup, color: [255, 0, 0] } }]).message).toContain(
      "normalized tuple",
    );
    expect(refusal([{ op: "addMarkup", attributes: { ...markup, color: [1, 0] } }]).field).toBe("color");
  });

  const base = { pageIndex: 0, color: [0, 0, 1], width: 2 };

  it("parses rect, ellipse, line, arrow and ink drawings from nested geometry", () => {
    const rectGeo = { rect: { x: 1, y: 2, width: 3, height: 4 } };
    const lineGeo = { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } };
    const inkGeo = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const req = parsePdfOps([
      { op: "addDrawing", attributes: { ...base, kind: "rect", geometry: rectGeo, fill: [1, 0, 0] } },
      { op: "addDrawing", attributes: { ...base, kind: "ellipse", geometry: rectGeo } },
      { op: "addDrawing", attributes: { ...base, kind: "line", geometry: lineGeo } },
      { op: "addDrawing", attributes: { ...base, kind: "arrow", geometry: lineGeo } },
      { op: "addDrawing", attributes: { drawing: { ...base, kind: "ink", geometry: inkGeo } } },
    ]);
    expect(req.drawings?.map((d) => d.kind)).toEqual(["rect", "ellipse", "line", "arrow", "ink"]);
    expect(req.drawings?.[0]?.fill).toEqual([1, 0, 0]);
    expect(req.drawings?.[4]?.geometry).toEqual(inkGeo);
  });

  it("accepts the alias fields (type, strokeColor, strokeWidth, fillColor) and flat rect/start/end", () => {
    const req = parsePdfOps([
      { op: "addDrawing", attributes: { pageIndex: 1, type: "rect", rect: [10, 20, 40, 60], strokeColor: [0, 0, 0], strokeWidth: 1, fillColor: [1, 1, 1] } },
      { op: "addDrawing", attributes: { pageIndex: 1, kind: "line", start: [0, 0], end: [9, 9], color: [0, 0, 0], width: 1 } },
    ]);
    expect(req.drawings?.[0]?.geometry).toEqual({ rect: { x: 10, y: 20, width: 30, height: 40 } });
    expect(req.drawings?.[0]?.fill).toEqual([1, 1, 1]);
    expect(req.drawings?.[1]?.geometry).toEqual({ start: { x: 0, y: 0 }, end: { x: 9, y: 9 } });
  });

  it("refuses drawings with inconsistent kind/geometry, bad width and missing geometry", () => {
    const rectGeo = { rect: { x: 1, y: 2, width: 3, height: 4 } };
    const lineGeo = { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } };
    const onePoint = { points: [{ x: 0, y: 0 }] };
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: "blob", geometry: rectGeo }, "kind"],
      [{ kind: "rect", geometry: rectGeo, width: 0 }, "width"],
      [{ kind: "rect", geometry: { rect: { x: 0, y: 0, width: 0, height: 5 } } }, "geometry.rect"],
      [{ kind: "ellipse", geometry: lineGeo }, "geometry.rect"],
      [{ kind: "line", geometry: rectGeo }, "geometry"],
      [{ kind: "arrow", geometry: onePoint }, "geometry"],
      [{ kind: "ink", geometry: rectGeo }, "geometry.points"],
      [{ kind: "ink", geometry: onePoint }, "geometry.points"],
      [{ kind: "rect" }, "geometry"],
      [{ kind: "rect", geometry: {} }, "geometry"],
      [{ kind: "ink", geometry: { points: [{ x: 0, y: 0 }, 5] } }, "geometry.points[1]"],
      [{ kind: "rect", geometry: { rect: { x: "a", y: 0, width: 1, height: 1 } } }, "geometry.rect.x"],
      [{ kind: "rect", geometry: rectGeo, color: [2, 0, 0] }, "color"],
    ];
    for (const [extra, field] of cases) {
      const e = refusal([{ op: "addDrawing", attributes: { ...base, ...extra } }]);
      expect(e.field, JSON.stringify(extra)).toBe(field);
    }
  });
});

describe("notes", () => {
  const note = { pageIndex: 0, rect: [10, 10, 30, 30], contents: "note" };

  it("parses a note with author, time, ids and a reply target", () => {
    const req = parsePdfOps([
      { op: "addNote", attributes: { ...note, author: "An", createdMs: 5, localId: "a" } },
      { op: "addNote", attributes: { note: { ...note, replyToLocalId: "a" } } },
      { op: "addNote", attributes: { ...note, replyTo: { objNum: 4, rect: [1, 2, 3, 4], contents: "parent" } } },
    ]);
    expect(req.notes?.[0]).toMatchObject({ author: "An", createdMs: 5, localId: "a" });
    expect(req.notes?.[1]?.replyToLocalId).toBe("a");
    expect(req.notes?.[2]?.replyTo).toEqual({ objNum: 4, rect: [1, 2, 3, 4], contents: "parent" });
  });

  it("refuses blank contents, empty rects and both reply forms together", () => {
    expect(refusal([{ op: "addNote", attributes: { ...note, contents: "   " } }]).message).toContain(
      "non-empty text required",
    );
    expect(refusal([{ op: "addNote", attributes: { ...note, rect: [10, 10, 10, 30] } }]).field).toBe("rect");
    expect(refusal([{ op: "addNote", attributes: { ...note, rect: [10, 30, 30, 10] } }]).field).toBe("rect");
    expect(
      refusal([{ op: "addNote", attributes: { ...note, replyToLocalId: "a", replyTo: { objNum: 1 } } }]).message,
    ).toContain("mutually exclusive");
    expect(refusal([{ op: "addNote", attributes: { ...note, replyTo: "x" } }]).message).toContain(
      "reply target object required",
    );
    expect(
      refusal([{ op: "addNote", attributes: { ...note, replyTo: { objNum: 1, rect, contents: "" } } }]).field,
    ).toBe("replyTo.contents");
  });

  it("parses editSavedNote in flat and upstream nested shapes", () => {
    const flat = parsePdfOps([
      { op: "editSavedNote", attributes: { pageIndex: 0, objNum: 3, rect, oldContents: "old", contents: "new" } },
    ]).noteEdits;
    const nested = parsePdfOps([
      { op: "editSavedNote", attributes: { annot: { pageIndex: 0, objNum: 3, rect, contents: "old" }, contents: "new" } },
    ]).noteEdits;
    expect(flat).toEqual([{ pageIndex: 0, objNum: 3, rect, oldContents: "old", contents: "new" }]);
    expect(nested).toEqual(flat);
    expect(refusal([{ op: "editSavedNote", attributes: { pageIndex: 0, objNum: 3, rect, oldContents: " ", contents: "x" } }]).field).toBe(
      "oldContents",
    );
  });

  it("parses resolveNote and refuses a non-boolean state", () => {
    const attrs = { pageIndex: 0, objNum: 3, rect, contents: "c", resolved: true };
    expect(parsePdfOps([{ op: "resolveNote", attributes: attrs }]).noteResolves).toEqual([attrs]);
    expect(refusal([{ op: "resolveNote", attributes: { ...attrs, resolved: "yes" } }]).message).toContain(
      "boolean required",
    );
  });
});

describe("text ops", () => {
  const edit = { pageIndex: 0, rect, oldText: "a", newText: "b", fontSize: 12 };

  it("parses a text edit with every optional style field", () => {
    const req = parsePdfOps([
      {
        op: "putTextEdit",
        attributes: {
          ...edit,
          newFontSize: 14,
          newColor: [1, 2, 3],
          colorRuns: [{ start: 0, end: 1, color: [4, 5, 6] }],
          styleRuns: [{ start: 0, end: 1, color: [1, 1, 1], font: "noto", size: 9, bold: true, italic: false }],
          newFont: "arial",
          origin: [5, 6],
          lineLeading: 15,
          lineXOffsets: [0, 4],
          align: "center",
          newBold: true,
          newItalic: false,
          translate: [2, 3],
        },
      },
    ]);
    const parsed = req.textEdits?.[0];
    expect(parsed).toMatchObject({ newFontSize: 14, align: "center", translate: [2, 3], lineXOffsets: [0, 4], origin: [5, 6] });
    expect(parsed?.styleRuns?.[0]).toMatchObject({ font: "noto", bold: true, italic: false, size: 9 });
    expect(parsed?.colorRuns).toEqual([{ start: 0, end: 1, color: [4, 5, 6] }]);
  });

  it("refuses malformed text-edit fields", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ colorRuns: "x" }, "colorRuns"],
      [{ colorRuns: [5] }, "colorRuns"],
      [{ colorRuns: [{ start: 0, end: 1, color: [1] }] }, "colorRuns.color"],
      [{ styleRuns: {} }, "styleRuns"],
      [{ styleRuns: [null] }, "styleRuns"],
      [{ styleRuns: [{ start: 0, end: 1, bold: "y" }] }, "styleRuns.bold"],
      [{ lineXOffsets: 3 }, "lineXOffsets"],
      [{ lineXOffsets: ["a"] }, "lineXOffsets"],
      [{ align: "justify" }, "align"],
      [{ origin: [1] }, "origin"],
      [{ newColor: [1, 2] }, "newColor"],
      [{ oldText: 5 }, "oldText"],
    ];
    for (const [extra, field] of cases) {
      expect(refusal([{ op: "putTextEdit", attributes: { ...edit, ...extra } }]).field, JSON.stringify(extra)).toBe(field);
    }
  });

  it("refuses text longer than the 1 MiB cap", () => {
    const e = refusal([{ op: "putTextEdit", attributes: { ...edit, newText: "x".repeat((1 << 20) + 1) } }]);
    expect(e.message).toContain("text exceeds");
  });

  it("parses a text insert and refuses malformed ones", () => {
    const ins = { pageIndex: 0, origin: [10, 20], text: "hello", fontSize: 11, color: [0, 0, 0] };
    const req = parsePdfOps([
      { op: "addTextInsert", attributes: { ...ins, font: "times", bold: true, italic: true, lineLeading: 13, lineXOffsets: [0], align: "right", rotate: 90 } },
    ]);
    expect(req.textInserts?.[0]).toMatchObject({ font: "times", align: "right", rotate: 90, lineXOffsets: [0] });
    expect(refusal([{ op: "addTextInsert", attributes: { ...ins, align: "x" } }]).field).toBe("align");
    expect(refusal([{ op: "addTextInsert", attributes: { ...ins, lineXOffsets: "x" } }]).field).toBe("lineXOffsets");
    expect(refusal([{ op: "addTextInsert", attributes: { ...ins, color: [0, 0] } }]).field).toBe("color");
    expect(refusal([{ op: "addTextInsert", attributes: { ...ins, origin: [0] } }]).field).toBe("origin");
  });
});

describe("image edits and stamps", () => {
  const b64 = "aGk=";

  it("parses each image edit kind", () => {
    const req = parsePdfOps([
      { op: "addImageEdit", attributes: { kind: "insertImage", pageIndex: 0, image: b64, rect, layer: "belowText", rotate: 90 } },
      { op: "addImageEdit", attributes: { kind: "transformImage", pageIndex: 0, oldRect: rect, rect, layer: "aboveText", quarterTurns: 1 } },
      { op: "addImageEdit", attributes: { kind: "replaceImage", pageIndex: 0, oldRect: rect, rect, image: b64 } },
      { op: "addImageEdit", attributes: { kind: "deleteImage", pageIndex: 2, oldRect: rect } },
    ]);
    expect(req.imageEdits?.map((e) => e.kind)).toEqual(["insertImage", "transformImage", "replaceImage", "deleteImage"]);
    expect(req.imageEdits?.[1]).toMatchObject({ layer: "aboveText", quarterTurns: 1 });
    expect(req.imageEdits?.[3]).toEqual({ kind: "deleteImage", pageIndex: 2, oldRect: rect });
  });

  it("refuses an unknown image kind, a bad layer and an oversize image", () => {
    expect(refusal([{ op: "addImageEdit", attributes: { kind: "crop", pageIndex: 0 } }]).field).toBe("kind");
    expect(
      refusal([{ op: "addImageEdit", attributes: { kind: "insertImage", pageIndex: 0, image: b64, rect, layer: "middle" } }]).field,
    ).toBe("layer");
    expect(
      refusal([{ op: "addImageEdit", attributes: { kind: "insertImage", pageIndex: 0, image: b64, rect } }]).message,
    ).toContain("string required");
    expect(
      refusal([
        { op: "addImageEdit", attributes: { kind: "replaceImage", pageIndex: 0, oldRect: rect, rect, image: "A".repeat((64 << 20) + 1) } },
      ]).message,
    ).toContain("image data exceeds the bound");
    expect(
      refusal([{ op: "addImageEdit", attributes: { kind: "deleteImage", pageIndex: 0, oldRect: [1, 2] } }]).field,
    ).toBe("oldRect");
  });

  const stamp = { kind: "image", pageIndex: 0, rect, contentType: "image/png", image: b64 };

  it("parses stamps flat or nested, keeps the signature id and quarter turns", () => {
    const req = parsePdfOps([
      { op: "addStamp", attributes: { stamp: { ...stamp, kind: "signature", signatureId: "sig-1", quarterTurns: 90 } } },
      { op: "addStamp", attributes: stamp },
    ]);
    expect(req.stamps?.[0]).toMatchObject({ kind: "signature", signatureId: "sig-1", quarterTurns: 90 });
    expect(req.stamps?.[1]).not.toHaveProperty("signatureId");
  });

  it("refuses bad stamp kind, content type, rect, image and quarter turns", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: "seal" }, "kind"],
      [{ contentType: "image/gif" }, "contentType"],
      [{ rect: [0, 0, 0, 10] }, "rect"],
      [{ rect: [0, 10, 10, 0] }, "rect"],
      [{ image: "" }, "image"],
      [{ quarterTurns: 45 }, "quarterTurns"],
      [{ signatureId: 7 }, "signatureId"],
    ];
    for (const [extra, field] of cases) {
      expect(refusal([{ op: "addStamp", attributes: { ...stamp, ...extra } }]).field, JSON.stringify(extra)).toBe(field);
    }
  });
});

describe("form values", () => {
  it("parses text, checkbox and radio writes from every envelope shape", () => {
    const req = parsePdfOps([
      { op: "setFormValue", field: { name: "Name", kind: "text", value: "An" } },
      { op: "setFormValue", value: { name: "Agree", kind: "checkbox", checked: true } },
      { op: "setFormValue", attributes: { name: "Opt", kind: "radio", value: "b" } },
      { op: "setFormValue", attributes: { name: "Two", kind: "radio", value: false } },
      { op: "setFormValue", name: "Pick", kind: "choice", value: "x" },
      { op: "setFormValue", attributes: { field: { name: "Deep", kind: "checkbox", value: false } } },
    ]);
    expect(req.formValues).toEqual([
      { name: "Name", kind: "text", value: "An" },
      { name: "Agree", kind: "checkbox", value: true },
      { name: "Opt", kind: "radio", value: "b" },
      { name: "Two", kind: "radio", value: false },
      { name: "Pick", kind: "choice", value: "x" },
      { name: "Deep", kind: "checkbox", value: false },
    ]);
  });

  it("refuses an empty name, unknown kind, and a value of the wrong type", () => {
    expect(refusal([{ op: "setFormValue", field: { name: "  ", kind: "text", value: "x" } }]).field).toBe("name");
    expect(refusal([{ op: "setFormValue", field: { name: "n", kind: "slider", value: "x" } }]).field).toBe("kind");
    expect(refusal([{ op: "setFormValue", field: { name: "n", kind: "checkbox", value: "yes" } }]).message).toContain(
      "boolean required",
    );
    expect(refusal([{ op: "setFormValue", field: { name: "n", kind: "text", value: 5 } }]).message).toContain(
      "string required",
    );
    expect(refusal([{ op: "setFormValue", field: { kind: "text", value: "x" } }]).field).toBe("name");
  });

  it("turns flattenForms on", () => {
    expect(parsePdfOps([{ op: "flattenForms" }]).flattenForms).toBe(true);
  });
});

describe("page-structure ops", () => {
  it("parses blank pages (front insert, explicit size) and refuses half a size", () => {
    expect(parsePdfOps([{ op: "insertBlankPage", attributes: { afterPageIndex: -1 } }]).blankPages).toEqual([
      { afterPageIndex: -1 },
    ]);
    expect(
      parsePdfOps([{ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 100, height: 200 } }]).blankPages,
    ).toEqual([{ afterPageIndex: 0, width: 100, height: 200 }]);
    expect(refusal([{ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 100 } }]).field).toBe("size");
    expect(refusal([{ op: "insertBlankPage", attributes: { afterPageIndex: -2 } }]).message).toContain("-1 or a non-negative");
    expect(refusal([{ op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 0, height: 5 } }]).field).toBe("width");
  });

  it("parses insertPdfPages and refuses an oversize pdf or an empty page list", () => {
    expect(
      parsePdfOps([{ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "AAAA", pages: [0, 1] } }]).insertedPdfs,
    ).toEqual([{ afterPageIndex: 0, pdf: "AAAA", pages: [0, 1] }]);
    expect(refusal([{ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "A".repeat((64 << 20) + 1) } }]).message).toContain(
      "pdf data exceeds the bound",
    );
    expect(refusal([{ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "AAAA", pages: [] } }]).message).toContain(
      "at least one page required",
    );
  });

  it("parses extract/merge/split once each and refuses a second of the same kind", () => {
    const req = parsePdfOps([
      { op: "extractPages", attributes: { pages: [0, 1], name: "  part  " } },
      { op: "mergePdfs", attributes: { pdfs: ["AAAA"], name: "  " } },
      { op: "splitPdf", attributes: { chunkSize: 2 } },
    ]);
    expect(req.extractPages).toEqual({ pages: [0, 1], name: "part" });
    expect(req.mergePdfs).toEqual({ pdfs: ["AAAA"], name: undefined });
    expect(req.splitPdf).toEqual({ chunkSize: 2, name: undefined });
    for (const attrs of [
      { op: "extractPages", attributes: { pages: [0] } },
      { op: "mergePdfs", attributes: { pdfs: ["AAAA"] } },
      { op: "splitPdf", attributes: { chunkSize: 1 } },
    ]) {
      expect(refusal([attrs, attrs]).message).toContain("at most one");
    }
  });

  it("refuses empty merge input, non-positive chunk sizes and oversize merge members", () => {
    expect(refusal([{ op: "mergePdfs", attributes: { pdfs: [] } }]).field).toBe("pdfs");
    expect(refusal([{ op: "mergePdfs", attributes: { pdfs: [3] } }]).field).toBe("pdfs[0]");
    expect(refusal([{ op: "mergePdfs", attributes: { pdfs: ["A".repeat((64 << 20) + 1)] } }]).message).toContain(
      "pdf data exceeds the bound",
    );
    expect(refusal([{ op: "splitPdf", attributes: { chunkSize: 0 } }]).message).toContain("positive integer required");
    expect(refusal([{ op: "extractPages", attributes: { pages: [] } }]).field).toBe("pages");
  });

  it("parses page boxes from flat, attributes and nested shapes", () => {
    const req = parsePdfOps([
      { op: "setPageBox", pages: [0], box: "crop", rect: [0, 0, 100, 100] },
      { op: "setPageBox", attributes: { pages: [1], box: "media", rect: [0, 0, 50, 60] } },
      { op: "setPageBox", pageBox: { pages: [2], box: "crop", rect: [1, 1, 9, 9] } },
    ]);
    expect(req.pageBoxes).toEqual([
      { pages: [0], box: "crop", rect: [0, 0, 100, 100] },
      { pages: [1], box: "media", rect: [0, 0, 50, 60] },
      { pages: [2], box: "crop", rect: [1, 1, 9, 9] },
    ]);
  });

  it("refuses a bad page box kind and a degenerate rect", () => {
    expect(refusal([{ op: "setPageBox", pages: [0], box: "trim", rect: [0, 0, 1, 1] }]).field).toBe("box");
    expect(refusal([{ op: "setPageBox", pages: [0], box: "crop", rect: [5, 0, 5, 9] }]).field).toBe("rect");
    expect(refusal([{ op: "setPageBox", pages: [0], box: "crop", rect: [0, 9, 9, 0] }]).field).toBe("rect");
  });

  it("parses N-up with an optional paper and refuses bad layouts, papers and a second setNUp", () => {
    const req = parsePdfOps([{ op: "setNUp", pages: [0, 1], layout: { rows: 1, cols: 2 }, paper: "a4" }]);
    expect(req.nUp).toEqual({ pages: [0, 1], layout: { rows: 1, cols: 2 }, paper: "a4" });
    expect(parsePdfOps([{ op: "setNUp", nUp: { pages: [0], layout: { rows: 2, cols: 2 } } }]).nUp).toEqual({
      pages: [0],
      layout: { rows: 2, cols: 2 },
    });
    expect(refusal([{ op: "setNUp", pages: [0], layout: 4 }]).field).toBe("layout");
    expect(refusal([{ op: "setNUp", pages: [0], layout: { rows: 0, cols: 1 } }]).field).toBe("layout.rows");
    expect(refusal([{ op: "setNUp", pages: [0], layout: { rows: 1, cols: 1 }, paper: "a3" }]).field).toBe("paper");
    const once = { op: "setNUp", pages: [0], layout: { rows: 1, cols: 1 } };
    expect(refusal([once, once]).message).toContain("at most one setNUp");
  });
});

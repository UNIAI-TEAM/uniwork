// B5 numbering-part tests: the model carries new definitions and restart nums
// into SaveOptions.numbering (the vendored writer appends them to
// word/numbering.xml) while an untouched document keeps that option undefined
// so the part stays byte-identical. The shared fake engine has no numbering
// part, so a wrapper feeds the parse a definition map — the notes tests'
// convention — and records every saveDocx call.
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  type DocxNewNumberingDef,
  type DocxNumberingDef,
  type DocxNumberingLevelSpec,
  type DocxSaveBlock,
  type DocxSaveOptions,
} from "../src/docx";
import { createFakeDocxEngine, decodeFakeDocx, makeFakeDocxBytes, type FakeDocxFixture } from "./fake-docx-engine";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

/** The document's own part, as the real parse would expose it. */
const PART: DocxNumberingDef[] = [
  { numId: "1", abstractNumId: "0", levels: { 0: { numFmt: "bullet", lvlText: "" } }, startOverrides: {} },
  { numId: "2", abstractNumId: "1", levels: { 0: { numFmt: "decimal", lvlText: "%1." } }, startOverrides: {} },
];

const LEVEL: DocxNumberingLevelSpec = { numFmt: "decimal", lvlText: "%1.", indentLeft: 720, hanging: 360 };

type NumberingFixture = FakeDocxFixture & { numbering?: DocxNumberingDef[] };

function listDocx(): Uint8Array {
  const fixture: NumberingFixture = {
    blocks: [
      { type: "listItem", runs: [{ text: "one" }], list: { kind: "ordered", numId: "2", ilvl: 0 } },
      { type: "paragraph", runs: [{ text: "body" }] },
    ],
    numbering: PART,
  };
  return makeFakeDocxBytes(fixture);
}

/** Fake engine + a capture of every saveDocx call's plan/options, with the
 * package's numbering list fed into the parse. */
function createNumberingEngine() {
  const base = createFakeDocxEngine();
  const saves: Array<{ blocks: DocxSaveBlock[]; options: DocxSaveOptions | undefined }> = [];
  const engine = {
    async parseDocx(bytes: Uint8Array) {
      const parsed = await base.parseDocx(bytes);
      const pkg = decodeFakeDocx(bytes) as { numbering?: DocxNumberingDef[] };
      if (pkg.numbering) parsed.numbering = new Map(pkg.numbering.map((def) => [def.numId, def]));
      return parsed;
    },
    async saveDocx(parsed: Parameters<typeof base.saveDocx>[0], blocks: DocxSaveBlock[], options?: DocxSaveOptions) {
      saves.push({ blocks, options });
      return base.saveDocx(parsed, blocks, options);
    },
    listPackageParts: base.listPackageParts,
  };
  return { engine, saves };
}

async function openModel() {
  const { engine, saves } = createNumberingEngine();
  const parsed = await engine.parseDocx(listDocx());
  return { model: new DocxSessionModel(parsed), engine, saves };
}

async function openAdapter() {
  const { engine, saves } = createNumberingEngine();
  const adapter = createDocxAdapter({ engine });
  const out = await adapter.open({ bytes: listDocx(), format: "docx", document_id: "doc-numbering" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, saves };
}

describe("docx numbering model", () => {
  it("keeps an untouched part out of SaveOptions and saves byte-identical", async () => {
    const source = listDocx();
    const { engine, saves } = createNumberingEngine();
    const adapter = createDocxAdapter({ engine });
    const out = await adapter.open({ bytes: source, format: "docx", document_id: "doc-untouched" });
    if (out.outcome !== "opened") throw new Error("open failed");
    const saved = await adapter.serialize({ document_model_ref: out.document_model_ref, format: "docx" });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.options?.numbering).toBeUndefined();
    expect(saved.bytes).toEqual(source);
  });

  it("carries a nine-level definition into SaveOptions.numbering", async () => {
    const { model } = await openModel();
    const levels = Array.from({ length: 9 }, (_, ilvl) => ({ ...LEVEL, lvlText: `%${ilvl + 1}.`, indentLeft: 720 * (ilvl + 1) }));
    model.insertNumberingDef({ numId: "9", kind: "ordered", levels });
    expect(model.isDirty).toBe(true);
    expect(model.revision).toBe(1);
    const { options } = model.savePlan();
    expect(options.numbering?.newDefs).toEqual([{ numId: "9", kind: "ordered", levels }]);
    expect(options.numbering?.restartNums).toEqual([]);
  });

  it("carries a restart num with its start overrides", async () => {
    const { model } = await openModel();
    model.restartNumbering({ numId: "9", abstractNumId: "1", startOverrides: { 0: 1, 2: 5 } });
    const { options } = model.savePlan();
    expect(options.numbering?.newDefs).toEqual([]);
    expect(options.numbering?.restartNums).toEqual([{ numId: "9", abstractNumId: "1", startOverrides: { 0: 1, 2: 5 } }]);
  });

  it("reaches saveDocx through the adapter edit channel", async () => {
    const { adapter, ref, saves } = await openAdapter();
    const def: DocxNewNumberingDef = { numId: "9", kind: "bullet" };
    adapter.edit(ref, { op: "insert_numbering_def", def });
    adapter.edit(ref, { op: "restart_numbering", restart: { numId: "10", abstractNumId: "0", startOverrides: { 1: 3 } } });
    await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saves[0]?.options?.numbering).toEqual({
      newDefs: [{ numId: "9", kind: "bullet" }],
      restartNums: [{ numId: "10", abstractNumId: "0", startOverrides: { 1: 3 } }],
    });
    // the body plan is untouched: both edits live in the part, not the blocks
    expect(saves[0]?.blocks.every((block) => block.kind === "original")).toBe(true);
  });

  it("refuses malformed definitions, levels and duplicate numIds", async () => {
    const { model } = await openModel();
    expect(errCode(() => model.insertNumberingDef(null as never))).toBe("bad_numbering_def");
    expect(errCode(() => model.insertNumberingDef({ numId: "new-list-1", kind: "ordered" }))).toBe("bad_numbering_def");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "square" as never }))).toBe("bad_numbering_kind");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [] }))).toBe("bad_numbering_levels");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: Array.from({ length: 10 }, () => LEVEL) }))).toBe("bad_numbering_levels");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, numFmt: "" }] }))).toBe("bad_numbering_level");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, lvlText: "" }] }))).toBe("bad_numbering_level");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, indentLeft: -1 }] }))).toBe("bad_numbering_level");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, indentLeft: Number.NaN }] }))).toBe("bad_numbering_level");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, hanging: Number.NaN }] }))).toBe("bad_numbering_level");
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered", levels: [{ ...LEVEL, start: 0 }] }))).toBe("bad_numbering_level");
    // the part's own numIds and this session's pending ones are both taken
    expect(errCode(() => model.insertNumberingDef({ numId: "2", kind: "ordered" }))).toBe("duplicate_num_id");
    model.insertNumberingDef({ numId: "3", kind: "ordered" });
    expect(errCode(() => model.insertNumberingDef({ numId: "3", kind: "ordered" }))).toBe("duplicate_num_id");
    expect(model.revision).toBe(1);
  });

  it("refuses restart nums with a dangling abstractNum or bad overrides", async () => {
    const { model } = await openModel();
    expect(errCode(() => model.restartNumbering(null as never))).toBe("bad_numbering_restart");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "", startOverrides: { 0: 1 } }))).toBe("bad_numbering_restart");
    expect(errCode(() => model.restartNumbering({ numId: "restart-x", abstractNumId: "1", startOverrides: { 0: 1 } }))).toBe("bad_numbering_def");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "99", startOverrides: { 0: 1 } }))).toBe("unknown_abstract_num");
    expect(errCode(() => model.restartNumbering({ numId: "1", abstractNumId: "0", startOverrides: { 0: 1 } }))).toBe("duplicate_num_id");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "1", startOverrides: null as never }))).toBe("bad_start_override");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "1", startOverrides: { 9: 1 } }))).toBe("bad_start_override");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "1", startOverrides: { 0: 0 } }))).toBe("bad_start_override");
    expect(errCode(() => model.restartNumbering({ numId: "4", abstractNumId: "1", startOverrides: { 0: 1.5 } }))).toBe("bad_start_override");
    expect(model.isDirty).toBe(false);
  });

  it("copies payloads so a caller's later mutation cannot reach the save", async () => {
    const { model } = await openModel();
    const levels = [{ ...LEVEL }];
    const def: DocxNewNumberingDef = { numId: "9", kind: "ordered", levels };
    model.insertNumberingDef(def);
    levels[0]!.indentLeft = 9999;
    const first = model.savePlan().options.numbering!;
    first.newDefs![0]!.levels![0]!.indentLeft = 1;
    first.restartNums!.push({ numId: "99", abstractNumId: "0", startOverrides: {} });
    const second = model.savePlan().options.numbering!;
    expect(second.newDefs?.[0]?.levels?.[0]?.indentLeft).toBe(LEVEL.indentLeft);
    expect(second.restartNums).toEqual([]);
  });

  it("routs both ops through applyEdit and keeps the plan untouched", async () => {
    const { model, saves } = await openModel();
    model.applyEdit({ op: "insert_numbering_def", def: { numId: "9", kind: "bullet" } });
    model.applyEdit({ op: "restart_numbering", restart: { numId: "10", abstractNumId: "0", startOverrides: { 0: 1 } } });
    expect(model.revision).toBe(2);
    const { finalBlocks, options } = model.savePlan();
    expect(finalBlocks.every((block) => block.kind === "original")).toBe(true);
    expect(options.numbering).toEqual({
      newDefs: [{ numId: "9", kind: "bullet" }],
      restartNums: [{ numId: "10", abstractNumId: "0", startOverrides: { 0: 1 } }],
    });
    expect(saves).toHaveLength(0);
  });

  it("rebase drains the edits into the new base and re-reads its part", async () => {
    const { model, engine } = await openModel();
    model.insertNumberingDef({ numId: "9", kind: "ordered" });
    expect(model.savePlan().options.numbering).toBeDefined();
    const rebased = await engine.parseDocx(listDocx());
    rebased.numbering = new Map([...(rebased.numbering ?? new Map()), ["9", { numId: "9", abstractNumId: "2", levels: { 0: LEVEL }, startOverrides: {} }]]);
    model.rebase(rebased);
    expect(model.isDirty).toBe(false);
    expect(model.savePlan().options.numbering).toBeUndefined();
    // the rebased part's own defs are the collision oracle again
    expect(errCode(() => model.insertNumberingDef({ numId: "9", kind: "ordered" }))).toBe("duplicate_num_id");
    // and a restart can target the def the rebased part just gained
    model.restartNumbering({ numId: "4", abstractNumId: "2", startOverrides: { 0: 1 } });
    expect(model.savePlan().options.numbering?.restartNums).toEqual([{ numId: "4", abstractNumId: "2", startOverrides: { 0: 1 } }]);
  });
});

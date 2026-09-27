// PPTX adapter contract tests — typed open failures, session model refs,
// save-verify + commitSaved two-save semantics on the held deck.
import { describe, expect, it } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { createPptxAdapter } from "../src/pptx";
import {
  createFakePptxEngine,
  createFakePptxOps,
  createFakePptxRender,
  decodeFakePptx,
} from "./fake-pptx-engine";
import {
  makeCorruptZipPptx,
  makeEncryptedPptxBytes,
  makeFakePptxBytes,
  makeNonOfficeBytes,
} from "./fake-pptx-fixtures";

const openDeck = async () => {
  const engine = createFakePptxEngine();
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps(), render: createFakePptxRender() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "deck-1" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, engine };
};

describe("pptx adapter open (P3)", () => {
  it("opens a deck: typed opened outcome + preserved-construct warnings", async () => {
    const { ref } = await openDeck();
    expect(ref).toMatch(/^pptx-session-/);
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "d" });
    if (out.outcome !== "opened") throw new Error("open failed");
    // fixture carries an xlsx embedding -> preserved warning
    expect(out.warnings.some((w) => (w as { code: string }).code === "unsupported_construct_preserved")).toBe(true);
  });

  it("corrupt package => corrupted failure bound to the file", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const out = await adapter.open({ bytes: makeCorruptZipPptx(), format: "pptx", document_id: "deck-c" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "corrupted", document_id: "deck-c" });
  });

  it("non-office bytes => not_office_file", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const out = await adapter.open({ bytes: makeNonOfficeBytes(), format: "pptx", document_id: "deck-n" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "not_office_file" });
  });

  it("encrypted pptx => unsupported_feature (no pptx decrypt path upstream)", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const enc = makeEncryptedPptxBytes(makeFakePptxBytes());
    const out = await adapter.open({ bytes: enc, format: "pptx", document_id: "deck-e" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "unsupported_feature", document_id: "deck-e" });
  });

  it("oversize input => too_large", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps(), maxInputBytes: 10 });
    const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "deck-big" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("a failed open leaves no saveable session (P3)", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const out = await adapter.open({ bytes: makeCorruptZipPptx(), format: "pptx", document_id: "deck-f" });
    expect(out.outcome).toBe("failed");
    await expect(
      adapter.serialize({ document_model_ref: "pptx-session-99", format: "pptx" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("pptx adapter serialize", () => {
  it("no-op save round-trips the deck; commitSaved marks the new base", async () => {
    const { adapter, ref, engine } = await openDeck();
    const s1 = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    expect(s1.bytes.length).toBeGreaterThan(0);
    expect(engine.commitCalls).toBe(1);
    expect(s1.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter.isDirty(ref)).toBe(false);
  });

  it("two consecutive saves: save2 diffs from save1's committed base", async () => {
    const { adapter, ref, engine } = await openDeck();
    adapter.edit(ref, { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [{ runs: [{ text: "V1" }] }] });
    const s1 = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    expect(engine.commitCalls).toBe(1);
    const baseAfterFirst = engine.committedBase;
    expect(baseAfterFirst).toContain("V1");
    adapter.edit(ref, { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [{ runs: [{ text: "V2" }] }] });
    const s2 = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    expect(engine.commitCalls).toBe(2);
    expect(engine.committedBase).toContain("V2");
    expect(s2.checksum).not.toBe(s1.checksum);
    // reopened output keeps both slides (save-verify ran on each save)
    const reopened = decodeFakePptx(s2.bytes) as { slides: unknown[] };
    expect(reopened.slides.length).toBe(2);
  });

  it("release removes the session (cancel path)", async () => {
    const { adapter, ref } = await openDeck();
    expect(adapter.release(ref)).toBe(true);
    await expect(adapter.serialize({ document_model_ref: ref, format: "pptx" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("wrong format => unsupported_operation", async () => {
    const { adapter, ref } = await openDeck();
    await expect(adapter.serialize({ document_model_ref: ref, format: "docx" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
    await expect(adapter.open({ bytes: makeFakePptxBytes(), format: "docx", document_id: "x" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });

  it("savePptx crash => EngineBoundaryError engine_crashed", async () => {
    const adapter = createPptxAdapter({
      engine: {
        openPptx: createFakePptxEngine().openPptx,
        savePptx: async () => {
          throw new Error("zip write failed");
        },
      },
      ops: createFakePptxOps(),
    });
    const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "d" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    await expect(adapter.serialize({ document_model_ref: ref, format: "pptx" })).rejects.toBeInstanceOf(
      EngineBoundaryError,
    );
  });

  it("capability answers honest rows; transform row reflects render binding", async () => {
    const bound = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps(), render: createFakePptxRender() });
    const res = (await bound.capability("pptx")) as { rows: Array<{ operation: string; supported: boolean }> };
    expect(res.rows.find((r) => r.operation === "slides-edit-transform")).toMatchObject({ supported: true });
    const unbound = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const res2 = (await unbound.capability("pptx")) as { rows: Array<{ operation: string; supported: boolean; evidence_level: string }> };
    expect(res2.rows.find((r) => r.operation === "slides-edit-transform")).toMatchObject({ supported: false });
    await expect(bound.capability("docx")).rejects.toMatchObject({ code: "unsupported_operation" });
  });
});

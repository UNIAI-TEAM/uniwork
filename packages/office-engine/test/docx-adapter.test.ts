// DOCX adapter contract tests — P3 typed open failures bound to the file id,
// session model refs, and the no-blank-document guarantee.
import { describe, expect, it } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { createDocxAdapter } from "../src/docx";
import {
  createFakeDocxCryptoWithCheck,
  createFakeDocxEngine,
  fakeEncryptDocx,
  makeCorruptZipDocx,
  makeFakeDocxBytes,
  makeNonOfficeBytes,
} from "./fake-docx-engine";

const fixture = () =>
  makeFakeDocxBytes({
    blocks: [
      { type: "heading", runs: [{ text: "Contract" }] },
      { type: "paragraph", runs: [{ text: "first para" }] },
      { type: "table", runs: [] },
      { type: "paragraph", runs: [{ text: "tail" }], hidden: true },
    ],
    parts: { "word/media/image1.png": "PNG", "word/embeddings/x.xlsx": "XLSX" },
  });

const openFixture = async (adapter = createDocxAdapter({ engine: createFakeDocxEngine() })) => {
  const out = await adapter.open({ bytes: fixture(), format: "docx", document_id: "doc-1" });
  return { adapter, out };
};

describe("docx adapter open (P3)", () => {
  it("opens a plain docx: typed opened outcome bound to document_id", async () => {
    const { out } = await openFixture();
    expect(out).toMatchObject({
      outcome: "opened",
      document_id: "doc-1",
      document_model_ref: expect.stringMatching(/^docx-session-/),
    });
    // OLE embedding in the fixture produces a preserved-construct warning.
    expect((out as { warnings: unknown[] }).warnings.length).toBeGreaterThan(0);
  });

  it("corrupt package => corrupted failure bound to the file, never a blank doc", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const out = await adapter.open({ bytes: makeCorruptZipDocx(), format: "docx", document_id: "doc-c" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "corrupted", document_id: "doc-c", format: "docx" });
    // P3: no session exists for the failed open — serialize can't find one.
    await expect(
      adapter.serialize({ document_model_ref: "docx-session-99", format: "docx" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("non-office bytes => not_office_file", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const out = await adapter.open({ bytes: makeNonOfficeBytes(), format: "docx", document_id: "doc-n" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "not_office_file", document_id: "doc-n" });
  });

  it("oversize input => too_large before the engine is touched", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine(), maxInputBytes: 10 });
    const out = await adapter.open({ bytes: fixture(), format: "docx", document_id: "doc-big" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("encrypted package without a password => password_required", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const enc = fakeEncryptDocx(fixture(), "pw1");
    const out = await adapter.open({ bytes: enc, format: "docx", document_id: "doc-e" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "password_required", document_id: "doc-e" });
  });

  it("encrypted package, wrong password => wrong_password", async () => {
    const adapter = createDocxAdapter({
      engine: createFakeDocxEngine(),
      crypto: createFakeDocxCryptoWithCheck("right"),
    });
    const enc = fakeEncryptDocx(fixture(), "right");
    const out = await adapter.open({ bytes: enc, format: "docx", document_id: "doc-w", password: "wrong" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "wrong_password", document_id: "doc-w" });
  });

  it("encrypted package with a password but no decryptor bound => unsupported_feature", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const enc = fakeEncryptDocx(fixture(), "pw1");
    const out = await adapter.open({ bytes: enc, format: "docx", document_id: "doc-u", password: "pw1" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "unsupported_feature" });
  });

  it("dismissed password prompt => password_cancelled typed outcome", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const out = adapter.cancelPassword("doc-pc");
    expect(out).toMatchObject({
      outcome: "failed",
      failure_class: "password_cancelled",
      document_id: "doc-pc",
      format: "docx",
    });
  });

  it("a decrypt+open failure still leaves no saveable session", async () => {
    const adapter = createDocxAdapter({
      engine: createFakeDocxEngine(),
      crypto: createFakeDocxCryptoWithCheck("right"),
    });
    const enc = fakeEncryptDocx(fixture(), "right");
    const bad = await adapter.open({ bytes: enc, format: "docx", document_id: "doc-f", password: "bad" });
    expect(bad.outcome).toBe("failed");
    await expect(
      adapter.serialize({ document_model_ref: "docx-session-1", format: "docx" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("wrong format on open/serialize => unsupported_operation", async () => {
    const { adapter, out } = await openFixture();
    const ref = (out as { document_model_ref: string }).document_model_ref;
    await expect(adapter.open({ bytes: fixture(), format: "xlsx", document_id: "d" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });

  it("release removes the session; serialize on a dead ref fails not_found", async () => {
    const { adapter, out } = await openFixture();
    const ref = (out as { document_model_ref: string }).document_model_ref;
    expect(adapter.release(ref)).toBe(true);
    expect(adapter.release(ref)).toBe(false);
    await expect(adapter.serialize({ document_model_ref: ref, format: "docx" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("capability answers honest source_read/pending rows for docx only", async () => {
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const res = (await adapter.capability("docx")) as { rows: Array<{ operation: string; supported: boolean; evidence_level: string }> };
    const open = res.rows.find((r) => r.operation === "open");
    const exp = res.rows.find((r) => r.operation === "export");
    expect(open).toMatchObject({ supported: true, evidence_level: "source_read" });
    expect(exp).toMatchObject({ supported: false, evidence_level: "pending" });
    await expect(adapter.capability("pptx")).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("a saveDocx engine crash maps to engine_crashed, not a swallowed error", async () => {
    const adapter = createDocxAdapter({
      engine: {
        parseDocx: createFakeDocxEngine().parseDocx,
        saveDocx: async () => {
          throw new Error("disk full");
        },
      },
    });
    const out = await adapter.open({ bytes: fixture(), format: "docx", document_id: "doc-x" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    await expect(adapter.serialize({ document_model_ref: ref, format: "docx" })).rejects.toBeInstanceOf(
      EngineBoundaryError,
    );
  });
});

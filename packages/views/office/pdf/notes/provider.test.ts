import { describe, expect, it, vi } from "vitest";
import { createPdfNoteOperationProvider, PdfNoteProviderError } from "./provider";
import type { PdfNoteAddOperation, PdfNoteEngineOperation, PdfNoteIdentity, PdfNoteReplyTarget } from "./types";

const identity: PdfNoteIdentity = { pageIndex: 2, objNum: 7, rect: [10, 20, 30, 40], contents: "Gốc" };

describe("createPdfNoteOperationProvider", () => {
  it("submits a typed addNote envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfNoteOperationProvider({ submit });
    await provider.addNote({ pageIndex: 1, rect: [1, 2, 3, 4], contents: "Ghi chú mới", author: "An" });
    expect(submit).toHaveBeenCalledWith([
      { op: "addNote", attributes: { note: { pageIndex: 1, rect: [1, 2, 3, 4], contents: "Ghi chú mới", author: "An" } } },
    ]);
  });

  it("derives a reply's page and rect from the parent identity", async () => {
    const submitted: PdfNoteEngineOperation[][] = [];
    const provider = createPdfNoteOperationProvider({
      submit: (operations) => {
        submitted.push([...operations]);
      },
    });
    await provider.replyToNote({ replyTo: identity, contents: "Trả lời" });
    expect(submitted).toEqual([
      [{ op: "addNote", attributes: { note: { pageIndex: 2, rect: [10, 20, 30, 40], contents: "Trả lời", replyTo: { objNum: 7, rect: [10, 20, 30, 40], contents: "Gốc" } } } }],
    ]);
  });

  it("emits an addNote envelope whose replyTo matches the declared PdfNoteReplyTarget", async () => {
    const submitted: PdfNoteAddOperation[] = [];
    const provider = createPdfNoteOperationProvider({
      submit: (operations) => {
        submitted.push(...(operations as readonly PdfNoteAddOperation[]));
      },
    });
    await provider.replyToNote({ replyTo: identity, contents: "Trả lời", author: "An" });
    expect(submitted).toHaveLength(1);
    const envelope = submitted[0]!;
    expect(envelope.op).toBe("addNote");
    // Type-level pin: the emitted literal must be a PdfNoteAddOperation, so a
    // replyTo that still demanded a pageIndex would not compile.
    const replyTo: PdfNoteReplyTarget | undefined = envelope.attributes.note.replyTo;
    expect(replyTo).toEqual({ objNum: 7, rect: [10, 20, 30, 40], contents: "Gốc" });
    expect(replyTo).not.toHaveProperty("pageIndex");
    expect(Object.keys(replyTo!).sort()).toEqual(["contents", "objNum", "rect"]);
  });

  it("edits by identity, keeping oldContents as the match and the draft as the new text", async () => {
    const submit = vi.fn();
    const provider = createPdfNoteOperationProvider({ submit });
    await provider.editNote({ identity, contents: "Gốc đã sửa" });
    expect(submit).toHaveBeenCalledWith([
      {
        op: "editSavedNote",
        attributes: { pageIndex: 2, objNum: 7, rect: [10, 20, 30, 40], oldContents: "Gốc", contents: "Gốc đã sửa" },
      },
    ]);
  });

  it("writes the requested resolve state", async () => {
    const submit = vi.fn();
    const provider = createPdfNoteOperationProvider({ submit });
    await provider.resolveNote({ identity, resolved: true });
    await provider.resolveNote({ identity, resolved: false });
    expect(submit).toHaveBeenNthCalledWith(1, [
      { op: "resolveNote", attributes: { pageIndex: 2, objNum: 7, rect: [10, 20, 30, 40], contents: "Gốc", resolved: true } },
    ]);
    expect(submit).toHaveBeenNthCalledWith(2, [
      { op: "resolveNote", attributes: { pageIndex: 2, objNum: 7, rect: [10, 20, 30, 40], contents: "Gốc", resolved: false } },
    ]);
  });

  it("refuses malformed inputs as typed provider errors before touching the submitter", async () => {
    const submit = vi.fn();
    const provider = createPdfNoteOperationProvider({ submit });
    await expect(provider.addNote({ pageIndex: -1, rect: [1, 2, 3, 4], contents: "x" })).rejects.toBeInstanceOf(PdfNoteProviderError);
    await expect(provider.addNote({ pageIndex: 0, rect: [1, 2, 1, 4], contents: "x" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider.addNote({ pageIndex: 0, rect: [1, 2, 3, 4], contents: "   " })).rejects.toBeInstanceOf(PdfNoteProviderError);
    await expect(provider.editNote({ identity: { ...identity, objNum: 7.5 }, contents: "x" })).rejects.toBeInstanceOf(PdfNoteProviderError);
    await expect(provider.editNote({ identity: { ...identity, contents: "" }, contents: "x" })).rejects.toBeInstanceOf(PdfNoteProviderError);
    await expect(provider.resolveNote({ identity, resolved: "yes" as unknown as boolean })).rejects.toMatchObject({ code: "invalid_input" });
    expect(submit).not.toHaveBeenCalled();
  });
});

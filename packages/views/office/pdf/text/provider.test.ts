import { describe, expect, it, vi } from "vitest";
import { PdfOpsBridgeError } from "../ops-bridge";
import { bridgePdfTextOperation, createPdfTextOperationProvider } from "./provider";
import type { PdfTextEditInput } from "./types";

const rect: [number, number, number, number] = [1, 2, 3, 4];
const replacement: PdfTextEditInput = { objectId: "run-1", pageIndex: 1, rect, oldText: "old", newText: "new", fontSize: 12 };
const metadata = { page: 2, objectId: "run-1", rect, text: "old", fontSize: 12 };

describe("bridgePdfTextOperation", () => {
  it("resolves the selection through the host resolver and merges the requested font", async () => {
    const resolveObject = vi.fn().mockReturnValue(metadata);
    const operation = await bridgePdfTextOperation(
      { kind: "replace", input: { ...replacement, newFont: "Noto Sans", newFontSize: 14 } },
      { resolveObject },
    );
    expect(resolveObject).toHaveBeenCalledWith({ page: 2, objectId: "run-1" });
    expect(operation).toEqual({
      op: "putTextEdit",
      attributes: { pageIndex: 1, rect, oldText: "old", newText: "new", fontSize: 12, newFont: "Noto Sans", newFontSize: 14 },
    });
  });

  it("maps the displayed page through the page order", async () => {
    const resolveObject = vi.fn().mockReturnValue({ ...metadata, page: 1 });
    const operation = await bridgePdfTextOperation({ kind: "replace", input: { ...replacement, pageIndex: 0 } }, { resolveObject, pageOrder: [1, 0] });
    expect(operation).toMatchObject({ op: "putTextEdit", attributes: { pageIndex: 1 } });
  });

  it("fails with object_unavailable when the host has no object resolver", async () => {
    const error = await bridgePdfTextOperation({ kind: "replace", input: replacement }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PdfOpsBridgeError);
    expect(error).toMatchObject({ code: "object_unavailable" });
  });

  it("maps insertion page order and keeps the input serialisable", async () => {
    const operation = await bridgePdfTextOperation(
      { kind: "insert", input: { pageIndex: 0, origin: [72, 80], text: "hello", fontSize: 12, color: [0, 0, 0] } },
      { pageOrder: [4, 1] },
    );
    expect(operation).toEqual({ op: "addTextInsert", attributes: { pageIndex: 4, origin: [72, 80], text: "hello", fontSize: 12, color: [0, 0, 0] } });
  });

  it("rejects an insert page outside the page order", async () => {
    await expect(
      bridgePdfTextOperation(
        { kind: "insert", input: { pageIndex: 2, origin: [0, 0], text: "x", fontSize: 12, color: [0, 0, 0] } },
        { pageOrder: [1] },
      ),
    ).rejects.toMatchObject({ code: "invalid_target" });
  });
});

describe("createPdfTextOperationProvider", () => {
  it("submits the bridged replacement envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfTextOperationProvider({ resolveObject: () => metadata }, { submit });
    await provider.putTextEdit(replacement);
    expect(submit).toHaveBeenCalledWith([{ op: "putTextEdit", attributes: { pageIndex: 1, rect, oldText: "old", newText: "new", fontSize: 12 } }]);
  });

  it("passes job warnings through to the caller", async () => {
    const submit = vi.fn().mockResolvedValue({ warnings: [{ code: "edit_skipped", detail: "text page=2: no available font" }] });
    const provider = createPdfTextOperationProvider({ resolveObject: () => metadata }, { submit });
    const outcome = await provider.putTextEdit(replacement);
    expect(outcome).toEqual({ warnings: [{ code: "edit_skipped", detail: "text page=2: no available font" }] });
  });
});

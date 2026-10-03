import { describe, expect, it, vi } from "vitest";
import { createPdfTextOperationProvider } from "./provider";

describe("createPdfTextOperationProvider", () => {
  it("bridges replacement text through the shared operation envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfTextOperationProvider({}, { submit });
    await provider.putTextEdit({ pageIndex: 1, rect: [1, 2, 3, 4], oldText: "old", newText: "new", fontSize: 12 });
    expect(submit).toHaveBeenCalledWith([{ op: "putTextEdit", attributes: { pageIndex: 1, rect: [1, 2, 3, 4], oldText: "old", newText: "new", fontSize: 12 } }]);
  });

  it("maps insertion page order and keeps the input serialisable", async () => {
    const submit = vi.fn();
    const provider = createPdfTextOperationProvider({ pageOrder: [4, 1] }, { submit });
    await provider.addTextInsert({ pageIndex: 0, origin: [72, 80], text: "hello", fontSize: 12, color: [0, 0, 0] });
    expect(submit).toHaveBeenCalledWith([{ op: "addTextInsert", attributes: { pageIndex: 4, origin: [72, 80], text: "hello", fontSize: 12, color: [0, 0, 0] } }]);
  });
});

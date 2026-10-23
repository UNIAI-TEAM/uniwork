import { describe, expect, it } from "vitest";
import { virtualChatRowEstimatePx, virtualChatRowMeasureKey } from "./virtual-chat-message-list";

describe("virtualChatRowEstimatePx", () => {
  it("uses a smaller estimate for compact mid-run bubbles", () => {
    const midRun = { lastOfRun: false, compactTop: true };
    const endRun = { lastOfRun: true, compactTop: true };
    expect(virtualChatRowEstimatePx(midRun)).toBeLessThan(virtualChatRowEstimatePx(endRun));
  });
});

describe("virtualChatRowMeasureKey", () => {
  it("changes when lastOfRun flips so the virtualizer remeasures height", () => {
    const message = { id: "m1" };
    const midRun = { lastOfRun: false, compactTop: true };
    const endRun = { lastOfRun: true, compactTop: true };
    expect(virtualChatRowMeasureKey(message, midRun, 0)).not.toBe(virtualChatRowMeasureKey(message, endRun, 0));
  });

  it("keeps the same key when the server id replaces a pending id", () => {
    const layout = { lastOfRun: true, compactTop: false };
    expect(virtualChatRowMeasureKey({ id: "pending:cm1", clientMsgId: "cm1" }, layout, 0)).toBe(
      virtualChatRowMeasureKey({ id: "m1", clientMsgId: "cm1" }, layout, 0),
    );
  });
});

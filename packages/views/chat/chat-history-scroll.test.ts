import { describe, expect, it } from "vitest";
import { shouldPrefetchOlderHistoryAtScrollEdge } from "./chat-history-scroll";

describe("shouldPrefetchOlderHistoryAtScrollEdge", () => {
  it("does not prefetch while stick-to-bottom", () => {
    const el = { scrollTop: 0, clientHeight: 500 } as HTMLDivElement;
    expect(shouldPrefetchOlderHistoryAtScrollEdge(el, true)).toBe(false);
  });

  it("prefetches only when the reader is near the loaded top edge", () => {
    const el = { scrollTop: 80, clientHeight: 500 } as HTMLDivElement;
    expect(shouldPrefetchOlderHistoryAtScrollEdge(el, false)).toBe(true);
    el.scrollTop = 400;
    expect(shouldPrefetchOlderHistoryAtScrollEdge(el, false)).toBe(false);
  });
});

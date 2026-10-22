import { describe, expect, it } from "vitest";
import { MAX_OP_ITEM_FAILURES, OP_ITEM_RETRY_MS, failureScope, opItemRetryDelay } from "./delivery-failure";

const answered = (status: number) => Object.assign(new Error(String(status)), { status });

describe("failureScope", () => {
  it("blames the line for the network, the phone's timeout, the session and a rate limit", () => {
    expect(failureScope(new TypeError("Network request failed"))).toBe("line");
    for (const status of [0, 401, 429]) expect(failureScope(answered(status))).toBe("line");
  });

  it("blames the item for what the server answered about it, and for a throw that is no answer", () => {
    for (const status of [408, 500, 502, 503]) expect(failureScope(answered(status))).toBe("item");
    expect(failureScope(new Error("bug"))).toBe("item");
    expect(failureScope({ status: "500" })).toBe("item");
    expect(failureScope(null)).toBe("item");
    expect(failureScope("boom")).toBe("item");
  });
});

describe("opItemRetryDelay", () => {
  it("waits longer after each failure of the op's own, spread ±20 %, and gives up after the last wait", () => {
    expect(OP_ITEM_RETRY_MS.map((_, i) => opItemRetryDelay(i + 1, () => 0.5))).toEqual([...OP_ITEM_RETRY_MS]);
    expect(opItemRetryDelay(99, () => 0.5)).toBe(60 * 60_000);
    expect(opItemRetryDelay(0, () => 0.5)).toBe(5_000);
    expect(opItemRetryDelay(1, () => 0)).toBe(4_000);
    expect(opItemRetryDelay(1, () => 1)).toBe(6_000);
    expect(opItemRetryDelay(1)).toBeGreaterThanOrEqual(4_000);
    expect(MAX_OP_ITEM_FAILURES).toBe(8);
  });
});

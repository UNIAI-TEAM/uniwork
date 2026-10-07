import { describe, expect, it, vi } from "vitest";
import { emitQuotaThreshold, resetQuotaThresholdBusForTests, subscribeQuotaThreshold } from "./quota-threshold-bus";

describe("quota-threshold-bus", () => {
  it("notifies subscribers with the event payload", () => {
    resetQuotaThresholdBusForTests();
    const listener = vi.fn();
    const off = subscribeQuotaThreshold(listener);
    emitQuotaThreshold({ organizationId: "org1", userId: "u1" });
    expect(listener).toHaveBeenCalledWith({ organizationId: "org1", userId: "u1" });
    off();
    emitQuotaThreshold({ organizationId: "org2", userId: "u2" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

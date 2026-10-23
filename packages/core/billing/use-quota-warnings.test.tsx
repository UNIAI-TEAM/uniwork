import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emitQuotaThreshold, resetQuotaThresholdBusForTests } from "./quota-threshold-bus";
import { useQuotaWarnings } from "./use-quota-warnings";

describe("useQuotaWarnings", () => {
  it("forwards only events for the active org and user", () => {
    resetQuotaThresholdBusForTests();
    const onThreshold = vi.fn();
    renderHook(() =>
      useQuotaWarnings({ organizationId: "org-a", userId: "user-a", onThreshold }),
    );
    emitQuotaThreshold({ organizationId: "org-b", userId: "user-a" });
    emitQuotaThreshold({ organizationId: "org-a", userId: "user-b" });
    emitQuotaThreshold({ organizationId: "org-a", userId: "user-a" });
    expect(onThreshold).toHaveBeenCalledTimes(1);
  });
});

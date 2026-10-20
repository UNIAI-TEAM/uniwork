import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { summaryQueryRetry } from "./summary-hooks";

describe("summaryQueryRetry", () => {
  it("gives up at once on a 4xx and retries a 5xx or a dropped connection a few times", () => {
    expect(summaryQueryRetry(0, new ApiError("no", "forbidden", 403))).toBe(false);
    expect(summaryQueryRetry(0, new ApiError("boom", "internal", 500))).toBe(true);
    expect(summaryQueryRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(summaryQueryRetry(3, new ApiError("boom", "internal", 500))).toBe(false);
  });
});

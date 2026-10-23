import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { billingApiErrorCopy } from "./billing-api-error";

initI18n();

describe("billingApiErrorCopy", () => {
  it("maps known billing codes to settings copy", () => {
    expect(billingApiErrorCopy(new ApiError("server vi", "quota_exceeded", 403))).toMatch(/hạn mức/i);
    expect(billingApiErrorCopy(new ApiError("x", "billing_provider_unavailable", 503))).toMatch(/cổng thanh toán/i);
  });
});

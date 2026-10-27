import { describe, expect, it } from "vitest";
import { checkoutReturnStateFromSearchParams, stripCheckoutReturnSearchParams } from "./checkout-return-vnpay";

describe("checkoutReturnStateFromSearchParams", () => {
  it("treats VNPay non-00 on success URL as cancel", () => {
    const params = new URLSearchParams("checkout=success&vnp_ResponseCode=24&vnp_TxnRef=abc");
    expect(checkoutReturnStateFromSearchParams(params)).toBe("cancel");
  });

  it("keeps success when ResponseCode is 00", () => {
    const params = new URLSearchParams("checkout=success&vnp_ResponseCode=00");
    expect(checkoutReturnStateFromSearchParams(params)).toBe("success");
  });

  it("polls when success has no VNPay code yet", () => {
    const params = new URLSearchParams("checkout=success");
    expect(checkoutReturnStateFromSearchParams(params)).toBe("success");
  });
});

describe("stripCheckoutReturnSearchParams", () => {
  it("removes checkout and vnp_* keys", () => {
    const params = new URLSearchParams("tab=billing&checkout=success&vnp_ResponseCode=24");
    stripCheckoutReturnSearchParams(params);
    expect(params.toString()).toBe("tab=billing");
  });
});

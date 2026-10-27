import type { CheckoutReturnState } from "./use-checkout-return";

/** VNPay always redirects to ReturnUrl; non-00 ResponseCode means the payer did not complete. */
export function checkoutReturnStateFromSearchParams(params: URLSearchParams): CheckoutReturnState {
  const raw = params.get("checkout");
  if (raw === "cancel") return "cancel";
  if (raw === "success") {
    const code = params.get("vnp_ResponseCode");
    if (code !== null && code !== "" && code !== "00") return "cancel";
    return "success";
  }
  return null;
}

export function stripCheckoutReturnSearchParams(params: URLSearchParams): void {
  params.delete("checkout");
  for (const key of [...params.keys()]) {
    if (key.startsWith("vnp_")) params.delete(key);
  }
}

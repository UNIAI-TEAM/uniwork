import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { getI18n } from "react-i18next";
import { apiErrorCopy } from "../api-error-copy";

const BILLING_ERROR_KEYS: Readonly<Record<string, string>> = {
  checkout_required: "settings.billing.errors.checkout_required",
  checkout_not_available: "settings.billing.errors.checkout_not_available",
  invalid_checkout_path: "settings.billing.errors.invalid_checkout_path",
  downgrade_not_allowed: "settings.billing.errors.downgrade_not_allowed",
  quota_exceeded: "settings.billing.errors.quota_exceeded",
  billing_provider_unavailable: "settings.billing.errors.billing_provider_unavailable",
  version_conflict: "settings.billing.errors.version_conflict",
};

/** Localized billing tab copy for known API codes, then generic apiErrorCopy. */
export function billingApiErrorCopy(err: unknown): string | undefined {
  const code = errorCode(err) ?? "";
  const key = BILLING_ERROR_KEYS[code];
  const i18n = getI18n();
  if (key && i18n?.exists(key)) return i18n.t(key);
  return apiErrorCopy(err) ?? apiErrorMessage(err);
}

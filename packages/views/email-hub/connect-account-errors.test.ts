import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { oauthResultKey } from "./connect-account-errors";

const i18n = initI18n();

describe("oauthResultKey", () => {
  it.each([
    ["denied", "email_hub.connect.error_oauth_denied"],
    ["state_invalid", "email_hub.connect.error_oauth_state_invalid"],
    ["email_unavailable", "email_hub.connect.error_oauth_email_unavailable"],
    ["imap_not_enabled", "email_hub.connect.error_oauth_imap_not_enabled"],
    ["smtp_disabled", "email_hub.connect.error_smtp_disabled"],
    ["already_connected", "email_hub.connect.error_already_connected"],
    ["consent_required", "email_hub.connect.error_oauth_consent_required"],
    ["failed", "email_hub.connect.error_oauth_failed"],
  ])("maps %s to %s, a sentence in both locales", (code, key) => {
    expect(oauthResultKey(code)).toBe(key);
    for (const lng of ["vi", "en"]) expect(i18n.exists(key, { lng }), `${lng} ${key}`).toBe(true);
  });

  it.each(["", "constructor", "a_code_from_a_newer_server"])("falls back to the generic sentence for %j", (code) => {
    expect(oauthResultKey(code)).toBe("email_hub.connect.error_oauth_failed");
  });
});

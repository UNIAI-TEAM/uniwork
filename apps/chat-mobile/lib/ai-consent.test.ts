import { describe, expect, it } from "vitest";
import { AI_CONSENT_VERSION, AI_PROVIDER, hasAiConsent } from "./ai-consent";

describe("hasAiConsent", () => {
  it("holds only for the notice this build shows", () => {
    expect(AI_PROVIDER).toBe("Anthropic");
    expect(hasAiConsent({ ai_consent_version: AI_CONSENT_VERSION })).toBe(true);
    // Another text (an older provider, less data) asks again.
    expect(hasAiConsent({ ai_consent_version: "2025-01-other" })).toBe(false);
    expect(hasAiConsent({ ai_consent_version: null })).toBe(false);
    expect(hasAiConsent({})).toBe(false);
    expect(hasAiConsent(null)).toBe(false);
  });
});

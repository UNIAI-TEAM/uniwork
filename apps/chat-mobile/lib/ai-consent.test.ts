import { describe, expect, it } from "vitest";
import { AI_CONSENT_VERSION, AI_PROVIDER, hasAiConsent, hasDeclinedAi } from "./ai-consent";

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

describe("hasDeclinedAi", () => {
  it("holds once the person said no, and not while they agree to the notice this build shows", () => {
    expect(hasDeclinedAi({ ai_consent_version: null, ai_opt_out_at: "2026-10-22T08:00:00Z" })).toBe(true);
    expect(hasDeclinedAi({ ai_consent_version: AI_CONSENT_VERSION, ai_opt_out_at: "2026-10-22T08:00:00Z" })).toBe(false);
    expect(hasDeclinedAi({ ai_consent_version: null, ai_opt_out_at: "" })).toBe(false);
    expect(hasDeclinedAi({ ai_consent_version: null, ai_opt_out_at: null })).toBe(false);
    expect(hasDeclinedAi(null)).toBe(false);
  });
});

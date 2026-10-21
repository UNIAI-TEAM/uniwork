// Consent before the first AI request (Apple 5.1.2(i)): the notice names the
// provider and what is sent, and the person's answer is kept on the server
// (PUT /api/v1/me/ai-consent) so a reinstall or a second phone does not ask
// again. The version names the notice text: change the provider or what is
// sent, change the version, and everyone is asked again. Mirrors the
// privacy policy's "AI features" section (apps/web/features/landing/
// privacy-content.ts); keep the two saying the same.
import type { User } from "@uniwork/core/types/user";

export const AI_CONSENT_VERSION = "2026-10-anthropic";

/** The model provider the server's AI gateway sends to today (privacy policy › AI features). */
export const AI_PROVIDER = "Anthropic";

export function hasAiConsent(user: Pick<User, "ai_consent_version"> | null | undefined): boolean {
  return user?.ai_consent_version === AI_CONSENT_VERSION;
}

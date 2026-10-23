// The person's answer to the AI processing notice (lib/ai-consent.ts), kept on
// the server and mirrored into the signed-in user, so every screen that asks
// (the catch-up sheet, Settings) reads one value. A drifted 2xx answer still
// recorded the choice: the user is updated locally instead of reloading /me.
import { AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { accountApi } from "./account-api";
import { useAuthStore } from "./auth/store";

export async function answerAiConsent(agree: boolean, now: () => Date = () => new Date()): Promise<void> {
  const next = agree ? await accountApi.setAiConsent(AI_CONSENT_VERSION) : await accountApi.withdrawAiConsent();
  const { user, setUser } = useAuthStore.getState();
  if (next) setUser(next);
  else if (user) {
    const at = now().toISOString();
    setUser({ ...user, ai_consent_version: agree ? AI_CONSENT_VERSION : null, ai_consent_at: agree ? at : null, ai_opt_out_at: agree ? null : at });
  }
}

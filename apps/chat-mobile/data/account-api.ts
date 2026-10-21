// The account endpoints Settings calls: erasing the account (POST
// /api/v1/me/delete, as packages/core/api/endpoints/auth.ts › deleteAccount),
// the answer to the AI processing notice (PUT / DELETE
// /api/v1/me/ai-consent), the person's language (PATCH /api/v1/me, as
// core's patchMe; data/locale-sync.ts), whether chat pushes show the message's
// words (PUT /api/v1/me/push-previews) and the organization's rule for that
// (GET /api/v1/orgs/{org}/push-preview-policy). account-api.test.ts holds a
// malformed-response case for each (CLAUDE.md › API Compatibility).
import { parseWithFallback } from "@uniwork/core/api/schema";
import type { User } from "@uniwork/core/types/user";
import { z } from "zod";
import type { DeleteAccountBody } from "@/lib/account-deletion";
import { api } from "./api";
import { MeResponseSchema } from "./schemas";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const StatusSchema = z.object({ status: z.string().optional() });

/** The organization's rule; a drifted answer reads as "not hidden, not yours to change", the server's default. */
const PushPreviewPolicySchema = z.object({
  hidden: z.boolean().catch(false),
  can_manage: z.boolean().catch(false),
});
export type PushPreviewPolicy = z.infer<typeof PushPreviewPolicySchema>;
const NO_POLICY: PushPreviewPolicy = { hidden: false, can_manage: false };

export function createAccountApi(request: Request) {
  async function userOf(raw: Promise<unknown>, endpoint: string): Promise<User | null> {
    return parseWithFallback<{ user: User } | null>(await raw, MeResponseSchema, null, { endpoint })?.user ?? null;
  }
  return {
    /**
     * Resolves once the server erased the account; a refusal (wrong proof,
     * owner_must_transfer, the rate limit) is the ApiError. Any 2xx is the
     * erasure, a drifted body included: the session is gone either way.
     */
    async deleteAccount(body: DeleteAccountBody): Promise<void> {
      const raw = await request("/api/v1/me/delete", { method: "POST", body: JSON.stringify(body) });
      parseWithFallback(raw, StatusSchema, {}, { endpoint: "POST /api/v1/me/delete" });
    },
    /** The updated user, or null when the answer drifted (the caller then reloads /me). */
    setAiConsent(version: string): Promise<User | null> {
      return userOf(request("/api/v1/me/ai-consent", { method: "PUT", body: JSON.stringify({ version }) }), "PUT /api/v1/me/ai-consent");
    },
    withdrawAiConsent(): Promise<User | null> {
      return userOf(request("/api/v1/me/ai-consent", { method: "DELETE" }), "DELETE /api/v1/me/ai-consent");
    },
    /** Whether this person's chat pushes show the message's words; the updated user, or null when the answer drifted. */
    setPushPreviews(show: boolean): Promise<User | null> {
      return userOf(request("/api/v1/me/push-previews", { method: "PUT", body: JSON.stringify({ show }) }), "PUT /api/v1/me/push-previews");
    },
    /** Whether the organization hides the message's words in every chat push (it wins over the person's choice). */
    async pushPreviewPolicy(orgSlug: string, signal?: AbortSignal): Promise<PushPreviewPolicy> {
      const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/push-preview-policy`, { signal });
      return parseWithFallback<PushPreviewPolicy>(raw, PushPreviewPolicySchema, NO_POLICY, { endpoint: "GET /api/v1/orgs/{org}/push-preview-policy" });
    },
    /** The language the server writes pushes and emails in (users.locale); null when the answer drifted. */
    setLocale(locale: "vi" | "en"): Promise<User | null> {
      return userOf(request("/api/v1/me", { method: "PATCH", body: JSON.stringify({ locale }) }), "PATCH /api/v1/me");
    },
  };
}

export type AccountApi = ReturnType<typeof createAccountApi>;

export const accountApi: AccountApi = createAccountApi((path, init) => api.request(path, init));

import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().optional().default(null),
  email_verified_at: z.string().nullable().optional().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).optional().default({}),
  locale: z.string().optional().default("en"),
  timezone: z.string().optional(),
  mfa_enabled_at: z.string().nullable().optional(),
  has_password: z.boolean().optional(),
  platform_role: z.string().optional(),
  // The AI processing notice the person agreed to (PUT /me/ai-consent); null when never or withdrawn.
  ai_consent_version: z.string().nullable().optional(),
  ai_consent_at: z.string().nullable().optional(),
  // When the person declined (or withdrew) AI processing: their chat messages stay out of every AI request; null otherwise.
  ai_opt_out_at: z.string().nullable().optional(),
  // Whether this person's chat pushes show the message's words (PUT /me/push-previews); absent reads as shown.
  push_previews: z.boolean().optional(),
});
export type User = z.infer<typeof UserSchema>;

/** Login answered with this instead of a session: the second factor is still owed. */
export const MFAChallengeSchema = z.object({
  mfa_required: z.literal(true),
  mfa_token: z.string(),
});
export type MFAChallenge = z.infer<typeof MFAChallengeSchema>;

export function isMFAChallenge(v: unknown): v is MFAChallenge {
  return MFAChallengeSchema.safeParse(v).success;
}

export const UserSessionSchema = z.object({
  id: z.string(),
  user_agent: z.string().optional().default(""),
  ip: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  last_seen_at: z.string().optional().default(""),
  current: z.boolean().optional().default(false),
});
export type UserSession = z.infer<typeof UserSessionSchema>;

export const SessionResponseSchema = z.object({
  user: UserSchema,
  access_token: z.string(),
  /**
   * Only from POST /auth/mfa/verify (ADR 0049): signed in, but the provider
   * the challenge waited to link was not linked; the code says why
   * (auth/sign-in-errors.ts linkSkippedNotice). Absent when nothing was skipped.
   */
  link_skipped: z.string().optional().catch(undefined),
  /**
   * This session took the account back from whoever registered the address
   * before proving it: say so once. Both extras read as absent when they
   * drift, so a notice never costs the session.
   */
  reclaimed: z.boolean().optional().catch(undefined),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

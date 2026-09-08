import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().optional().default(null),
  email_verified_at: z.string().nullable().optional().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).optional().default({}),
  locale: z.string().optional().default("vi"),
  timezone: z.string().optional(),
  mfa_enabled_at: z.string().nullable().optional(),
  has_password: z.boolean().optional(),
  platform_role: z.string().optional(),
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
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

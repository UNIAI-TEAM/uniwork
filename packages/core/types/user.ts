import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().optional().default(null),
  email_verified_at: z.string().nullable().optional().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).optional().default({}),
});
export type User = z.infer<typeof UserSchema>;

export const SessionResponseSchema = z.object({
  user: UserSchema,
  access_token: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

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
});
export type User = z.infer<typeof UserSchema>;

export const MatrixSessionSchema = z.object({
  user_id: z.string(),
  access_token: z.string(),
  device_id: z.string().optional(),
  home_server: z.string().optional(),
  base_url: z.string(),
});
export type MatrixSession = z.infer<typeof MatrixSessionSchema>;

export const SessionResponseSchema = z.object({
  user: UserSchema,
  access_token: z.string(),
  matrix: MatrixSessionSchema.optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

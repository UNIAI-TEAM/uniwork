import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().optional().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).optional().default({}),
});
export type User = z.infer<typeof UserSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: z.string().optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const PendingInvitationSchema = z.object({
  id: z.string(),
  role: z.string(),
  token: z.string(),
  expires_at: z.string(),
  workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  invited_by: z.object({ display_name: z.string() }),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

export const TaskKindSchema = z.enum(["normal", "welcome"]);

export const MemberSchema = z.object({
  workspace_id: z.string(),
  user_id: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.unknown().optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const TaskStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
  position: z.number(),
  kind: TaskKindSchema.optional().default("normal"),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

// Comment/note trả thẳng row sqlc (snake_case; created_at có thể là object
// pgtype) — schema phòng thủ, chỉ ép các field UI thật sự dùng.
export const TaskCommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const MeetingSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  room_name: z.string(),
  created_by: z.string(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingNoteSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
});
export type MeetingNote = z.infer<typeof MeetingNoteSchema>;

export const SessionResponseSchema = z.object({
  user: UserSchema,
  access_token: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const WorkspaceEventSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.string()).optional(),
});
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;

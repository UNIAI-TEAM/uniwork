import { z } from "zod";

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

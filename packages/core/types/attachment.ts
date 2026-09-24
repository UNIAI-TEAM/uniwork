import { z } from "zod";

/** Attachment metadata the editor/detail surfaces consume. Task 5 owns HTTP. */
export const AttachmentSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  task_id: z.string().nullable().optional(),
  comment_id: z.string().nullable().optional(),
  chat_session_id: z.string().nullable().optional(),
  chat_message_id: z.string().nullable().optional(),
  uploader_type: z.string().optional(),
  uploader_id: z.string().optional(),
  filename: z.string(),
  url: z.string(),
  download_url: z.string(),
  attachment_download_url: z.string().optional(),
  markdown_url: z.string().optional().default(""),
  content_type: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

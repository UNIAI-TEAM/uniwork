import { z } from "zod";

// Wire contract of the "other sources" list of the Documents home: files that
// live in chat, tasks, meetings and email, listed beside documents. Enums
// parse as z.string() and narrow on the exported types, like types/document.

export const DOCUMENT_SOURCE_KINDS = ["chat", "task", "meeting", "email"] as const;
export type DocumentSourceKind = (typeof DOCUMENT_SOURCE_KINDS)[number];

export const DOCUMENT_SOURCE_PARENT_KINDS = [
  "chat_channel",
  "chat_dm",
  "task",
  "task_comment",
  "meeting",
  "email_thread",
] as const;
export type DocumentSourceParentKind = (typeof DOCUMENT_SOURCE_PARENT_KINDS)[number];

export const DOCUMENT_SOURCE_TYPES = ["docx", "xlsx", "pptx", "pdf", "md", "html", "image", "other"] as const;
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

export const DocumentSourceFileSchema = z.object({
  id: z.string(),
  source: z.string(),
  parent: z.object({
    kind: z.string(),
    id: z.string(),
    title: z.string(),
    message_id: z.string().optional().default("").catch(""),
  }),
  name: z.string(),
  mime_type: z.string().optional().default(""),
  extension: z.string().optional().default(""),
  size_bytes: z.number().optional().default(0),
  updated_at: z.string().optional().default(""),
  owner: z
    .object({ id: z.string(), kind: z.string(), name: z.string() })
    .nullable()
    .optional()
    .default(null),
  can_open_in_app: z.boolean().optional().default(false),
  // Whether the file can become a document (type on the document allowlist,
  // size within the cap). Absent means false: a client never offers Save on a
  // row the server did not vouch for.
  can_save: z.boolean().optional().default(false),
});
export type DocumentSourceFile = Omit<z.infer<typeof DocumentSourceFileSchema>, "source" | "parent"> & {
  source: DocumentSourceKind;
  parent: { kind: DocumentSourceParentKind; id: string; title: string; message_id?: string };
};

export const DocumentSourceListSchema = z.object({
  items: z.array(DocumentSourceFileSchema),
  next_cursor: z.string().nullable().optional(),
});
export type DocumentSourceList = Omit<z.infer<typeof DocumentSourceListSchema>, "items"> & {
  items: DocumentSourceFile[];
};

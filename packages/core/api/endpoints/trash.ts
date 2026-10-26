import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export type TrashKind = "task" | "project" | "document";

// Lenient: `kind` stays a plain string so a kind a later server adds does not drop the whole page.
const TrashItemSchema = z.object({
  kind: z.string(),
  id: z.string(),
  title: z.string().default(""),
  identifier: z.string().default(""),
  sub_kind: z.string().default(""),
  count: z.number().default(0),
  location_title: z.string().default(""),
  location_path: z.array(z.string()).default([]),
  trashed_by: z.string().default(""),
  trashed_at: z.string().default(""),
  purge_after: z.string().default(""),
  can_manage: z.boolean().default(false),
});
export type TrashItem = z.infer<typeof TrashItemSchema>;

const TrashPageSchema = z
  .object({
    items: z.array(TrashItemSchema),
    next_cursor: z.string().default(""),
  })
  .transform((page) => ({ items: page.items, next_cursor: page.next_cursor || null }));
export type TrashPage = z.output<typeof TrashPageSchema>;

export interface TrashListOptions {
  kind?: TrashKind;
  q?: string;
  trashedBy?: string;
  cursor?: string;
}

/** One list over tasks, projects and documents in the trash; empty filters are left off the URL. */
export async function listTrash(workspaceId: string, opts: TrashListOptions = {}): Promise<TrashPage> {
  const params = new URLSearchParams();
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.q) params.set("q", opts.q);
  if (opts.trashedBy) params.set("trashed_by", opts.trashedBy);
  if (opts.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/trash${qs ? `?${qs}` : ""}`,
  );
  return parseWithFallback<TrashPage>(raw, TrashPageSchema, { items: [], next_cursor: null }, {
    endpoint: "GET /api/v1/workspaces/{ws}/trash",
  });
}

import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/** Every kind, in the order the filter lists them and the request names them. */
export const TRASH_KINDS = ["task", "project", "document"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/** The most deleters one request may name; the server answers 400 invalid_filter past it (trashMaxDeleters). */
export const TRASH_MAX_DELETERS = 100;

// Lenient: `kind` stays a plain string so a kind a later server adds does not drop the whole page.
const TrashItemSchema = z.object({
  kind: z.string(),
  id: z.string(),
  title: z.string().default(""),
  identifier: z.string().default(""),
  sub_kind: z.string().default(""),
  /** Document only: its folder, empty at the workspace root. */
  parent_id: z.string().default(""),
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
  kinds?: TrashKind[];
  q?: string;
  trashedBy?: string[];
  cursor?: string;
}

/**
 * One list over tasks, projects and documents in the trash. kind and trashed_by repeat (OR within each);
 * empty filters and empty values are left off the URL, since the server refuses an empty value.
 */
export async function listTrash(workspaceId: string, opts: TrashListOptions = {}): Promise<TrashPage> {
  const params = new URLSearchParams();
  for (const kind of opts.kinds ?? []) if (kind) params.append("kind", kind);
  if (opts.q) params.set("q", opts.q);
  for (const id of opts.trashedBy ?? []) if (id) params.append("trashed_by", id);
  if (opts.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/trash${qs ? `?${qs}` : ""}`,
  );
  return parseWithFallback<TrashPage>(raw, TrashPageSchema, { items: [], next_cursor: null }, {
    endpoint: "GET /api/v1/workspaces/{ws}/trash",
  });
}

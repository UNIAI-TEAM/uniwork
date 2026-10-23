import { z } from "zod";

/** A Work Graph node as the API returns it (C-11). Lenient: types stay strings. */
export const GraphNodeSchema = z.object({
  type: z.string(),
  id: z.string(),
  subtype: z.string().optional().default(""),
  title: z.string().optional().default(""),
  status: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  workspace_slug: z.string().optional().default(""),
  deleted: z.boolean().optional().default(false),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphNeighborSchema = z.object({
  edge_type: z.string(),
  direction: z.string(),
  origin: z.string().optional().default("SYSTEM"),
  valid_from: z.string().optional().default(""),
  backfilled: z.boolean().optional().default(false),
  node: GraphNodeSchema,
});
export type GraphNeighbor = z.infer<typeof GraphNeighborSchema>;

export const GraphHistoryItemSchema = z.object({
  kind: z.string(),
  edge_type: z.string().optional().default(""),
  fact_type: z.string().optional().default(""),
  direction: z.string().optional().default(""),
  origin: z.string().optional().default("SYSTEM"),
  valid_from: z.string(),
  valid_to: z.string().optional().default(""),
  value: z.string().optional().default(""),
  previous: z.string().optional().default(""),
  precision: z.string().optional().default(""),
  previous_precision: z.string().optional().default(""),
  backfilled: z.boolean().optional().default(false),
  node: GraphNodeSchema.optional(),
});
export type GraphHistoryItem = z.infer<typeof GraphHistoryItemSchema>;

export interface GraphNeighbors {
  node: GraphNode | null;
  items: GraphNeighbor[];
  next_cursor: string;
}

export interface GraphHistory {
  node: GraphNode | null;
  items: GraphHistoryItem[];
}

import { z } from "zod";
import {
  GraphHistoryItemSchema,
  GraphNeighborSchema,
  GraphNodeSchema,
  type GraphHistory,
  type GraphNeighbors,
} from "../../types/graph";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** Keeps the rows that parse, so one drifted neighbor does not blank the panel. */
function lenientRows<T>(raw: unknown[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const item of raw) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

const Envelope = z.object({
  node: GraphNodeSchema.nullable().optional().catch(null),
  items: z.array(z.unknown()).optional().default([]),
  next_cursor: z.string().optional().catch(undefined),
});

function nodePath(wsId: string, nodeType: string, nodeId: string): string {
  return `/api/v1/workspaces/${enc(wsId)}/graph/nodes/${enc(nodeType)}/${enc(nodeId)}`;
}

export async function getGraphNeighbors(
  wsId: string,
  nodeType: string,
  nodeId: string,
  opts: { edgeTypes?: string[]; direction?: "out" | "in" | "both"; cursor?: string; limit?: number } = {},
): Promise<GraphNeighbors> {
  const p = new URLSearchParams();
  if (opts.edgeTypes?.length) p.set("edge_types", opts.edgeTypes.join(","));
  if (opts.direction) p.set("direction", opts.direction);
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit) p.set("limit", String(opts.limit));
  const qs = p.toString();
  const raw = await request(`${nodePath(wsId, nodeType, nodeId)}/neighbors${qs ? `?${qs}` : ""}`);
  const parsed = parseWithFallback<z.infer<typeof Envelope>>(raw, Envelope, { node: null, items: [], next_cursor: undefined }, {
    endpoint: "GET /api/v1/workspaces/{ws}/graph/nodes/{type}/{id}/neighbors",
  });
  return { node: parsed.node ?? null, items: lenientRows(parsed.items ?? [], GraphNeighborSchema), next_cursor: parsed.next_cursor ?? "" };
}

export async function getGraphHistory(wsId: string, nodeType: string, nodeId: string): Promise<GraphHistory> {
  const raw = await request(`${nodePath(wsId, nodeType, nodeId)}/history`);
  const parsed = parseWithFallback<z.infer<typeof Envelope>>(raw, Envelope, { node: null, items: [], next_cursor: undefined }, {
    endpoint: "GET /api/v1/workspaces/{ws}/graph/nodes/{type}/{id}/history",
  });
  return { node: parsed.node ?? null, items: lenientRows(parsed.items ?? [], GraphHistoryItemSchema) };
}

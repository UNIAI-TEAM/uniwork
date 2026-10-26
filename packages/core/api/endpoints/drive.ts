import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/**
 * Single schema for a Google Drive connection row (B1 contract 8252ec181, UNI-2186).
 * Kept in one definition so a field rename is a one-line edit. Status is parsed
 * as z.string() on the wire so a future status degrades to active-but-unknown.
 */
const DriveConnectionSchema = z.object({
  id: z.string(),
  provider: z.string().optional().default("google"),
  google_email: z.string(),
  status: z.string().optional().default("active"),
  needs_reconnect: z.boolean().optional().catch(false).default(false),
  auth_failed_at: z.string().nullable().optional().catch(null).default(null),
  auth_failed_reason: z.string().optional().catch("").default(""),
  linked_file_count: z.number().int().nonnegative().optional().catch(0).default(0),
  connected_at: z.string(),
  updated_at: z.string().optional().default(""),
});

export type DriveConnection = z.infer<typeof DriveConnectionSchema>;

const DriveConnectionListSchema = z.object({
  connections: z.array(DriveConnectionSchema),
});

export type DriveConnectionList = z.infer<typeof DriveConnectionListSchema>;

const DriveConnectStartSchema = z.object({
  authorization_url: z.string().trim().min(1),
});

const DisconnectResponseSchema = z.object({
  status: z.string().optional().default("ok"),
});

const EMPTY_CONNECTIONS: DriveConnectionList = { connections: [] };

/**
 * Whether a Drive connection has lost authorization (`needs_reconnect === true`
 * or `status === "needs_reconnect"`). Any unknown status is treated as
 * active-but-unknown so a new server state does not lock the account out.
 */
export function isDriveConnectionLost(
  connection: Pick<DriveConnection, "status" | "needs_reconnect">,
): boolean {
  return Boolean(connection.needs_reconnect) || connection.status === "needs_reconnect";
}

export async function listDriveConnections(workspaceId: string): Promise<DriveConnectionList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-connections`);
  return parseWithFallback(raw, DriveConnectionListSchema, EMPTY_CONNECTIONS, {
    endpoint: "GET /api/v1/workspaces/{ws}/drive-connections",
  });
}

export async function startDriveConnect(
  workspaceId: string,
  options?: { reconnect_connection_id?: string },
): Promise<string | null> {
  const body = options?.reconnect_connection_id
    ? { reconnect_connection_id: options.reconnect_connection_id }
    : {};
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-connections/google/start`, {
    method: "POST",
    body,
  });
  const parsed = parseWithFallback<{ authorization_url: string } | null>(
    raw,
    DriveConnectStartSchema,
    null,
    {
      endpoint: "POST /api/v1/workspaces/{ws}/drive-connections/google/start",
    },
  );
  return parsed?.authorization_url ?? null;
}

export async function disconnectDriveConnection(workspaceId: string, connectionId: string): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-connections/${enc(connectionId)}`,
    { method: "DELETE" },
  );
  parseWithFallback(raw, DisconnectResponseSchema, { status: "ok" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/drive-connections/{driveConnectionID}",
  });
}

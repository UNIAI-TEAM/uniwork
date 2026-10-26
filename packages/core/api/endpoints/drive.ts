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
  auth_failed_at: z.string().optional().catch(undefined),
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

const DrivePickerTokenSchema = z.object({
  access_token: z.string().trim().min(1),
  expires_at: z.string(),
  developer_key: z.string(),
  app_id: z.string(),
});

export type DrivePickerToken = z.infer<typeof DrivePickerTokenSchema>;

/**
 * Privacy-safe link receipt returned on `POST /workspaces/{ws}/drive-files`
 * (`sdo.DriveFileLinkReceiptDTO`, contract-2 2ad591108). Optional fields are
 * omitted by `omitempty` on the server; enums are parsed as `z.string()` so
 * unknown future states degrade without failing the response.
 */
const DriveFileLinkReceiptSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  external_file_id: z.string(),
  drive_id: z.string().optional().catch(undefined),
  name: z.string(),
  mime_type: z.string(),
  icon_kind: z.string().optional().default("generic"),
  sharing_state: z.string().optional().default("unknown"),
  web_view_link: z.string(),
  open_url: z.string(),
  viewer_access: z.string().optional().default("granted"),
  viewer_connection_id: z.string().optional().catch(undefined),
  viewer_account_email: z.string().optional().catch(undefined),
});

export type DriveFileLinkReceipt = z.infer<typeof DriveFileLinkReceiptSchema>;

const DriveFileLinkItemSchema = z.object({
  external_file_id: z.string(),
  outcome: z.string(),
  file: DriveFileLinkReceiptSchema.optional().catch(undefined),
  account_email: z.string().optional().catch(undefined),
  error_code: z.string().optional().catch(undefined),
  error_message: z.string().optional().catch(undefined),
});

export type DriveFileLinkItem = z.infer<typeof DriveFileLinkItemSchema>;

const DriveFileLinkResultsSchema = z.object({
  results: z.array(DriveFileLinkItemSchema),
});

export type DriveFileLinkResults = z.infer<typeof DriveFileLinkResultsSchema>;

export interface LinkDriveFilesBody {
  connection_id: string;
  external_file_ids: string[];
  task_id?: string | null;
}

const EMPTY_LINK_RESULTS: DriveFileLinkResults = { results: [] };

export async function getDrivePickerToken(
  workspaceId: string,
  connectionId: string,
): Promise<DrivePickerToken | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-connections/${enc(connectionId)}/picker-token`,
    { method: "POST", body: {} },
  );
  return parseWithFallback<DrivePickerToken | null>(raw, DrivePickerTokenSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/drive-connections/{driveConnectionID}/picker-token",
  });
}

export async function linkDriveFiles(
  workspaceId: string,
  body: LinkDriveFilesBody,
): Promise<DriveFileLinkResults> {
  const payload: {
    connection_id: string;
    external_file_ids: string[];
    task_id?: string;
  } = {
    connection_id: body.connection_id,
    external_file_ids: body.external_file_ids,
  };
  if (body.task_id) {
    payload.task_id = body.task_id;
  }
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-files`, {
    method: "POST",
    body: payload,
  });
  return parseWithFallback(raw, DriveFileLinkResultsSchema, EMPTY_LINK_RESULTS, {
    endpoint: "POST /api/v1/workspaces/{ws}/drive-files",
  });
}

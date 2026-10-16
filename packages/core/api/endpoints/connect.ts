import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ConsentClientSchema = z.object({
  client_id: z.string(),
  name: z.string(),
  logo_uri: z.string().optional().default(""),
  verified: z.boolean().optional().default(false),
});

const ConsentOrgSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional().default(""),
  write_enabled: z.boolean().optional().default(false),
});

const ConnectConsentSchema = z.object({
  attempt_id: z.string(),
  status: z.string(),
  client: ConsentClientSchema.nullable().optional().default(null),
  redirect_host: z.string().optional().default(""),
  scope: z.string().optional().default(""),
  write_requested: z.boolean().optional().default(false),
  organizations: z.array(ConsentOrgSchema).optional().default([]),
  csrf_token: z.string().optional().default(""),
});
export type ConnectConsent = z.infer<typeof ConnectConsentSchema>;

const ConnectResultSchema = z.object({ status: z.string(), redirect_to: z.string() });
export type ConnectResult = z.infer<typeof ConnectResultSchema>;

const ConnectedAppSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_name: z.string().optional().default(""),
  user_id: z.string().optional().default(""),
  user_name: z.string().optional().default(""),
  client_id: z.string(),
  client_name: z.string(),
  verified: z.boolean().optional().default(false),
  scope: z.string().optional().default(""),
  created_at: z.string(),
  last_used_at: z.string().nullable().optional().default(null),
});
export type ConnectedApp = z.infer<typeof ConnectedAppSchema>;

const ConnectedAppListSchema = z.object({
  grants: z.array(ConnectedAppSchema),
  mcp_url: z.string().optional().default(""),
});
export type ConnectedAppList = z.infer<typeof ConnectedAppListSchema>;

const McpPolicySchema = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
  enabled_at: z.string().nullable().optional().default(null),
  enabled_by: z.string().optional().default(""),
  write_enabled: z.boolean().optional().default(false),
  write_available: z.boolean().optional().default(false),
  write_enabled_at: z.string().nullable().optional().default(null),
  write_enabled_by: z.string().optional().default(""),
  mcp_url: z.string(),
});
export type McpPolicy = z.infer<typeof McpPolicySchema>;

const enc = encodeURIComponent;

/** Reads a pending connection request; each read rotates the CSRF token. */
export async function getConnectConsent(attemptId: string): Promise<ConnectConsent | null> {
  const raw = await request(`/api/v1/auth/connect/attempts/${enc(attemptId)}`);
  return parseWithFallback<ConnectConsent | null>(raw, ConnectConsentSchema, null, { endpoint: "GET /api/v1/auth/connect/attempts/{attemptID}" });
}

/** Approves (with an organization) or cancels; returns where to send the browser. */
export async function decideConnectConsent(
  attemptId: string,
  body: { decision: "approve" | "cancel"; csrf_token: string; organization_id?: string; write?: boolean },
): Promise<ConnectResult | null> {
  const raw = await request(`/api/v1/auth/connect/attempts/${enc(attemptId)}`, { method: "POST", body });
  return parseWithFallback<ConnectResult | null>(raw, ConnectResultSchema, null, { endpoint: "POST /api/v1/auth/connect/attempts/{attemptID}" });
}

export async function listMyConnectedApps(): Promise<ConnectedAppList> {
  const raw = await request("/api/v1/me/connected-apps");
  return parseWithFallback<ConnectedAppList>(raw, ConnectedAppListSchema, { grants: [], mcp_url: "" }, { endpoint: "GET /api/v1/me/connected-apps" });
}

export async function revokeMyConnectedApp(id: string): Promise<void> {
  await request(`/api/v1/me/connected-apps/${enc(id)}`, { method: "DELETE" });
}

export async function listOrgConnectedApps(orgSlug: string): Promise<ConnectedApp[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/connected-apps`);
  return parseWithFallback<ConnectedAppList>(raw, ConnectedAppListSchema, { grants: [], mcp_url: "" }, { endpoint: "GET /api/v1/orgs/{org}/connected-apps" }).grants;
}

export async function revokeOrgConnectedApp(orgSlug: string, id: string): Promise<void> {
  await request(`/api/v1/orgs/${enc(orgSlug)}/connected-apps/${enc(id)}`, { method: "DELETE" });
}

export async function getMcpPolicy(orgSlug: string): Promise<McpPolicy | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/mcp-policy`);
  return parseWithFallback<McpPolicy | null>(raw, McpPolicySchema, null, { endpoint: "GET /api/v1/orgs/{org}/mcp-policy" });
}

export async function setMcpPolicy(orgSlug: string, enabled: boolean): Promise<McpPolicy | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/mcp-policy`, { method: "PUT", body: { enabled } });
  return parseWithFallback<McpPolicy | null>(raw, McpPolicySchema, null, { endpoint: "PUT /api/v1/orgs/{org}/mcp-policy" });
}

/** Lets connected AI apps create and edit (ADR 0033); needs the connector on. */
export async function setMcpWritePolicy(orgSlug: string, enabled: boolean): Promise<McpPolicy | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/mcp-policy/write`, { method: "PUT", body: { enabled } });
  return parseWithFallback<McpPolicy | null>(raw, McpPolicySchema, null, { endpoint: "PUT /api/v1/orgs/{org}/mcp-policy/write" });
}

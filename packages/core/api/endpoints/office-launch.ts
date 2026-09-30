import { z } from "zod";
import type { ZodType } from "zod";
import { request, type RequestOpts } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;
const id = z.string().min(1).max(128);
const clientId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const deploymentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const launchTicket = z.string().regex(/^ticket_[A-Za-z0-9_-]{32,185}$/);
const operation = z.enum(["view", "edit"]);

/** Wire schemas are intentionally strict at the endpoint boundary. The
 * server owns enum evolution; callers receive null on a malformed answer via
 * parseWithFallback rather than a fabricated descriptor. */
export const createOfficeLaunchSessionRequestSchema = z.object({
  operation,
  version: z.number().int().positive().optional(),
  deployment_id: deploymentId,
  client_id: clientId,
  return_hint: z.enum(["office", "none"]).optional(),
}).strict();

export const officeLaunchSessionResponseSchema = z.object({
  launch_ticket: launchTicket,
  launch_url: z.string().regex(/^uniwork-office:\/\/open\/??\?ticket=ticket_[A-Za-z0-9_-]{32,185}$/).optional(),
  expires_at: z.string().datetime({ offset: true }),
  document_id: id,
  operation,
  version: z.number().int().nonnegative(),
}).strict();

const officeLaunchDescriptorSchema = z.object({
  id,
  organization_id: id,
  workspace_id: id,
  title: z.string().max(512),
  kind: z.literal("file"),
  operation,
  version: z.number().int().nonnegative(),
  revision: z.string().min(1).max(128),
  contract_version: z.literal("uniwork-office-engine-contract/1"),
  protocol_version: z.literal("1"),
  download_path: z.string().regex(/^\/api\/v1\/documents\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/download(?:\?version=[1-9][0-9]*)?$/),
}).strict();

export const exchangeOfficeLaunchSessionRequestSchema = z.object({
  launch_ticket: launchTicket,
  deployment_id: deploymentId,
  client_id: clientId,
  device_session_id: id,
}).strict();

export const exchangeOfficeLaunchSessionResponseSchema = z.object({
  receipt_id: id,
  document: officeLaunchDescriptorSchema,
  redeemed_at: z.string().datetime({ offset: true }),
}).strict();

export type CreateOfficeLaunchSessionRequest = z.infer<typeof createOfficeLaunchSessionRequestSchema>;
export type OfficeLaunchSessionResponse = z.infer<typeof officeLaunchSessionResponseSchema>;
export type ExchangeOfficeLaunchSessionRequest = z.infer<typeof exchangeOfficeLaunchSessionRequestSchema>;
export type ExchangeOfficeLaunchSessionResponse = z.infer<typeof exchangeOfficeLaunchSessionResponseSchema>;

export type OfficeLaunchRequestOpts = Pick<RequestOpts, "signal" | "correlationId">;

function redactLaunchSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLaunchSecrets);
  if (typeof value === "string") {
    return value
      .replace(/uniwork-office:\/\/open\?ticket=[^\s&"']+/g, "uniwork-office://open?ticket=[redacted]")
      .replace(/ticket_[A-Za-z0-9_-]+/g, "[redacted]");
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const safeKey = redactLaunchSecrets(key) as string;
    if (key === "launch_ticket" || key === "ticket" || key === "launch_url") return [safeKey, "[redacted]"];
    return [safeKey, redactLaunchSecrets(child)];
  }));
}

/** Keep the shared compatibility logger useful without ever writing a launch
 * ticket or a URL carrying one when a drifted response is malformed. */
function parseLaunchWithFallback<T>(raw: unknown, schema: ZodType, endpoint: string): T | null {
  const input = schema.safeParse(raw).success ? raw : redactLaunchSecrets(raw);
  return parseWithFallback<T | null>(input, schema, null, { endpoint });
}

/** POST /api/v1/documents/{documentID}/office/sessions. */
export async function createOfficeLaunchSession(
  documentId: string,
  body: CreateOfficeLaunchSessionRequest,
  opts?: OfficeLaunchRequestOpts,
): Promise<OfficeLaunchSessionResponse | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/sessions`, {
    method: "POST",
    body,
    signal: opts?.signal,
    correlationId: opts?.correlationId,
  });
  return parseLaunchWithFallback<OfficeLaunchSessionResponse>(raw, officeLaunchSessionResponseSchema, "POST /api/v1/documents/{documentID}/office/sessions");
}

/** POST /api/v1/office/sessions/exchange. Main-process adapters consume the
 * same shape; this module itself never sends a ticket to a renderer. */
export async function exchangeOfficeLaunchSession(
  body: ExchangeOfficeLaunchSessionRequest,
  opts?: OfficeLaunchRequestOpts,
): Promise<ExchangeOfficeLaunchSessionResponse | null> {
  const raw = await request("/api/v1/office/sessions/exchange", {
    method: "POST",
    body,
    signal: opts?.signal,
    correlationId: opts?.correlationId,
  });
  return parseLaunchWithFallback<ExchangeOfficeLaunchSessionResponse>(raw, exchangeOfficeLaunchSessionResponseSchema, "POST /api/v1/office/sessions/exchange");
}

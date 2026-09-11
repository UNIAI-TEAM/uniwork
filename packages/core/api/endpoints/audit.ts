import { z } from "zod";
import {
  AuditEventSchema,
  AuditExportSchema,
  type AuditEvent,
  type AuditExport,
} from "../../types/audit";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const AuditEventsResponse = z.object({
  events: z.array(AuditEventSchema),
  next_before: z.string().default(""),
});
const AuditEventResponse = z.object({ event: AuditEventSchema });
const RetentionResponse = z.object({ retain_days: z.number() });
const ExportResponse = z.object({ export: AuditExportSchema });
const ExportsResponse = z.object({ exports: z.array(AuditExportSchema) });

/** A page of the log plus the cursor for the next one, empty when at the end. */
export interface AuditPage {
  events: AuditEvent[];
  nextBefore: string;
}

export interface AuditQuery {
  before?: string;
  actor_id?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  workspace_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const enc = encodeURIComponent;

function queryString(q: AuditQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function listAuditEvents(orgId: string, query: AuditQuery = {}): Promise<AuditPage> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit${queryString(query)}`);
  const parsed = parseWithFallback<{ events: AuditEvent[]; next_before: string }>(
    raw,
    AuditEventsResponse,
    { events: [], next_before: "" },
    { endpoint: "GET /api/v1/orgs/{org}/audit" },
  );
  return { events: parsed.events, nextBefore: parsed.next_before };
}

export async function getAuditEvent(orgId: string, eventId: string): Promise<AuditEvent | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/${enc(eventId)}`);
  return (
    parseWithFallback<{ event: AuditEvent } | null>(raw, AuditEventResponse, null, {
      endpoint: "GET /api/v1/orgs/{org}/audit/{id}",
    })?.event ?? null
  );
}

export async function listResourceHistory(
  workspaceId: string,
  resourceType: string,
  resourceId: string,
): Promise<AuditEvent[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/resources/${enc(resourceType)}/${enc(resourceId)}/history`,
  );
  return parseWithFallback<{ events: AuditEvent[]; next_before: string }>(
    raw,
    AuditEventsResponse,
    { events: [], next_before: "" },
    { endpoint: "GET /api/v1/workspaces/{ws}/resources/{type}/{id}/history" },
  ).events;
}

/** Retention falls back to the server's own default when the shape drifts. */
export async function getAuditRetention(orgId: string): Promise<number> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/retention`);
  return parseWithFallback<{ retain_days: number }>(raw, RetentionResponse, { retain_days: 90 }, {
    endpoint: "GET /api/v1/orgs/{org}/audit/retention",
  }).retain_days;
}

export async function setAuditRetention(orgId: string, retainDays: number): Promise<number> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/retention`, {
    method: "PUT",
    body: { retain_days: retainDays },
  });
  return parseWithFallback<{ retain_days: number }>(raw, RetentionResponse, { retain_days: retainDays }, {
    endpoint: "PUT /api/v1/orgs/{org}/audit/retention",
  }).retain_days;
}

export async function listAuditExports(orgId: string): Promise<AuditExport[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/exports`);
  return parseWithFallback<{ exports: AuditExport[] }>(raw, ExportsResponse, { exports: [] }, {
    endpoint: "GET /api/v1/orgs/{org}/audit/exports",
  }).exports;
}

export async function createAuditExport(
  orgId: string,
  body: { format: "csv" | "json"; from: string; to: string },
): Promise<AuditExport | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/exports`, { method: "POST", body });
  return (
    parseWithFallback<{ export: AuditExport } | null>(raw, ExportResponse, null, {
      endpoint: "POST /api/v1/orgs/{org}/audit/exports",
    })?.export ?? null
  );
}

export async function getAuditExport(orgId: string, exportId: string): Promise<AuditExport | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/audit/exports/${enc(exportId)}`);
  return (
    parseWithFallback<{ export: AuditExport } | null>(raw, ExportResponse, null, {
      endpoint: "GET /api/v1/orgs/{org}/audit/exports/{id}",
    })?.export ?? null
  );
}

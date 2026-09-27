// Per-job grants. Service authentication (the bearer credential) says "this is
// Go"; the grant says "Go authorised THIS job on THIS input with THIS output
// target until THIS time". The two are separate secrets: the grant is an
// HMAC-signed token over the exact payload Go issued, so the engine can check
// every binding without a database and without trusting any field of the
// request body. Go mirrors this format in server/internal/office/grant.go.
//
// Token: base64url(json) "." base64url(HMAC-SHA256(key, GRANT_TAG + "." + base64url(json)))

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  EngineBoundaryError,
  grantableOperations,
  officeFormats,
  type EngineOperation,
  type GrantableOperation,
  type MeasuredInput,
  type OfficeFormat,
} from "@uniwork/office-contracts";

export const GRANT_TAG = "uniwork-office-grant/1";
const HEX64 = /^[0-9a-f]{64}$/;
const actorKinds = ["human", "agent", "system"] as const;

export interface GrantInput {
  checksum: string;
  length: number;
}

export interface GrantOutput {
  file_id: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: number;
  max_bytes: number;
}

export interface ServiceGrant {
  v: 1;
  grant_id: string;
  job_id: string;
  actor_id: string;
  actor_kind: (typeof actorKinds)[number];
  organization_id: string;
  workspace_id: string;
  document_id: string;
  operation: GrantableOperation;
  format: OfficeFormat;
  base_revision: number;
  base_version_id: string;
  input: GrantInput | null;
  output: GrantOutput | null;
  /** Epoch ms: the job must be finished by then. */
  deadline_at: number;
  issued_at: number;
  /** Epoch ms: the grant may not start a job after this. */
  expires_at: number;
}

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function mac(key: string, body: string): Buffer {
  return createHmac("sha256", key).update(GRANT_TAG + "." + body).digest();
}

/** Sign a grant. Go is the issuer in production; the service exposes this for
 * its own tests and for the Go parity fixture. */
export function signGrant(grant: ServiceGrant, key: string): string {
  const body = b64url(Buffer.from(JSON.stringify(grant), "utf8"));
  return body + "." + b64url(mac(key, body));
}

function scope(reason: string, extra: Record<string, unknown> = {}): never {
  throw new EngineBoundaryError("grant_scope", { reason, ...extra });
}

const isDict = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 128): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const int = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;

function parseInput(v: unknown): GrantInput | null {
  if (v === null) return null;
  if (!isDict(v) || typeof v.checksum !== "string" || !HEX64.test(v.checksum) || !int(v.length)) scope("malformed", { field: "input" });
  return { checksum: v.checksum, length: v.length };
}

function parseOutput(v: unknown): GrantOutput | null {
  if (v === null) return null;
  if (!isDict(v) || !str(v.file_id) || !str(v.url, 4096) || v.method !== "PUT" || !int(v.expires_at, 1) || !int(v.max_bytes, 1)) {
    scope("malformed", { field: "output" });
  }
  const headers: Record<string, string> = {};
  if (v.headers !== undefined) {
    if (!isDict(v.headers)) scope("malformed", { field: "output.headers" });
    for (const [name, value] of Object.entries(v.headers)) {
      if (typeof value !== "string") scope("malformed", { field: "output.headers" });
      headers[name] = value;
    }
  }
  return { file_id: v.file_id, url: v.url, method: "PUT", headers, expires_at: v.expires_at, max_bytes: v.max_bytes };
}

function parseGrant(raw: unknown): ServiceGrant {
  if (!isDict(raw) || raw.v !== 1) scope("malformed", { field: "v" });
  for (const key of ["grant_id", "job_id", "actor_id", "organization_id", "workspace_id", "document_id", "base_version_id"]) {
    if (!str(raw[key])) scope("malformed", { field: key });
  }
  if (!actorKinds.includes(raw.actor_kind as (typeof actorKinds)[number])) scope("malformed", { field: "actor_kind" });
  if (!grantableOperations.includes(raw.operation as GrantableOperation)) scope("malformed", { field: "operation" });
  if (!officeFormats.includes(raw.format as OfficeFormat)) scope("malformed", { field: "format" });
  if (!int(raw.base_revision)) scope("malformed", { field: "base_revision" });
  for (const key of ["deadline_at", "issued_at", "expires_at"]) {
    if (!int(raw[key], 1)) scope("malformed", { field: key });
  }
  return {
    v: 1,
    grant_id: raw.grant_id as string,
    job_id: raw.job_id as string,
    actor_id: raw.actor_id as string,
    actor_kind: raw.actor_kind as ServiceGrant["actor_kind"],
    organization_id: raw.organization_id as string,
    workspace_id: raw.workspace_id as string,
    document_id: raw.document_id as string,
    operation: raw.operation as GrantableOperation,
    format: raw.format as OfficeFormat,
    base_revision: raw.base_revision as number,
    base_version_id: raw.base_version_id as string,
    input: parseInput(raw.input ?? null),
    output: parseOutput(raw.output ?? null),
    deadline_at: raw.deadline_at as number,
    issued_at: raw.issued_at as number,
    expires_at: raw.expires_at as number,
  };
}

/** Verify signature and shape. Expiry is checked separately (checkLive) so a
 * status read of a finished job is not refused because the start window of
 * its grant has closed. */
export function verifyGrant(token: string | undefined, key: string): ServiceGrant {
  if (!token || token.length > 16384) scope("missing");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) scope("malformed");
  const [body, sig] = parts as [string, string];
  const expected = mac(key, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) scope("signature");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    scope("malformed");
  }
  return parseGrant(raw);
}

/** A grant may start a job only inside its window and before its deadline. */
export function checkLive(grant: ServiceGrant, now: number): void {
  if (grant.expires_at <= now) throw new EngineBoundaryError("grant_expired", { reason: "expires_at" });
  if (grant.deadline_at <= now) throw new EngineBoundaryError("grant_expired", { reason: "deadline_at" });
  if (grant.output && grant.output.expires_at <= now) throw new EngineBoundaryError("grant_expired", { reason: "output_target" });
}

export interface EnvelopeFacts {
  operation: EngineOperation;
  format: OfficeFormat;
  grantId?: string;
  baseRevision?: number;
  baseVersionId?: string;
  inputs: MeasuredInput | null;
}

/** Bind the validated envelope to the grant: every result-deciding field the
 * caller sent must be the one Go authorised. */
export function bindEnvelope(grant: ServiceGrant, facts: EnvelopeFacts, outputOrigins: readonly string[]): void {
  // The envelope must name the grant it runs under; a missing grant_id is
  // refused like a wrong one.
  if (facts.grantId !== grant.grant_id) scope("grant_id");
  if (facts.operation !== grant.operation) scope("operation");
  if (facts.format !== grant.format) scope("format");
  if (facts.baseRevision !== grant.base_revision) scope("base_revision");
  if (facts.baseVersionId !== grant.base_version_id) scope("base_version_id");
  if ((grant.input === null) !== (facts.inputs === null)) scope("input");
  if (grant.input && facts.inputs) {
    if (grant.input.checksum !== facts.inputs.checksum || grant.input.length !== facts.inputs.length) scope("input");
  }
  if (grant.output) {
    let target: URL;
    try {
      target = new URL(grant.output.url);
    } catch {
      scope("output_target");
    }
    // Defence in depth: even a correctly signed grant may only name the
    // storage origin the deployer configured, never an arbitrary host.
    if (!outputOrigins.includes(target.origin)) scope("output_origin");
  }
}

interface Consumption {
  jobId: string;
  fingerprint: string;
  forgetAt: number;
}

/** Single-use ledger: a grant starts at most one job. Entries live until the
 * grant could no longer start anything, so a grant replayed after its job was
 * forgotten is still refused. */
export class GrantLedger {
  private readonly used = new Map<string, Consumption>();

  constructor(private readonly maxEntries: number) {}

  lookup(grantId: string): Consumption | undefined {
    return this.used.get(grantId);
  }

  consume(grant: ServiceGrant, fingerprint: string, now: number): void {
    this.prune(now);
    if (this.used.size >= this.maxEntries) throw new EngineBoundaryError("engine_overloaded", { reason: "grant_ledger_full" });
    this.used.set(grant.grant_id, { jobId: grant.job_id, fingerprint, forgetAt: Math.max(grant.expires_at, grant.deadline_at) });
  }

  prune(now: number): void {
    for (const [id, entry] of this.used) if (entry.forgetAt <= now) this.used.delete(id);
  }

  get size(): number {
    return this.used.size;
  }
}

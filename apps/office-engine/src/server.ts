// Private HTTP surface of the engine service. Go is the only caller: every
// route except /healthz needs the service credential, and every job route
// also needs the job's grant. Request order for a submit:
//   credential -> body cap -> JSON -> convert refusal (Q7) -> grant signature
//   -> envelope schema -> operation bound? -> grant binding -> job.
// No route takes a URL or a path from the caller as something to fetch: input
// bytes arrive in the envelope (bound to the grant's checksum), and the only
// place output goes is the write target inside the signed grant.

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  EngineBoundaryError,
  EngineContractViolation,
  officeFormats,
  payloadFingerprint,
  validateEnvelope,
  type OfficeFormat,
} from "@uniwork/office-contracts";
import { nodeSha256Hex } from "@uniwork/office-engine/node";
import { capabilityResult, isBound, Q7_BLOCKER } from "./capability.ts";
import type { EngineServiceConfig } from "./config.ts";
import { boundaryFailure, notFoundRoute, toFailure, unauthenticated, type HttpFailure } from "./errors.ts";
import { bindEnvelope, verifyGrant } from "./grants.ts";
import { jobView, type JobManager } from "./jobs.ts";
import type { Metrics } from "./metrics.ts";

export interface ServerDeps {
  config: EngineServiceConfig;
  jobs: JobManager;
  metrics: Metrics;
  isReady: () => boolean;
}

const GRANT_HEADER = "x-office-grant";
const JOB_ROUTE = /^\/v1\/jobs\/([A-Za-z0-9_-]{1,128})(\/cancel)?$/;

function send(res: ServerResponse, status: number, body: Record<string, unknown> | string): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; version=0.0.4" : "application/json",
    "cache-control": "no-store",
  });
  res.end(text);
}

function fail(res: ServerResponse, failure: HttpFailure): void {
  send(res, failure.status, failure.body);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authenticated(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const isDict = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

async function submit(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): Promise<void> {
  const { config } = deps;
  // Base64 inflates by 4/3; the envelope around it is small.
  const bodyLimit = Math.ceil((config.limits.maxInputBytes * 4) / 3) + 64 * 1024;
  let raw: Buffer;
  try {
    raw = await readBody(req, bodyLimit);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      deps.metrics.rejected("upload_bounds");
      fail(res, boundaryFailure("upload_bounds", { max_input_bytes: config.limits.maxInputBytes }));
      return;
    }
    throw error;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new EngineContractViolation("envelope", "json_required", "body is not JSON");
  }
  if (isDict(envelope) && envelope.operation === "convert") {
    deps.metrics.rejected("unsupported_operation");
    fail(res, boundaryFailure("unsupported_operation", { reason: "q7_blocker", blocker: Q7_BLOCKER }, { operation: "convert" }));
    return;
  }
  const grant = verifyGrant(req.headers[GRANT_HEADER] as string | undefined, config.grantKey);
  const validated = await validateEnvelope(envelope, { hash: nodeSha256Hex });
  const env = envelope as Record<string, unknown>;
  const payload = env.payload as Record<string, unknown>;
  if (validated.operation === "cancel" || validated.operation === "capability" || !isBound(validated.operation, validated.format)) {
    deps.metrics.rejected("unsupported_operation");
    fail(res, boundaryFailure("unsupported_operation", { reason: "not_bound" }, { operation: validated.operation }));
    return;
  }
  if (validated.inputs && validated.inputs.length > config.limits.maxInputBytes) {
    deps.metrics.rejected("upload_bounds");
    fail(res, boundaryFailure("upload_bounds", { max_input_bytes: config.limits.maxInputBytes }));
    return;
  }
  bindEnvelope(
    grant,
    {
      operation: validated.operation,
      format: validated.format,
      grantId: typeof env.grant_id === "string" ? env.grant_id : undefined,
      baseRevision: typeof payload.base_revision === "number" ? payload.base_revision : undefined,
      baseVersionId: typeof payload.base_version_id === "string" ? payload.base_version_id : undefined,
      inputs: validated.inputs,
    },
    config.outputOrigins,
  );
  const fingerprint = await payloadFingerprint(env, { inputs: validated.inputs, hash: nodeSha256Hex });
  const { job, replay } = deps.jobs.submit({
    grant,
    fingerprint,
    requestId: env.request_id as string,
    deadlineMs: validated.deadlineMs,
    input: validated.inputs?.bytes ?? null,
  });
  send(res, replay ? 200 : 202, { ...jobView(job), replay, payload_fingerprint: fingerprint });
}

function jobRoute(req: IncomingMessage, res: ServerResponse, deps: ServerDeps, jobId: string, cancel: boolean): void {
  const grant = verifyGrant(req.headers[GRANT_HEADER] as string | undefined, deps.config.grantKey);
  if (grant.job_id !== jobId) throw new EngineBoundaryError("grant_scope", { reason: "job_id" });
  const job = deps.jobs.get(jobId);
  if (!job) throw new EngineBoundaryError("not_found", { resource: "job" });
  if (job.grantId !== grant.grant_id) throw new EngineBoundaryError("grant_scope", { reason: "grant_id" });
  if (!cancel) {
    send(res, 200, jobView(job));
    return;
  }
  const { previous } = deps.jobs.cancel(jobId);
  send(res, 200, { ...jobView(job), previous_state: previous, linearized_at: Date.now() });
}

async function route(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): Promise<void> {
  const url = new URL(req.url ?? "/", "http://engine.invalid");
  const path = url.pathname;
  if (req.method === "GET" && path === "/healthz") {
    send(res, 200, { status: "ok" });
    return;
  }
  if (!authenticated(req, deps.config.serviceToken)) {
    deps.metrics.rejected("service_unauthenticated");
    fail(res, unauthenticated());
    return;
  }
  if (req.method === "GET" && path === "/readyz") {
    const ready = deps.isReady() && !deps.jobs.isDraining;
    send(res, ready ? 200 : 503, {
      status: ready ? "ready" : deps.jobs.isDraining ? "draining" : "starting",
      queue_depth: deps.jobs.queueDepth,
      running: deps.jobs.runningCount,
      max_workers: deps.config.maxWorkers,
      max_queue: deps.config.maxQueue,
    });
    return;
  }
  if (req.method === "GET" && path === "/metrics") {
    send(
      res,
      200,
      deps.metrics.render({
        queueDepth: deps.jobs.queueDepth,
        running: deps.jobs.runningCount,
        maxWorkers: deps.config.maxWorkers,
        maxQueue: deps.config.maxQueue,
      }),
    );
    return;
  }
  if (req.method === "GET" && path === "/v1/capability") {
    const format = url.searchParams.get("format") ?? "";
    if (!officeFormats.includes(format as OfficeFormat)) {
      throw new EngineContractViolation("query.format", "enum_required", "got " + JSON.stringify(format));
    }
    send(res, 200, capabilityResult(format as OfficeFormat, deps.config.limits.maxInputBytes));
    return;
  }
  if (req.method === "POST" && path === "/v1/jobs") {
    await submit(req, res, deps);
    return;
  }
  const match = JOB_ROUTE.exec(path);
  if (match && ((req.method === "GET" && !match[2]) || (req.method === "POST" && match[2]))) {
    jobRoute(req, res, deps, match[1] as string, Boolean(match[2]));
    return;
  }
  fail(res, notFoundRoute());
}

export function createHttpServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    route(req, res, deps).catch((error: unknown) => {
      const failure = toFailure(error);
      const code = (failure.body.error as { code?: string } | undefined)?.code ?? "unknown";
      deps.metrics.rejected(code);
      if (!res.headersSent) fail(res, failure);
      else res.destroy();
    });
  });
}

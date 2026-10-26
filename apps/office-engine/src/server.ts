// Private HTTP surface of the engine service. Go is the only caller: every
// route except /healthz needs the service credential, and every job route
// also needs the job's grant. Request order for a submit:
//   credential -> declared frame bounds -> input byte budget -> envelope ->
//   JSON -> grant signature -> envelope schema -> operation bound? ->
//   grant binding -> stream the input to the job dir (sha256 + count) -> job.
// A job with input arrives as a framed body (job transport framed/1, SIZE-OPS1): the JSON
// envelope, then the raw input bytes, never base64 inside the JSON. The input
// goes straight to <jobdir>/input.bin while it is hashed, so no request holds
// an input in memory, and the job holds a path. The input byte budget
// (config.inputBudgetBytes) bounds the bytes admitted to disk at once; a
// submit over it answers 503 engine_overloaded with Retry-After before a byte
// of its body is read.
// No route takes a URL or a path from the caller as something to fetch: input
// bytes arrive in the request body (bound to the grant's checksum), and the
// only place output goes is the write target inside the signed grant.

import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ENVELOPE_LENGTH_HEADER,
  ENVELOPE_MAX_BYTES,
  EngineBoundaryError,
  EngineContractViolation,
  OFFICE_JOB_CONTENT_TYPE,
  officeFormats,
  payloadFingerprint,
  validateEnvelope,
  type DeclaredInput,
  type OfficeFormat,
} from "@uniwork/office-contracts";
import { nodeSha256Hex } from "@uniwork/office-engine/node";
import { capabilityResult, docsPdfRendererMissing, isBound } from "./capability.ts";
import { createJobDir, INPUT_NAME, logCleanupFailure, removeJobDir } from "./cleanup.ts";
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
    // An answer that leaves body bytes unread (a refusal mid-upload) closes
    // the connection: the rest is never read, and the next request on a kept
    // socket would start inside it.
    ...(res.req.complete ? {} : { connection: "close" }),
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

function framing(detail: string): EngineContractViolation {
  return new EngineContractViolation("request.body", "framing", detail);
}

/** A request body read in steps: the envelope prefix first, then the input
    that follows it. Pulling from the stream's iterator only on demand keeps
    the unread rest in the socket, where backpressure holds it. */
class BodyReader {
  private readonly chunks: AsyncIterator<Buffer>;
  private pending: Buffer | null = null;

  constructor(req: IncomingMessage) {
    this.chunks = req[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async next(): Promise<Buffer | null> {
    if (this.pending) {
      const chunk = this.pending;
      this.pending = null;
      return chunk;
    }
    const step = await this.chunks.next();
    return step.done ? null : step.value;
  }

  /** Exactly n bytes; whatever arrived past them stays for the next read. */
  async take(n: number): Promise<Buffer> {
    const out = Buffer.allocUnsafe(n);
    let filled = 0;
    while (filled < n) {
      const chunk = await this.next();
      if (!chunk) throw framing("envelope_length");
      const used = Math.min(chunk.length, n - filled);
      chunk.copy(out, filled, 0, used);
      filled += used;
      if (used < chunk.length) this.pending = chunk.subarray(used);
    }
    return out;
  }

  /** The whole rest of the body, refused past limit bytes. */
  async all(limit: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let size = 0;
    for (let chunk = await this.next(); chunk; chunk = await this.next()) {
      size += chunk.length;
      if (size > limit) throw new BodyTooLarge();
      parts.push(chunk);
    }
    return Buffer.concat(parts, size);
  }

  /** Read and discard the rest (its length is bounded by Content-Length). */
  async drain(): Promise<void> {
    while (await this.next());
  }

  /** Stream the rest into a new file at path, hashing and counting it on the
      way; the bytes must be exactly the declared input. */
  async writeInput(path: string, input: DeclaredInput): Promise<void> {
    const hash = createHash("sha256");
    let count = 0;
    const next = () => this.next();
    await pipeline(async function* () {
      for (let chunk = await next(); chunk; chunk = await next()) {
        count += chunk.length;
        if (count > input.length) throw framing("input_length");
        hash.update(chunk);
        yield chunk;
      }
    }, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    if (count !== input.length) throw framing("input_length");
    const measured = hash.digest("hex");
    if (measured !== input.checksum) {
      throw new EngineBoundaryError("upload_checksum_mismatch", { declared_checksum: input.checksum, measured });
    }
  }
}

/** The declared shape of a submit body, from its headers alone. */
interface Frame {
  framed: boolean;
  /** Envelope prefix length; null for a plain JSON body of unknown length. */
  envelopeLength: number | null;
  inputLength: number;
}

function readFrame(req: IncomingMessage, maxInputBytes: number): Frame {
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const raw = req.headers["content-length"];
  const declared = raw === undefined ? null : Number(raw);
  if (contentType !== OFFICE_JOB_CONTENT_TYPE) {
    if (contentType !== "application/json") {
      throw new EngineContractViolation("request.content_type", "content_type", "expected " + OFFICE_JOB_CONTENT_TYPE + " or application/json");
    }
    // Plain JSON: the envelope is the whole body and the job has no input.
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw framing("content_length");
    if (declared !== null && declared > ENVELOPE_MAX_BYTES) {
      throw new EngineBoundaryError("upload_bounds", { reason: "envelope", max_envelope_bytes: ENVELOPE_MAX_BYTES });
    }
    return { framed: false, envelopeLength: declared, inputLength: 0 };
  }
  // A frame needs its total up front: no chunked body, so the input length is
  // known (and budgeted) before a byte is read.
  if (declared === null || !Number.isSafeInteger(declared)) throw framing("content_length");
  const header = req.headers[ENVELOPE_LENGTH_HEADER];
  const envelopeLength = typeof header === "string" && /^\d{1,10}$/.test(header) ? Number(header) : 0;
  if (envelopeLength < 1 || envelopeLength > ENVELOPE_MAX_BYTES) throw framing("envelope_length");
  if (declared < envelopeLength) throw framing("content_length");
  const inputLength = declared - envelopeLength;
  if (inputLength > maxInputBytes) {
    throw new EngineBoundaryError("upload_bounds", { declared_length: inputLength, max_input_bytes: maxInputBytes });
  }
  return { framed: true, envelopeLength, inputLength };
}

const isDict = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Only worker-relevant payload fields cross into the job dir: edits[],
    locale, and a convert or export job's target (with the source version for the
    result's provenance). Byte/checksum fields already became `input`; other
    refs stay on the wire. */
function buildJobPayload(operation: string, payload: Record<string, unknown>): Record<string, unknown> | null {
  const job: Record<string, unknown> = {};
  if (payload.edits !== undefined) job.edits = payload.edits;
  if (payload.locale !== undefined) job.locale = payload.locale;
  if (operation === "convert" || operation === "export") {
    if (payload.target_format !== undefined) job.target_format = payload.target_format;
    if (payload.source_version_id !== undefined) job.source_version_id = payload.source_version_id;
  }
  return Object.keys(job).length > 0 ? job : null;
}

async function submit(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): Promise<void> {
  const { config, jobs } = deps;
  const frame = readFrame(req, config.limits.maxInputBytes);
  const envelopeBytes = frame.envelopeLength ?? ENVELOPE_MAX_BYTES;
  // The budget is taken before a byte of the body is read: envelope + input at
  // admission, the envelope part held while the parsed payload stays live and
  // released when the submit ends, and the input part handed over to the new
  // job with its input file.
  let inputReserved = frame.inputLength;
  if (!jobs.reserveInput(envelopeBytes + inputReserved)) {
    res.setHeader("Retry-After", 2);
    throw new EngineBoundaryError("engine_overloaded", { reason: "input_budget" });
  }
  let dir: string | null = null;
  try {
    const body = new BodyReader(req);
    let envelope: unknown;
    try {
      const raw = frame.envelopeLength !== null ? await body.take(frame.envelopeLength) : await body.all(ENVELOPE_MAX_BYTES);
      try {
        envelope = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new EngineContractViolation("envelope", "json_required", "body is not JSON");
      }
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        throw new EngineBoundaryError("upload_bounds", { reason: "envelope", max_envelope_bytes: ENVELOPE_MAX_BYTES });
      }
      throw error;
    }
    const grant = verifyGrant(req.headers[GRANT_HEADER] as string | undefined, config.grantKey);
    // The configured cap travels into the contract validation: a declared
    // input_length already over it is refused before the input is read.
    const validated = await validateEnvelope(envelope, { inputByteBound: config.limits.maxInputBytes });
    const env = envelope as Record<string, unknown>;
    const payload = env.payload as Record<string, unknown>;
    if (validated.operation === "cancel" || validated.operation === "capability" || !isBound(validated.operation, validated.format)) {
      deps.metrics.rejected("unsupported_operation");
      fail(res, boundaryFailure("unsupported_operation", { reason: "not_bound" }, { operation: validated.operation }));
      return;
    }
    bindEnvelope(
      grant,
      {
        operation: validated.operation,
        format: validated.format,
        grantId: typeof env.grant_id === "string" ? env.grant_id : undefined,
        baseRevision: typeof payload.base_revision === "number" ? payload.base_revision : undefined,
        baseVersionId:
          validated.operation === "convert" || validated.operation === "export"
            ? validated.sourceVersionId
            : typeof payload.base_version_id === "string"
              ? payload.base_version_id
              : undefined,
        inputs: validated.inputs,
      },
      config.outputOrigins,
    );
    const inputs = validated.inputs;
    if (inputs && !frame.framed) {
      throw new EngineContractViolation("request.content_type", "content_type", "a job with input is sent as " + OFFICE_JOB_CONTENT_TYPE);
    }
    if ((inputs?.length ?? 0) !== frame.inputLength) throw framing("input_length");
    const fingerprint = await payloadFingerprint(env, { inputs, hash: nodeSha256Hex });
    // A replay answers the job this grant already started; its body is read
    // and dropped, never written a second time.
    const earlier = jobs.admit(grant, fingerprint);
    if (earlier) {
      await body.drain();
      send(res, 200, { ...jobView(earlier), replay: true, payload_fingerprint: fingerprint });
      return;
    }
    if (inputs) {
      dir = await createJobDir(config.tempRoot);
      await body.writeInput(join(dir, INPUT_NAME), inputs);
    }
    const { job, replay } = await jobs.submit({
      grant,
      fingerprint,
      requestId: env.request_id as string,
      deadlineMs: validated.deadlineMs,
      inputDir: dir,
      inputBytes: frame.inputLength,
      payload: buildJobPayload(validated.operation, payload),
    });
    if (!replay) {
      dir = null;
      inputReserved = 0;
    }
    send(res, replay ? 200 : 202, { ...jobView(job), replay, payload_fingerprint: fingerprint });
  } finally {
    // The envelope share is released once the HTTP submit ends; a refused,
    // replayed or aborted upload also removes its input file and input share
    // (on a removal failure only the input share stays held).
    jobs.releaseInput(envelopeBytes);
    if (dir) {
      await removeJobDir(dir).then(
        () => {
          jobs.releaseInput(inputReserved);
        },
        (error: unknown) => {
          logCleanupFailure(error);
        },
      );
    } else {
      jobs.releaseInput(inputReserved);
    }
  }
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
        quarantinedSlots: deps.jobs.sandboxQuarantined,
      }),
    );
    return;
  }
  if (req.method === "GET" && path === "/v1/capability") {
    const format = url.searchParams.get("format") ?? "";
    if (!officeFormats.includes(format as OfficeFormat)) {
      throw new EngineContractViolation("query.format", "enum_required", "got " + JSON.stringify(format));
    }
    const pdfMissing = docsPdfRendererMissing(deps.config.docsPdfAssetsDir, deps.jobs.sandboxActive);
    send(res, 200, capabilityResult(format as OfficeFormat, deps.config.limits.maxInputBytes, pdfMissing));
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
  const server = createServer((req, res) => {
    route(req, res, deps).catch((error: unknown) => {
      const failure = toFailure(error);
      const code = (failure.body.error as { code?: string } | undefined)?.code ?? "unknown";
      deps.metrics.rejected(code);
      if (!res.headersSent) fail(res, failure);
      else res.destroy();
    });
  });
  // Node's default 5s keep-alive expiry destroys an idle socket whenever the
  // timer fires; it cannot see request bytes the kernel already holds but the
  // event loop has not delivered yet. The close then goes out as a RST and an
  // in-flight POST dies as ECONNRESET instead of getting its answer (a caller
  // that shares or starves this loop — e.g. a big in-process upload — makes
  // the window real). Idle reaping is the client's job: Go's transport and
  // undici both run their own idle timeouts, so the server keeps an idle
  // keep-alive connection until the client closes it. Shutdown is unaffected —
  // service.close() already calls closeIdleConnections() itself.
  server.keepAliveTimeout = 0;
  return server;
}

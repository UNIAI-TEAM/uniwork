// Test harness: a REAL engine service on a loopback port with real worker
// processes (src/worker/entry.ts under Node 22 type stripping), plus a real
// HTTP "write target" standing in for the FileService provider-output URL.
// Nothing here mocks the transport.

import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { ENGINE_CONTRACT_VERSION, ENGINE_PROTOCOL_VERSION } from "@uniwork/office-contracts";
import { createEngineService, PROVISIONAL_LIMITS, signGrant, type EngineService, type EngineServiceConfig, type ServiceGrant } from "../src/index.ts";

export const SERVICE_TOKEN = "service-token-for-tests-0123456789abcdef";
export const GRANT_KEY = "grant-key-for-tests-fedcba9876543210-xyz";

// 128 uids per suite process keeps parallel vitest workers disjoint (one uid
// per worker slot, maxWorkers << 128); distinct per process so a killTree uid
// sweep can never touch a sibling suite's workers.
const WORKER_UID_BASE = 20000 + (Number(process.env.VITEST_WORKER_ID ?? 0) || process.pid % 251) * 128;

interface Upload {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface TargetServer {
  origin: string;
  uploads: Upload[];
  status: number;
  close(): Promise<void>;
}

async function startTarget(): Promise<TargetServer> {
  const uploads: Upload[] = [];
  const target: TargetServer = { origin: "", uploads, status: 200, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      uploads.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(target.status).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  target.origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  target.close = () => new Promise<void>((r) => server.close(() => r()));
  return target;
}

export interface Harness {
  service: EngineService;
  base: string;
  config: EngineServiceConfig;
  target: TargetServer;
  tempRoot: string;
  close(): Promise<void>;
}

export async function startHarness(overrides: Partial<EngineServiceConfig> = {}): Promise<Harness> {
  const target = await startTarget();
  const tempRoot = await mkdtemp(join(tmpdir(), "uw-office-engine-test-"));
  const config: EngineServiceConfig = {
    host: "127.0.0.1",
    port: 0,
    serviceToken: SERVICE_TOKEN,
    grantKey: GRANT_KEY,
    outputOrigins: [target.origin],
    maxWorkers: 2,
    maxQueue: 4,
    limits: { ...PROVISIONAL_LIMITS, maxJobMs: 30_000 },
    tempRoot,
    workerEntry: resolve(import.meta.dirname, "../src/worker/entry.ts"),
    sampleMs: 25,
    terminalRetentionMs: 60_000,
    maxRetainedJobs: 100,
    faultOperations: true,
    shutdownGraceMs: 5_000,
    // The uid sweep in killTree is kernel-wide, so every test process needs a
    // disjoint uid pool: one per vitest worker. Production runs one engine per
    // container, so its own pool is exclusive by deployment.
    sandbox: { mode: "auto", uidBase: WORKER_UID_BASE, gidBase: WORKER_UID_BASE },
    ...overrides,
  };
  const service = createEngineService(config);
  const port = await service.listen();
  return {
    service,
    base: "http://127.0.0.1:" + port,
    config,
    target,
    tempRoot,
    async close() {
      await service.close();
      await target.close();
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface JobSpec {
  /** Text input (utf8) — or pass `bytes` for binary formats like pdf. */
  text?: string;
  bytes?: Uint8Array;
  format?: "md" | "html" | "docx" | "pdf" | "xlsx";
  operation?: string;
  deadlineMs?: number;
  grant?: Partial<ServiceGrant>;
  envelope?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export function makeGrant(target: TargetServer, overrides: Partial<ServiceGrant> = {}): ServiceGrant {
  const now = Date.now();
  const jobId = overrides.job_id ?? "job" + randomUUID().replace(/-/g, "");
  return {
    v: 1,
    grant_id: "grant" + randomUUID().replace(/-/g, ""),
    job_id: jobId,
    actor_id: "user-1",
    actor_kind: "human",
    organization_id: "org-1",
    workspace_id: "ws-1",
    document_id: "doc-1",
    operation: "serialize",
    format: "md",
    base_revision: 3,
    base_version_id: "ver-3",
    input: null,
    output: {
      file_id: "file-" + jobId,
      url: target.origin + "/put/" + jobId + "?sig=abc",
      method: "PUT",
      headers: { "content-type": "text/markdown", "x-amz-meta-test": "1" },
      expires_at: now + 60_000,
      max_bytes: 10 * 1024 * 1024,
    },
    deadline_at: now + 60_000,
    issued_at: now,
    expires_at: now + 60_000,
    ...overrides,
  };
}

export function makeJob(target: TargetServer, spec: JobSpec): { grant: ServiceGrant; token: string; envelope: Record<string, unknown> } {
  const bytes = spec.bytes ? Buffer.from(spec.bytes) : Buffer.from(spec.text ?? "", "utf8");
  const format = spec.format ?? "md";
  const operation = spec.operation ?? "serialize";
  const grant = makeGrant(target, {
    format,
    operation: operation as ServiceGrant["operation"],
    input: { checksum: sha256(bytes), length: bytes.length },
    ...spec.grant,
  });
  const envelope: Record<string, unknown> = {
    request_id: "req-" + grant.job_id,
    contract_version: ENGINE_CONTRACT_VERSION,
    protocol_version: ENGINE_PROTOCOL_VERSION,
    operation,
    format,
    deadline_ms: spec.deadlineMs ?? 20_000,
    idempotency_key: grant.job_id,
    grant_id: grant.grant_id,
    payload: {
      document_model_ref: "model-" + grant.document_id,
      base_revision: grant.base_revision,
      base_version_id: grant.base_version_id,
      input_bytes: bytes.toString("base64"),
      input_checksum: sha256(bytes),
      input_length: bytes.length,
      ...spec.payload,
    },
    ...spec.envelope,
  };
  return { grant, token: signGrant(grant, GRANT_KEY), envelope };
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export async function call(
  h: Harness,
  method: string,
  path: string,
  opts: { token?: string | null; grant?: string; body?: unknown; rawBody?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== null) headers.authorization = "Bearer " + (opts.token ?? SERVICE_TOKEN);
  if (opts.grant) headers["x-office-grant"] = opts.grant;
  const res = await fetch(h.base + path, {
    method,
    headers,
    body: method === "GET" ? undefined : (opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body))),
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  return { status: res.status, body };
}

export function submit(h: Harness, job: { token: string; envelope: Record<string, unknown> }): Promise<Reply> {
  return call(h, "POST", "/v1/jobs", { grant: job.token, body: job.envelope });
}

export async function waitTerminal(h: Harness, job: { grant: ServiceGrant; token: string }, timeoutMs = 25_000): Promise<Reply> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const reply = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    const state = reply.body.state;
    if (state !== "accepted" && state !== "running") return reply;
    if (Date.now() > end) throw new Error("job did not settle: " + JSON.stringify(reply.body));
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function jobDirs(tempRoot: string): Promise<string[]> {
  return (await readdir(tempRoot)).filter((n) => n.startsWith("uw-office-job-"));
}

export function errorCode(reply: Reply): string | undefined {
  return (reply.body.error as { code?: string } | undefined)?.code;
}

export function errorReason(reply: Reply): string | undefined {
  return (reply.body.error as { reason?: string } | undefined)?.reason;
}

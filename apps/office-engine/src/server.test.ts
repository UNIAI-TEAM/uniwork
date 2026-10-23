import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import { request, type ClientRequest } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROVISIONAL_LIMITS } from "../src/index.ts";
import { ENGINE_JOB_TRANSPORT, ENVELOPE_MAX_BYTES, OFFICE_JOB_CONTENT_TYPE } from "@uniwork/office-contracts";
import { signGrant, type ServiceGrant } from "../src/grants.ts";
import {
  call,
  errorCode,
  errorReason,
  frame,
  GRANT_KEY,
  jobDirs,
  makeGrant,
  makeJob,
  sha256,
  SERVICE_TOKEN,
  startHarness,
  submit,
  waitTerminal,
  type Harness,
  type Job,
} from "../test/harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe("service authentication", () => {
  it("answers liveness without a credential and nothing else", async () => {
    expect((await call(h, "GET", "/healthz", { token: null })).status).toBe(200);
    for (const [method, path] of [
      ["GET", "/readyz"],
      ["GET", "/metrics"],
      ["GET", "/v1/capability?format=md"],
      ["POST", "/v1/jobs"],
      ["GET", "/v1/jobs/job1"],
      ["POST", "/v1/jobs/job1/cancel"],
    ] as const) {
      const none = await call(h, method, path, { token: null, body: {} });
      expect(none.status, method + " " + path).toBe(401);
      expect(errorCode(none)).toBe("service_unauthenticated");
      const wrong = await call(h, method, path, { token: GRANT_KEY, body: {} });
      expect(wrong.status, method + " " + path).toBe(401);
    }
  });

  it("does not accept a signed grant in place of the service credential", async () => {
    const job = makeJob(h.target, { text: "# hi" });
    const res = await call(h, "POST", "/v1/jobs", { token: job.token, grant: job.token, body: job.envelope });
    expect(res.status).toBe(401);
  });

  it("reports ready after the worker self-test", async () => {
    const res = await call(h, "GET", "/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", max_workers: 2, max_queue: 4 });
  });
});

describe("capability and unsupported operations", () => {
  it("reports honest rows: the xls/odt converters claim their pair, other rows stay honest", async () => {
    const md = await call(h, "GET", "/v1/capability?format=md");
    expect(md.status).toBe(200);
    expect(md.body.job_transport).toBe(ENGINE_JOB_TRANSPORT);
    const mdRows = md.body.capabilities as { operation: string; supported: boolean; evidence_level: string; reason?: string }[];
    expect(mdRows.find((r) => r.operation === "convert")).toMatchObject({ supported: false, reason: "no Q7 converter is bound from md" });
    expect(mdRows.find((r) => r.operation === "serialize")).toMatchObject({ supported: true, evidence_level: "pending" });

    const xls = await call(h, "GET", "/v1/capability?format=xls");
    expect(xls.status).toBe(200);
    const xlsRows = xls.body.capabilities as { operation: string; supported: boolean; runtime: string; evidence_level: string; reason?: string }[];
    expect(xlsRows.find((r) => r.operation === "convert")).toMatchObject({
      supported: true,
      runtime: "internal_service",
      evidence_level: "proven",
      reason: expect.stringContaining("xls -> xlsx"),
    });
    for (const op of ["open", "edit", "serialize"]) {
      expect(xlsRows.find((r) => r.operation === op)).toMatchObject({ supported: false, reason: "not bound in this service build" });
    }

    const xlsx = await call(h, "GET", "/v1/capability?format=xlsx");
    expect(xlsx.status).toBe(200);
    const xlsxRows = xlsx.body.capabilities as { operation: string; supported: boolean; runtime: string; evidence_level: string; reason?: string }[];
    for (const op of ["open", "edit", "serialize"]) {
      expect(xlsxRows.find((r) => r.operation === op)).toMatchObject({
        supported: true,
        runtime: "internal_service",
        evidence_level: "proven",
        reason: expect.stringContaining("real-loop evidence"),
      });
    }
    expect((await call(h, "GET", "/v1/capability?format=exe")).status).toBe(400);
  });

  it("claims export only for docx -> pdf, as pending evidence (UNI-1013)", async () => {
    type Row = { operation: string; supported: boolean; runtime: string; evidence_level: string; reason?: string };
    const docx = (await call(h, "GET", "/v1/capability?format=docx")).body.capabilities as Row[];
    expect(docx.find((r) => r.operation === "export")).toMatchObject({
      supported: true,
      runtime: "internal_service",
      evidence_level: "pending",
      reason: expect.stringContaining("docx -> pdf"),
    });
    const md = (await call(h, "GET", "/v1/capability?format=md")).body.capabilities as Row[];
    expect(md.find((r) => r.operation === "export")).toMatchObject({ supported: false, runtime: "none" });
  });

  it("claims export for a UniNote page to docx and pdf, as pending evidence (UNI-2004)", async () => {
    type Row = { operation: string; supported: boolean; runtime: string; evidence_level: string; reason?: string };
    const page = (await call(h, "GET", "/v1/capability?format=page")).body.capabilities as Row[];
    expect(page.find((r) => r.operation === "export")).toMatchObject({
      supported: true,
      runtime: "internal_service",
      evidence_level: "pending",
      reason: expect.stringContaining("page -> docx, pdf"),
    });
    expect(page.find((r) => r.operation === "open")).toMatchObject({ supported: false });
    // No renderer staged in the harness: pdf is not claimed (follow-6).
    expect(page.find((r) => r.operation === "export_pdf")).toMatchObject({ supported: false, reason: "docs_pdf_assets_missing" });
  });

  it("runs export:page to docx through the real job path and uploads the package", async () => {
    const input = { title: "Biên bản họp", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Đã chốt ngân sách" }] }] } };
    const job = makeJob(h.target, {
      operation: "export",
      format: "page",
      bytes: Buffer.from(JSON.stringify(input)),
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        source_version_id: "ver-3",
        target_format: "docx",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    const done = await waitTerminal(h, job);
    expect(done.body).toMatchObject({ state: "completed", result: { source_format: "page", target_format: "docx", source_version_id: "ver-3" } });
    const upload = h.target.uploads.at(-1)!;
    expect(upload.body.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
    expect(upload.body.toString("utf8")).toContain("Đã chốt ngân sách");
  });

  it("runs export:docx through the real job path; without the staged renderer it fails as engine_incompatible", async () => {
    const bytes = readFileSync(new URL("../../../docs/office/g0/fixtures/files/docs/docx-kitchen-sink.docx", import.meta.url));
    const job = makeJob(h.target, {
      operation: "export",
      format: "docx",
      bytes,
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        source_version_id: "ver-3",
        target_format: "pdf",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    const done = await waitTerminal(h, job);
    expect(done.body).toMatchObject({ state: "failed", error: { code: "engine_incompatible" } });
  });

  it("refuses an export whose bytes are missing from the payload", async () => {
    const job = makeJob(h.target, {
      operation: "export",
      format: "docx",
      text: "x",
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        input_checksum: undefined,
        input_length: undefined,
        source_version_id: "ver-3",
        target_format: "pdf",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.service.jobs.get(job.grant.job_id)).toBeUndefined();
  });

  it("answers an unbound convert pair with 501 unsupported_operation and does not consume the grant", async () => {
    const job = makeJob(h.target, {
      operation: "convert",
      format: "docx",
      text: "",
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        source_version_id: "ver-3",
        target_format: "pdf",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBe(501);
    expect(errorCode(res)).toBe("unsupported_operation");
    expect(errorReason(res)).toBe("not_bound");
    expect(h.service.jobs.get(job.grant.job_id)).toBeUndefined();
  });

  it("converts F-LEGACY-XLS through the real job path and settles its change list", async () => {
    const bytes = readFileSync(new URL("../../../docs/office/g0/fixtures/files/sheets/legacy-xls.xls", import.meta.url));
    const job = makeJob(h.target, {
      operation: "convert",
      format: "xls",
      bytes,
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        source_version_id: "ver-3",
        target_format: "xlsx",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("completed");
    expect(done.body.result).toMatchObject({
      operation: "convert",
      source_format: "xls",
      target_format: "xlsx",
      source_version_id: "ver-3",
      fidelity: { level: "limited" },
      content: { sheets: ["Sheet1", "Sheet2", "Sheet3"], cells: { "Sheet1!A1": "replaceMe" } },
    });
    expect(done.body.output_length as number).toBeGreaterThan(0);
  });

  it("converts F-UNSUPPORTED-ODT through the real job path and settles its change list", async () => {
    const bytes = readFileSync(new URL("../../../docs/office/g0/fixtures/files/legacy/unsupported-sample.odt", import.meta.url));
    const job = makeJob(h.target, {
      operation: "convert",
      format: "odt",
      bytes,
      payload: {
        document_model_ref: undefined,
        base_revision: undefined,
        base_version_id: undefined,
        source_version_id: "ver-3",
        target_format: "docx",
      },
    });
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("completed");
    const result = done.body.result as { fidelity: { level: string }; content: { paragraphs: string[] } };
    expect(result.fidelity.level).toBe("limited");
    expect(result.content.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(done.body.output_length as number).toBeGreaterThan(0);
  });

  it("answers an operation no handler binds with 501 and does not consume the grant", async () => {
    const job = makeJob(h.target, { text: "x", format: "docx" });
    const res = await submit(h, job);
    expect(res.status).toBe(501);
    expect(errorReason(res)).toBe("not_bound");
    expect(h.service.jobs.get(job.grant.job_id)).toBeUndefined();
  });
});

describe("submit, status and output hand-off", () => {
  it("runs a job on a real worker and PUTs the exact bytes to the grant's target", async () => {
    const text = "# Title\n\nBody with ư ơ.\n";
    const job = makeJob(h.target, { text });
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ job_id: job.grant.job_id, replay: false });
    const done = await waitTerminal(h, job);
    expect(done.body).toMatchObject({
      state: "completed",
      output_file_id: job.grant.output?.file_id,
      output_checksum: sha256(Buffer.from(text)),
      output_length: Buffer.byteLength(text),
    });
    const upload = h.target.uploads.find((u) => u.path.includes(job.grant.job_id));
    expect(upload?.body.toString("utf8")).toBe(text);
    expect(upload?.headers["x-amz-meta-test"]).toBe("1");
    expect(upload?.headers["content-type"]).toBe("text/markdown");
    // The status view never carries the target URL or a path.
    expect(JSON.stringify(done.body)).not.toContain("sig=abc");
    expect(JSON.stringify(done.body)).not.toContain(h.tempRoot);
  });

  it("replays the same job for a retried submit and refuses a changed payload", async () => {
    const job = makeJob(h.target, { text: "same" });
    expect((await submit(h, job)).status).toBe(202);
    const again = await submit(h, job);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ job_id: job.grant.job_id, replay: true });
    const changed = { ...job, envelope: { ...job.envelope, payload: { ...(job.envelope.payload as object), document_model_ref: "other" } } };
    const res = await submit(h, changed);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe("payload_fingerprint_mismatch");
    await waitTerminal(h, job);
  });

  it("refuses a second grant for a job id that already exists", async () => {
    const job = makeJob(h.target, { text: "first" });
    expect((await submit(h, job)).status).toBe(202);
    const second = makeJob(h.target, { text: "first", grant: { job_id: job.grant.job_id } });
    const res = await submit(h, second);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe("job_conflict");
    await waitTerminal(h, job);
  });

  it("fails the job when the write target rejects the output", async () => {
    h.target.status = 403;
    try {
      const job = makeJob(h.target, { text: "rejected" });
      await submit(h, job);
      const done = await waitTerminal(h, job);
      expect(done.body.state).toBe("failed");
      expect(done.body.error).toMatchObject({ code: "engine_crashed", reason: "output_write_rejected" });
      expect(done.body.output_file_id).toBeUndefined();
    } finally {
      h.target.status = 200;
    }
  });

  it("fails invalid UTF-8 as a typed engine error", async () => {
    const job = makeJob(h.target, { text: "x" });
    const bad = Buffer.from([0xff, 0xfe, 0x41]);
    job.grant.input = { checksum: sha256(bad), length: bad.length };
    const token = signGrant(job.grant, GRANT_KEY);
    const envelope = {
      ...job.envelope,
      payload: { ...(job.envelope.payload as object), input_checksum: sha256(bad), input_length: 3 },
    };
    await submit(h, { token, envelope, bytes: bad });
    const done = await waitTerminal(h, { grant: job.grant, token });
    expect(done.body.error).toMatchObject({ code: "engine_result_invalid", reason: "invalid_utf8" });
  });
});

describe("input byte bounds (SIZE-S1)", () => {
  const MiB = 1024 * 1024;
  const bigGrant = (target: Harness["target"], jobId: string): ServiceGrant["output"] => ({
    file_id: "file-" + jobId,
    url: target.origin + "/put/" + jobId + "?sig=abc",
    method: "PUT",
    headers: { "content-type": "text/markdown" },
    expires_at: Date.now() + 60_000,
    max_bytes: 200 * MiB,
  });

  it("accepts an input above the old 50 MiB bound and completes end to end", { timeout: 120_000 }, async () => {
    // A document the server now accepts (50 MiB < size <= DOCUMENT_MAX_BYTES)
    // must get past the frame bound and the service gate, and its output must
    // PUT un-truncated past the 64 MiB read buffer. This is the suite's only
    // big end-to-end job (a real worker), so it keeps an explicit timeout
    // above its waitTerminal budget instead of the 30 s default.
    const bytes = Buffer.alloc(50 * MiB + 1, "a");
    const job = makeJob(h.target, { bytes, operation: "serialize", format: "md" });
    job.grant.output = bigGrant(h.target, job.grant.job_id);
    job.token = signGrant(job.grant, GRANT_KEY);
    const res = await submit(h, job);
    expect(res.status).toBe(202);
    const done = await waitTerminal(h, job, 90_000);
    expect(done.body.state).toBe("completed");
    const upload = h.target.uploads.find((u) => u.path.includes(job.grant.job_id));
    expect(upload?.body.length).toBe(bytes.length);
  });

  it("refuses a declared input_length over the document cap with upload_bounds and no job", async () => {
    // The declared length is refused at envelope validation, before a byte of
    // input is streamed: proving it needs the real cap, not 200 MiB on the wire.
    const job = makeJob(h.target, { text: "x" });
    const envelope = {
      ...job.envelope,
      payload: { ...(job.envelope.payload as object), input_length: 200 * MiB + 1 },
    };
    const res = await submit(h, { token: job.token, envelope, bytes: job.bytes });
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe("upload_bounds");
    expect(res.body.error).toMatchObject({ max_input_bytes: 200 * MiB });
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

  it("refuses a frame whose input part is over the configured cap before reading it", async () => {
    // The frame's input length is Content-Length minus the envelope length:
    // over the cap, the 413 goes out before a body byte is read.
    const h2 = await startHarness({ limits: { ...PROVISIONAL_LIMITS, maxInputBytes: 64 * 1024, maxJobMs: 30_000 } });
    try {
      const bytes = Buffer.alloc(64 * 1024 + 1, "a");
      const job = makeJob(h2.target, { bytes, operation: "serialize", format: "md" });
      const { req, reply } = rawFramed(h2, job, { write: 0 });
      const res = await reply;
      req.destroy();
      expect(res.status).toBe(413);
      expect(JSON.parse(res.body).error).toMatchObject({ code: "upload_bounds", max_input_bytes: 64 * 1024 });
      expect(h2.service.jobs.inputBytesAdmitted).toBe(0);
    } finally {
      await h2.close();
    }
  });

  it("refuses an envelope prefix over ENVELOPE_MAX_BYTES", async () => {
    const json = rawSubmit(h, { contentLength: ENVELOPE_MAX_BYTES + 1, contentType: "application/json" });
    const res = await json.reply;
    json.req.destroy();
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).error.code).toBe("upload_bounds");
    const framed = rawSubmit(h, {
      contentLength: ENVELOPE_MAX_BYTES + 2,
      contentType: OFFICE_JOB_CONTENT_TYPE,
      envelopeLength: String(ENVELOPE_MAX_BYTES + 1),
    });
    const res2 = await framed.reply;
    framed.req.destroy();
    expect(res2.status).toBe(400);
    expect(JSON.parse(res2.body).error).toMatchObject({ code: "contract_violation", rule: "framing" });
  });

  it("refuses a negative declared input_length as a contract violation, no job created", async () => {
    // R4-1 pin: -1 is a wire violation (below_min), not a boundary refusal.
    const job = makeJob(h.target, { text: "x" });
    const envelope = { ...job.envelope, payload: { ...(job.envelope.payload as object), input_length: -1 } };
    const res = await submit(h, { token: job.token, envelope, bytes: job.bytes });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("contract_violation");
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

  it("refuses an unsafe declared input_length as a contract violation, no job created", async () => {
    // R4-1 pin: Number.MAX_SAFE_INTEGER + 1 reads as over-ceiling unless the
    // safe-integer check answers first with a wire violation.
    const job = makeJob(h.target, { text: "x" });
    const envelope = {
      ...job.envelope,
      payload: { ...(job.envelope.payload as object), input_length: Number.MAX_SAFE_INTEGER + 1 },
    };
    const res = await submit(h, { token: job.token, envelope, bytes: job.bytes });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("contract_violation");
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });
});

interface RawReply {
  status: number;
  retryAfter: string | undefined;
  body: string;
}
interface RawSubmit {
  req: ClientRequest;
  reply: Promise<RawReply>;
}

/** A submit over a raw request: headers leave at once, the body is whatever
    the test chooses to write (including nothing at all). */
function rawSubmit(
  target: Harness,
  opts: { contentLength?: number; chunked?: boolean; grant?: string; contentType?: string; envelopeLength?: string } = {},
): RawSubmit {
  const headers: Record<string, string | number> = {
    authorization: "Bearer " + SERVICE_TOKEN,
    "content-type": opts.contentType ?? OFFICE_JOB_CONTENT_TYPE,
  };
  if (opts.envelopeLength !== undefined) headers["x-office-envelope-length"] = opts.envelopeLength;
  if (opts.chunked) headers["transfer-encoding"] = "chunked";
  else headers["content-length"] = opts.contentLength ?? 0;
  if (opts.grant) headers["x-office-grant"] = opts.grant;
  // Executor form: the tsconfig lib predates Promise.withResolvers.
  let resolveReply!: (r: RawReply) => void;
  const reply = new Promise<RawReply>((resolve) => (resolveReply = resolve));
  const req = request(target.base + "/v1/jobs", { method: "POST", headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () =>
      resolveReply({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string | undefined, body: Buffer.concat(chunks).toString("utf8") }),
    );
  });
  req.on("error", () => resolveReply({ status: 0, retryAfter: undefined, body: "" }));
  req.flushHeaders();
  return { req, reply };
}

/** A framed submit that writes only the first `write` bytes of its frame
    (all of it when omitted) and leaves the request open. */
function rawFramed(target: Harness, job: Job, opts: { write?: number; chunked?: boolean } = {}): RawSubmit & { body: Buffer } {
  const framed = frame(job.envelope, job.bytes);
  const raw = rawSubmit(target, {
    ...(opts.chunked ? { chunked: true } : { contentLength: framed.body.length }),
    grant: job.token,
    envelopeLength: framed.headers["x-office-envelope-length"],
  });
  const write = opts.write ?? framed.body.length;
  if (write > 0) raw.req.write(framed.body.subarray(0, write));
  return { ...raw, body: framed.body };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in " + timeoutMs + " ms");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("framed job transport (SIZE-OPS1)", () => {
  const MiB = 1024 * 1024;

  it("streams a 400 MiB framed input to the job dir with the right digest and a flat heap", { timeout: 240_000 }, async () => {
    const size = 400 * MiB;
    const h2 = await startHarness({ maxWorkers: 1, limits: { ...PROVISIONAL_LIMITS, maxInputBytes: 512 * MiB, maxJobMs: 30_000 } });
    // A generated stream, never a fixture: a sleeper line, then filler. The
    // filler chunk is one shared buffer, so the client side holds no copies.
    const head = Buffer.from("uniwork-fault:sleep 60000\n");
    const filler = Buffer.alloc(MiB, "a");
    function* chunks(): Generator<Buffer> {
      yield head;
      let left = size - head.length;
      while (left > 0) {
        const n = Math.min(left, filler.length);
        yield n === filler.length ? filler : filler.subarray(0, n);
        left -= n;
      }
    }
    const hasher = createHash("sha256");
    for (const c of chunks()) hasher.update(c);
    const checksum = hasher.digest("hex");
    const job = makeJob(h2.target, { text: "", grant: { input: { checksum, length: size } } });
    (job.envelope.payload as Record<string, unknown>).input_checksum = checksum;
    (job.envelope.payload as Record<string, unknown>).input_length = size;
    // Hash the input file at the job hand-off: the job holds a path, so the
    // file must be complete and right before the job exists.
    const jobs = h2.service.jobs;
    const orig = jobs.submit.bind(jobs);
    let onDisk: string | undefined;
    jobs.submit = (async (jobReq: Parameters<typeof orig>[0]) => {
      const dir = (jobReq as { inputDir?: string | null }).inputDir;
      if (dir) {
        const fileHash = createHash("sha256");
        for await (const c of createReadStream(join(dir, "input.bin"))) fileHash.update(c as Buffer);
        onDisk = fileHash.digest("hex");
      }
      return orig(jobReq);
    }) as unknown as typeof orig;
    try {
      const envelope = Buffer.from(JSON.stringify(job.envelope), "utf8");
      global.gc?.();
      const mem = () => {
        const m = process.memoryUsage();
        return m.heapUsed + m.arrayBuffers;
      };
      const before = mem();
      let peak = before;
      const sampler = setInterval(() => (peak = Math.max(peak, mem())), 10);
      const raw = rawSubmit(h2, {
        contentLength: envelope.length + size,
        grant: job.token,
        envelopeLength: String(envelope.length),
      });
      await pipeline(
        Readable.from(
          (function* () {
            yield envelope;
            yield* chunks();
          })(),
        ),
        raw.req,
      );
      const res = await raw.reply;
      clearInterval(sampler);
      expect(res.status, res.body).toBe(202);
      expect(onDisk).toBe(checksum);
      expect(peak - before).toBeLessThan(64 * MiB);
      await call(h2, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
      await waitTerminal(h2, job);
      await until(async () => jobs.inputBytesAdmitted === 0 && (await jobDirs(h2.tempRoot)).length === 0);
    } finally {
      jobs.submit = orig;
      await h2.close();
    }
  });

  it("refuses a wrong digest, a short frame and a long frame: no input file, budget back to 0", async () => {
    const bytes = Buffer.from("framed input bytes");
    const other = Buffer.from("framed input BYTES");
    const wrongDigest = makeJob(h.target, { bytes });
    const lie = await submit(h, { ...wrongDigest, bytes: other });
    expect([lie.status, errorCode(lie)]).toEqual([409, "upload_checksum_mismatch"]);

    const short = makeJob(h.target, { bytes });
    const shortRes = await submit(h, { ...short, bytes: bytes.subarray(0, bytes.length - 1) });
    expect(shortRes.status).toBe(400);
    expect(shortRes.body.error).toMatchObject({ code: "contract_violation", rule: "framing" });

    const long = makeJob(h.target, { bytes });
    const longRes = await submit(h, { ...long, bytes: Buffer.concat([bytes, Buffer.from("+")]) });
    expect(longRes.status).toBe(400);
    expect(longRes.body.error).toMatchObject({ code: "contract_violation", rule: "framing" });

    for (const job of [wrongDigest, short, long]) {
      expect((await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token })).status).toBe(404);
    }
    expect(h.service.jobs.inputBytesAdmitted).toBe(0);
    expect(await jobDirs(h.tempRoot)).toEqual([]);
  });

  it("budget: with room for one input, a second concurrent submit gets 503 input_budget before its body is read", async () => {
    const bytes = Buffer.alloc(4096, "b");
    const h2 = await startHarness({ inputBudgetBytes: bytes.length + 1024 });
    try {
      const first = makeJob(h2.target, { bytes });
      const held = rawFramed(h2, first, { write: 0 });
      const envelopeLength = held.body.length - bytes.length;
      // Before a byte is read, the reservation holds envelope + input.
      await until(() => h2.service.jobs.inputBytesAdmitted === held.body.length, 2_000);
      const second = makeJob(h2.target, { bytes });
      const refused = rawFramed(h2, second, { write: 0 });
      const res = await refused.reply;
      refused.req.destroy();
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body).error).toMatchObject({ code: "engine_overloaded", reason: "input_budget" });
      expect(res.retryAfter).toBe("2");
      // While the input is withheld after the envelope is parsed, the full frame reservation stays held.
      held.req.write(held.body.subarray(0, envelopeLength));
      await until(async () => (await jobDirs(h2.tempRoot)).length === 1, 2_000);
      expect(h2.service.jobs.inputBytesAdmitted).toBe(held.body.length);
      held.req.end(held.body.subarray(envelopeLength));
      expect((await held.reply).status).toBe(202);
      await waitTerminal(h2, first);
      await until(() => h2.service.jobs.inputBytesAdmitted === 0);
      // Once the first job's input is gone, the budget admits the next one.
      const third = makeJob(h2.target, { bytes });
      expect((await submit(h2, third)).status).toBe(202);
      await waitTerminal(h2, third);
    } finally {
      await h2.close();
    }
  });

  it("charges declared envelope length into the admission budget for 0/1-byte framed and plain-JSON submits (SIZE-OPS1 E1)", async () => {
    const h2 = await startHarness({ maxWorkers: 2, inputBudgetBytes: 2 * ENVELOPE_MAX_BYTES + 2 });
    const jobs = h2.service.jobs;
    const origReserve = jobs.reserveInput.bind(jobs);
    let reserveCalls = 0;
    jobs.reserveInput = (bytes: number) => {
      reserveCalls++;
      return origReserve(bytes);
    };
    const candidates: RawSubmit[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const inputByte = i % 2;
        candidates.push(
          rawSubmit(h2, {
            contentLength: ENVELOPE_MAX_BYTES + inputByte,
            contentType: OFFICE_JOB_CONTENT_TYPE,
            envelopeLength: String(ENVELOPE_MAX_BYTES),
          }),
        );
      }
      const settled: RawReply[] = [];
      for (const c of candidates) void c.reply.then((r) => settled.push(r));
      await until(() => reserveCalls === 8, 2_000);
      expect(jobs.inputBytesAdmitted).toBeGreaterThanOrEqual(2 * ENVELOPE_MAX_BYTES);
      expect(jobs.inputBytesAdmitted).toBeLessThanOrEqual(h2.config.inputBudgetBytes);
      await until(() => settled.length === 6, 2_000);
      for (const res of settled) {
        expect(res.status).toBe(503);
        expect(JSON.parse(res.body).error).toMatchObject({ code: "engine_overloaded", reason: "input_budget" });
        expect(res.retryAfter).toBe("2");
      }
      // Plain-JSON (no-input) submits are charged their Content-Length into the same budget.
      const plainRefused = rawSubmit(h2, { contentLength: ENVELOPE_MAX_BYTES, contentType: "application/json" });
      const plainRes = await plainRefused.reply;
      plainRefused.req.destroy();
      expect(plainRes.status).toBe(503);
      expect(JSON.parse(plainRes.body).error).toMatchObject({ code: "engine_overloaded", reason: "input_budget" });
      // Aborting one held envelope frees its reservation so the next submit is admitted.
      for (const c of candidates) c.req.destroy();
      await until(() => jobs.inputBytesAdmitted === 0, 2_000);
      const ok = makeJob(h2.target, { text: "after-envelope-release" });
      expect((await submit(h2, ok)).status).toBe(202);
      await waitTerminal(h2, ok);
      await until(() => jobs.inputBytesAdmitted === 0, 2_000);
    } finally {
      for (const c of candidates) c.req.destroy();
      await h2.close();
    }
  });

  it("keeps the envelope share of the admission budget while the input is withheld, then releases it on abort or hand-off (SIZE-OPS1 r3)", async () => {
    const smallInput = Buffer.from("small-in");
    const largeEditPayload = { edits: [{ op: "insert_text", text: "e".repeat(256 * 1024) }] };
    const sample = makeJob(h.target, { operation: "edit", format: "pdf", bytes: smallInput, payload: largeEditPayload });
    const sampleFrame = frame(sample.envelope, sample.bytes);
    const envelopeLength = Number(sampleFrame.headers["x-office-envelope-length"]);
    // Budget fits one large edit envelope + small input (plus a tiny sleeper), not a second large edit envelope.
    const h2 = await startHarness({ maxWorkers: 1, inputBudgetBytes: sampleFrame.body.length + 1024 });
    try {
      const first = makeJob(h2.target, { operation: "edit", format: "pdf", bytes: smallInput, payload: largeEditPayload });
      const held = rawFramed(h2, first, { write: envelopeLength });
      // Once the job dir exists, JSON.parse, validateEnvelope and bindEnvelope have finished and writeInput is waiting for smallInput.
      await until(async () => (await jobDirs(h2.tempRoot)).length === 1, 2_000);
      expect(h2.service.jobs.inputBytesAdmitted).toBe(held.body.length);

      const second = makeJob(h2.target, { operation: "edit", format: "pdf", bytes: smallInput, payload: largeEditPayload });
      const refused = rawFramed(h2, second, { write: 0 });
      const res = await refused.reply;
      refused.req.destroy();
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body).error).toMatchObject({ code: "engine_overloaded", reason: "input_budget" });
      expect(res.retryAfter).toBe("2");

      // Aborting the stalled upload releases both envelope and input shares back to 0.
      held.req.destroy();
      await until(async () => h2.service.jobs.inputBytesAdmitted === 0 && (await jobDirs(h2.tempRoot)).length === 0, 2_000);

      // Finishing a stalled upload hands off to the job and drops the reservation to the job's input share alone.
      const blocker = makeJob(h2.target, { text: "uniwork-fault:sleep 30000\n" });
      expect((await submit(h2, blocker)).status).toBe(202);
      const third = makeJob(h2.target, { operation: "edit", format: "pdf", bytes: smallInput, payload: largeEditPayload });
      const heldThird = rawFramed(h2, third, { write: envelopeLength });
      await until(async () => (await jobDirs(h2.tempRoot)).length === 2, 2_000);
      expect(h2.service.jobs.inputBytesAdmitted).toBe(blocker.bytes.length + heldThird.body.length);
      heldThird.req.end(heldThird.body.subarray(envelopeLength));
      expect((await heldThird.reply).status).toBe(202);
      expect(h2.service.jobs.inputBytesAdmitted).toBe(blocker.bytes.length + third.bytes.length);

      await call(h2, "POST", "/v1/jobs/" + third.grant.job_id + "/cancel", { grant: third.token });
      await call(h2, "POST", "/v1/jobs/" + blocker.grant.job_id + "/cancel", { grant: blocker.token });
      await waitTerminal(h2, blocker);
      await until(async () => h2.service.jobs.inputBytesAdmitted === 0 && (await jobDirs(h2.tempRoot)).length === 0, 2_000);
    } finally {
      await h2.close();
    }
  });

  it("replays the same framed job: 200 replay, the body drained, one input file", async () => {
    const bytes = Buffer.from("uniwork-fault:sleep 30000\n");
    const job = makeJob(h.target, { bytes });
    expect((await submit(h, job)).status).toBe(202);
    const again = await submit(h, job);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ job_id: job.grant.job_id, replay: true });
    expect(await jobDirs(h.tempRoot)).toHaveLength(1);
    expect(h.service.jobs.inputBytesAdmitted).toBe(bytes.length);
    await call(h, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
    await waitTerminal(h, job);
    await until(async () => h.service.jobs.inputBytesAdmitted === 0 && (await jobDirs(h.tempRoot)).length === 0);
  });

  it("a cancelled queued job gives its input file and budget back", async () => {
    const h2 = await startHarness({ maxWorkers: 1 });
    try {
      const running = makeJob(h2.target, { text: "uniwork-fault:sleep 30000\n" });
      const queued = makeJob(h2.target, { text: "queued input" });
      expect((await submit(h2, running)).status).toBe(202);
      expect((await submit(h2, queued)).status).toBe(202);
      expect(await jobDirs(h2.tempRoot)).toHaveLength(2);
      await call(h2, "POST", "/v1/jobs/" + queued.grant.job_id + "/cancel", { grant: queued.token });
      await until(async () => h2.service.jobs.inputBytesAdmitted === running.bytes.length && (await jobDirs(h2.tempRoot)).length === 1);
      await call(h2, "POST", "/v1/jobs/" + running.grant.job_id + "/cancel", { grant: running.token });
      await waitTerminal(h2, running);
      await until(() => h2.service.jobs.inputBytesAdmitted === 0);
    } finally {
      await h2.close();
    }
  });

  it("retains inputDir and budget reservation when job dir removal fails on queued cancel (SIZE-OPS1 E2)", async () => {
    const h2 = await startHarness({ maxWorkers: 1, inputBudgetBytes: 64 * 1024 });
    let queuedDir: string | null = null;
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      const running = makeJob(h2.target, { text: "uniwork-fault:sleep 30000\n" });
      const queued = makeJob(h2.target, { bytes: Buffer.alloc(32 * 1024, "q") });
      expect((await submit(h2, running)).status).toBe(202);
      expect((await submit(h2, queued)).status).toBe(202);
      const queuedJob = h2.service.jobs.get(queued.grant.job_id)!;
      queuedDir = queuedJob.inputDir;
      expect(queuedDir).toBeTruthy();
      await chmod(queuedDir!, 0o500);
      await call(h2, "POST", "/v1/jobs/" + queued.grant.job_id + "/cancel", { grant: queued.token });
      await until(() => stderrLines.length > 0 || h2.service.jobs.inputBytesAdmitted === running.bytes.length, 2_000);
      expect((await stat(join(queuedDir!, "input.bin"))).size).toBe(queued.bytes.length);
      expect(h2.service.jobs.inputBytesAdmitted).toBe(running.bytes.length + queued.bytes.length);
      expect(queuedJob.inputDir).toBe(queuedDir);
      expect(stderrLines.join("")).toContain(queued.grant.job_id);
      expect(stderrLines.join("")).not.toContain(queuedDir!);
      const next = makeJob(h2.target, { bytes: Buffer.alloc(32 * 1024, "n") });
      const refused = rawFramed(h2, next, { write: 0 });
      const res = await refused.reply;
      refused.req.destroy();
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body).error).toMatchObject({ code: "engine_overloaded", reason: "input_budget" });
      await call(h2, "POST", "/v1/jobs/" + running.grant.job_id + "/cancel", { grant: running.token });
      await waitTerminal(h2, running);
    } finally {
      process.stderr.write = origWrite;
      if (queuedDir) await chmod(queuedDir, 0o700).catch(() => undefined);
      await h2.close();
    }
  });

  it("refuses input_bytes inside an envelope and a mismatched protocol_version", async () => {
    const job = makeJob(h.target, { text: "p" });
    const smuggled = {
      ...job.envelope,
      payload: { ...(job.envelope.payload as object), input_bytes: job.bytes.toString("base64") },
    };
    const res = await submit(h, { token: job.token, envelope: smuggled, bytes: job.bytes });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "contract_violation", field_path: "envelope.payload.input_bytes", rule: "unknown_field" });
    const wrongProtocol = await submit(h, { token: job.token, envelope: { ...job.envelope, protocol_version: 2 }, bytes: job.bytes });
    expect(wrongProtocol.status).toBe(400);
    expect(wrongProtocol.body.error).toMatchObject({ code: "contract_violation", field_path: "envelope.protocol_version", rule: "must_equal" });
    expect(h.service.jobs.inputBytesAdmitted).toBe(0);
  });

  it("a client abort mid-body leaves no job, no file and no budget", async () => {
    const bytes = Buffer.alloc(256 * 1024, "c");
    const job = makeJob(h.target, { bytes });
    const framed = frame(job.envelope, bytes);
    const envelopeLength = Number(framed.headers["x-office-envelope-length"]);
    const half = rawFramed(h, job, { write: envelopeLength + bytes.length / 2 });
    // The envelope passed every check once the input file exists.
    await until(async () => (await jobDirs(h.tempRoot)).length === 1);
    half.req.destroy();
    await until(async () => h.service.jobs.inputBytesAdmitted === 0 && (await jobDirs(h.tempRoot)).length === 0);
    expect((await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token })).status).toBe(404);
  });

  it("refuses an input-bearing envelope sent as plain JSON with 415, and a chunked frame as framing", async () => {
    const job = makeJob(h.target, { text: "json" });
    const json = await call(h, "POST", "/v1/jobs", { grant: job.token, body: job.envelope });
    expect(json.status).toBe(415);
    expect(json.body.error).toMatchObject({ code: "contract_violation", rule: "content_type" });
    const chunked = rawFramed(h, job, { chunked: true, write: 0 });
    const res = await chunked.reply;
    chunked.req.destroy();
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatchObject({ code: "contract_violation", rule: "framing" });
    expect(h.service.jobs.inputBytesAdmitted).toBe(0);
  });

  it("refuses a signed frame sent as application/octet-stream with 415 content_type before parsing (SIZE-OPS1 E3)", async () => {
    const job = makeJob(h.target, { text: "octet-stream-frame" });
    const framed = frame(job.envelope, job.bytes);
    const res = await call(h, "POST", "/v1/jobs", {
      grant: job.token,
      rawBody: framed.body,
      headers: { ...framed.headers, "content-type": "application/octet-stream" },
    });
    expect(res.status).toBe(415);
    expect(res.body.error).toMatchObject({ code: "contract_violation", field_path: "request.content_type", rule: "content_type" });
    expect(h.service.jobs.inputBytesAdmitted).toBe(0);
  });

  it("still accepts a chunked plain-JSON submit for a job without input", async () => {
    const j = makeJob(h.target, { text: "", grant: { input: null } });
    const payload = j.envelope.payload as Record<string, unknown>;
    delete payload.input_checksum;
    delete payload.input_length;
    const body = JSON.stringify(j.envelope);
    const { req, reply } = rawSubmit(h, { chunked: true, grant: j.token, contentType: "application/json" });
    req.write(body.slice(0, 16));
    req.end(body.slice(16));
    expect((await reply).status).toBe(202);
    await waitTerminal(h, j);
  });
});

describe("grant refusal", () => {
  it("refuses a missing, forged or wrongly keyed grant", async () => {
    const job = makeJob(h.target, { text: "g" });
    const missing = await call(h, "POST", "/v1/jobs", { body: job.envelope });
    expect([missing.status, errorCode(missing), errorReason(missing)]).toEqual([403, "grant_scope", "missing"]);
    const [body] = job.token.split(".");
    const forged = await call(h, "POST", "/v1/jobs", { grant: body + ".AAAA", body: job.envelope });
    expect([forged.status, errorReason(forged)]).toEqual([403, "signature"]);
    const serviceKeyed = await call(h, "POST", "/v1/jobs", { grant: signGrant(job.grant, SERVICE_TOKEN), body: job.envelope });
    expect(errorReason(serviceKeyed)).toBe("signature");
  });

  it("refuses an expired grant and one past its deadline", async () => {
    const past = Date.now() - 1;
    for (const [field, reason] of [["expires_at", "expires_at"], ["deadline_at", "deadline_at"]] as const) {
      const job = makeJob(h.target, { text: "late", grant: { [field]: past } });
      const res = await submit(h, job);
      expect(res.status).toBe(401);
      expect([errorCode(res), errorReason(res)]).toEqual(["grant_expired", reason]);
    }
  });

  it("refuses a grant whose bindings do not match the envelope", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ grant: { operation: "open" } }, "operation"],
      [{ grant: { format: "html" } }, "format"],
      [{ payload: { base_revision: 9 } }, "base_revision"],
      [{ payload: { base_version_id: "ver-other" } }, "base_version_id"],
      [{ grant: { input: { checksum: "0".repeat(64), length: 4 } } }, "input"],
      [{ envelope: { grant_id: "another-grant" } }, "grant_id"],
      [{ envelope: { grant_id: undefined } }, "grant_id"],
    ];
    for (const [spec, reason] of cases) {
      const job = makeJob(h.target, { text: "bind", ...spec });
      const res = await submit(h, job);
      expect(res.status, reason).toBe(403);
      expect([errorCode(res), errorReason(res)]).toEqual(["grant_scope", reason]);
    }
  });

  it("refuses an output target outside the configured storage origin", async () => {
    const job = makeJob(h.target, { text: "o" });
    const grant = { ...job.grant, output: { ...job.grant.output!, url: "http://169.254.169.254/latest/meta-data" } };
    const res = await submit(h, { token: signGrant(grant, GRANT_KEY), envelope: job.envelope });
    expect([res.status, errorReason(res)]).toEqual([403, "output_origin"]);
  });

  it("refuses to read a job with another job's grant", async () => {
    const a = makeJob(h.target, { text: "a" });
    await submit(h, a);
    const b = makeGrant(h.target, { job_id: a.grant.job_id });
    const res = await call(h, "GET", "/v1/jobs/" + a.grant.job_id, { grant: signGrant(b, GRANT_KEY) });
    expect([res.status, errorReason(res)]).toEqual([403, "grant_id"]);
    const other = makeGrant(h.target);
    const wrongId = await call(h, "GET", "/v1/jobs/" + a.grant.job_id, { grant: signGrant(other, GRANT_KEY) });
    expect([wrongId.status, errorReason(wrongId)]).toEqual([403, "job_id"]);
    await waitTerminal(h, a);
  });

  it("answers not_found for a job this process does not know", async () => {
    const g = makeGrant(h.target);
    const res = await call(h, "GET", "/v1/jobs/" + g.job_id, { grant: signGrant(g, GRANT_KEY) });
    expect([res.status, errorCode(res)]).toEqual([404, "not_found"]);
  });
});

describe("request shape", () => {
  it("never accepts a caller-named URL, path or storage key as input", async () => {
    for (const extra of [{ input_url: "http://evil/x" }, { source_object_key: "org/doc" }, { input_path: "/etc/passwd" }]) {
      const job = makeJob(h.target, { text: "k", payload: extra });
      const res = await submit(h, job);
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(errorCode(res)).toBe("contract_violation");
    }
    const job = makeJob(h.target, { text: "k", envelope: { output_key: "x" } });
    expect((await submit(h, job)).status).toBe(400);
  });

  it("refuses a non-JSON body and an unknown route", async () => {
    const job = makeJob(h.target, { text: "j" });
    const res = await call(h, "POST", "/v1/jobs", { grant: job.token, rawBody: "{nope" });
    expect([res.status, errorCode(res)]).toEqual([400, "contract_violation"]);
    expect((await call(h, "GET", "/v1/nothing")).status).toBe(404);
  });
});

describe("connection lifetime (SIZE-S1 fix5)", () => {
  it("never initiates an idle close: keepAliveTimeout is disabled", () => {
    // Node's default 5s keep-alive expiry destroys a socket that can already
    // carry a pipelined request the event loop has not read yet — the close
    // arrives at the client as ECONNRESET mid-upload (observed in CI on a
    // loaded VM where the 280 MiB envelope stalled the shared loop past the
    // deadline). Idle reaping belongs to the client; the server's only job is
    // to never reset a connection it has not finished reading.
    expect(h.service.server.keepAliveTimeout).toBe(0);
  });
});

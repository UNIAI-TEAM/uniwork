import { readFileSync } from "node:fs";
import { once } from "node:events";
import { request, type ClientRequest } from "node:http";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROVISIONAL_LIMITS } from "../src/index.ts";
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import { signGrant, type ServiceGrant } from "../src/grants.ts";
import {
  call,
  errorCode,
  errorReason,
  GRANT_KEY,
  makeGrant,
  makeJob,
  sha256,
  SERVICE_TOKEN,
  startHarness,
  submit,
  waitTerminal,
  type Harness,
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
        input_bytes: undefined,
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
      payload: { ...(job.envelope.payload as object), input_bytes: bad.toString("base64"), input_checksum: sha256(bad), input_length: 3 },
    };
    await submit(h, { token, envelope });
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

  it("accepts an input above the old 50 MiB bound and completes end to end", async () => {
    // A document the server now accepts (50 MiB < size <= DOCUMENT_MAX_BYTES)
    // must get past the body cap, the envelope bound and the service gate,
    // and its output must PUT un-truncated past the 64 MiB read buffer.
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

  it("refuses an input over the document cap with upload_bounds and no job", async () => {
    const bytes = Buffer.alloc(200 * MiB + 1, "a");
    const job = makeJob(h.target, { bytes, operation: "serialize", format: "md" });
    job.grant.output = bigGrant(h.target, job.grant.job_id);
    job.token = signGrant(job.grant, GRANT_KEY);
    const res = await submit(h, job);
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe("upload_bounds");
    const err = res.body.error;
    const maxBytes = err !== null && typeof err === "object" && "max_input_bytes" in err ? err.max_input_bytes : undefined;
    expect(maxBytes).toBe(200 * MiB);
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

  it("refuses a body over the base64 envelope cap before buffering it", async () => {
    // The envelope cap is ceil(input cap * 4/3) + 64 KiB: a body past it can
    // only fail as upload_bounds, whatever it would have parsed to.
    const bodyLimit = Math.ceil(((200 * MiB) * 4) / 3) + 64 * 1024;
    const res = await call(h, "POST", "/v1/jobs", { rawBody: "x".repeat(bodyLimit + 1) });
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe("upload_bounds");
  });

  it("refuses a declared input_length over the transport ceiling with the typed 413, no job created", async () => {
    // size-cap:005: a body under the wire cap but declaring more than the
    // 383 MiB engine ceiling gets upload_bounds, not contract_violation.
    const job = makeJob(h.target, { text: "x" });
    const envelope = {
      ...job.envelope,
      payload: {
        ...(job.envelope.payload as object),
        input_bytes: Buffer.from("x").toString("base64"),
        input_length: ENGINE_LIMITS.max_input_bytes + 1,
      },
    };
    const res = await submit(h, { token: job.token, envelope });
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe("upload_bounds");
    const err = res.body.error;
    const maxBytes = err !== null && typeof err === "object" && "max_input_bytes" in err ? err.max_input_bytes : undefined;
    expect(maxBytes).toBe(ENGINE_LIMITS.max_input_bytes);
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

  it("lets a declared input_length at exactly the ceiling reach the checksum check - 409, never upload_bounds", async () => {
    // R4-1 pin (size-cap:005): the comparison is strict, so declaring the
    // 383 MiB ceiling itself is NOT a 413 - the one-byte real payload then
    // fails as upload_checksum_mismatch, and no job exists.
    const job = makeJob(h.target, { text: "x" });
    const envelope = {
      ...job.envelope,
      payload: {
        ...(job.envelope.payload as object),
        input_bytes: Buffer.from("x").toString("base64"),
        input_length: ENGINE_LIMITS.max_input_bytes,
      },
    };
    const res = await submit(h, { token: job.token, envelope });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe("upload_checksum_mismatch");
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

  it("refuses a negative declared input_length as a contract violation, no job created", async () => {
    // R4-1 pin: -1 is a wire violation (below_min), not a boundary refusal.
    const job = makeJob(h.target, { text: "x" });
    const envelope = {
      ...job.envelope,
      payload: {
        ...(job.envelope.payload as object),
        input_bytes: Buffer.from("x").toString("base64"),
        input_length: -1,
      },
    };
    const res = await submit(h, { token: job.token, envelope });
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
      payload: {
        ...(job.envelope.payload as object),
        input_bytes: Buffer.from("x").toString("base64"),
        input_length: Number.MAX_SAFE_INTEGER + 1,
      },
    };
    const res = await submit(h, { token: job.token, envelope });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("contract_violation");
    const status = await call(h, "GET", "/v1/jobs/" + job.grant.job_id, { grant: job.token });
    expect(status.status).toBe(404);
  });

});

describe("submit body memory bound (SIZE-S1 fix3)", () => {
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
    opts: { contentLength?: number; chunked?: boolean; grant?: string } = {},
  ): RawSubmit {
    const headers: Record<string, string | number> = {
      authorization: "Bearer " + SERVICE_TOKEN,
      "content-type": "application/json",
    };
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

  it("refuses a declared over-cap body without ever reading the request stream", async () => {
    const bodyLimit = Math.ceil(((200 * 1024 * 1024) * 4) / 3) + 64 * 1024;
    const { reply } = rawSubmit(h, { contentLength: bodyLimit + 1 });
    const res = await reply;
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).error.code).toBe("upload_bounds");
  });

  it("refuses a chunked body over the cap with 413 and destroys the request", async () => {
    const h2 = await startHarness({ limits: { ...PROVISIONAL_LIMITS, maxInputBytes: 64 * 1024, maxJobMs: 30_000 } });
    try {
      const { req, reply } = rawSubmit(h2, { chunked: true });
      const sock = (await once(req, "socket"))[0] as Socket;
      const closed = once(sock, "close");
      // Push well past the 152 KiB body cap; a socket the server tore down
      // stops the loop, and a destroyed request may throw on write.
      const chunk = Buffer.alloc(64 * 1024, "x");
      for (let i = 0; i < 12 && !sock.destroyed; i++) {
        try {
          req.write(chunk);
        } catch {
          break;
        }
      }
      const res = await reply;
      expect(res.status).toBe(413);
      expect(JSON.parse(res.body).error.code).toBe("upload_bounds");
      await closed;
    } finally {
      await h2.close();
    }
  });

  it("holds at most maxWorkers submit bodies: the next answers 503 + Retry-After before reading it, then frees", async () => {
    const h2 = await startHarness({ limits: { ...PROVISIONAL_LIMITS, maxInputBytes: 64 * 1024, maxJobMs: 30_000 } });
    try {
      const jobFor = () => {
        const j = makeJob(h2.target, { text: "held" });
        return { j, body: JSON.stringify(j.envelope) };
      };
      // Three slow writers race two body slots. Each sends headers only: the
      // refusal must arrive before a single body byte is read, so the refused
      // writer is the first to settle — no timer needed.
      const candidates = [jobFor(), jobFor(), jobFor()].map((made) => ({
        job: made.j,
        body: made.body,
        ...rawSubmit(h2, { contentLength: made.body.length, grant: made.j.token }),
        res: undefined as RawReply | undefined,
      }));
      for (const c of candidates) void c.reply.then((r) => (c.res = r));
      const refused = await Promise.any(candidates.map((c) => c.reply));
      expect(refused.status).toBe(503);
      expect(JSON.parse(refused.body).error.code).toBe("engine_overloaded");
      const retryAfter = Number(refused.retryAfter);
      expect(Number.isFinite(retryAfter) && retryAfter >= 1 && retryAfter <= 5).toBe(true);
      const metrics = await (await fetch(h2.base + "/metrics", { headers: { authorization: "Bearer " + SERVICE_TOKEN } })).text();
      expect(metrics).toContain('office_engine_rejections_total{code="engine_overloaded"} 1');
      const held = candidates.filter((c) => c.res === undefined);
      expect(held).toHaveLength(2);
      // Freeing one slot admits the next submit.
      held[0]!.req.end(held[0]!.body);
      expect((await held[0]!.reply).status).toBe(202);
      const c = jobFor();
      expect((await submit(h2, c.j)).status).toBe(202);
      held[1]!.req.end(held[1]!.body);
      expect((await held[1]!.reply).status).toBe(202);
      await waitTerminal(h2, held[0]!.job);
      await waitTerminal(h2, c.j);
    } finally {
      await h2.close();
    }
  });

  it("keeps the body slot until the job hand-off: a submit parked in post-parse processing still refuses the next", async () => {
    const h2 = await startHarness({ maxWorkers: 1, limits: { ...PROVISIONAL_LIMITS, maxInputBytes: 64 * 1024, maxJobMs: 30_000 } });
    const jobFor = () => {
      const j = makeJob(h2.target, { text: "held" });
      return { j, body: JSON.stringify(j.envelope) };
    };
    const jobs = h2.service.jobs;
    const orig = jobs.submit.bind(jobs);
    // Executor form: the tsconfig lib predates Promise.withResolvers.
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => (enteredResolve = r));
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    // Park the first request at the hand-off point: everything after the body
    // is parsed (grant, envelope validation + decode, fingerprint) sits inside
    // it, so a held slot here proves the window is covered end to end.
    let parked = false;
    jobs.submit = ((jobReq: Parameters<typeof orig>[0]) => {
      if (parked) return orig(jobReq);
      parked = true;
      enteredResolve();
      return gate.then(() => orig(jobReq));
    }) as typeof orig;
    try {
      const a = jobFor();
      const first = rawSubmit(h2, { contentLength: a.body.length, grant: a.j.token });
      first.req.end(a.body);
      await entered;
      // The first submit is still processing its decoded input: a second
      // submit must be refused at the gate, never reaching the body read.
      const b = jobFor();
      const second = rawSubmit(h2, { contentLength: b.body.length, grant: b.j.token });
      second.req.end(b.body);
      const res = await second.reply;
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body).error.code).toBe("engine_overloaded");
      releaseGate();
      expect((await first.reply).status).toBe(202);
      await waitTerminal(h2, a.j);
    } finally {
      jobs.submit = orig;
      releaseGate();
      await h2.close();
    }
  });

  it("still accepts a chunked submit whose body parses", async () => {
    const j = makeJob(h.target, { text: "chunked-ok" });
    const body = JSON.stringify(j.envelope);
    const { req, reply } = rawSubmit(h, { chunked: true, grant: j.token });
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

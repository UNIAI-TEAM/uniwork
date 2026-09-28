import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signGrant } from "./grants.ts";
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
    expect((await call(h, "GET", "/v1/capability?format=exe")).status).toBe(400);
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

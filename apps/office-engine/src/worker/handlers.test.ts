// In-process unit tests for the handler table and the fault operations that
// are safe to run inside the test process. The service tests already run
// both through real worker processes; these pin the pieces directly.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOUND_OPERATIONS, findHandler } from "./handlers.ts";
import { fileURLToPath } from "node:url";
import { PROVISIONAL_LIMITS } from "../config.ts";
import { bindEnvelope, type ServiceGrant } from "../grants.ts";
import { JobManager, jobView } from "../jobs.ts";
import { Metrics } from "../metrics.ts";
import { FAULT_PREFIX, runFault } from "./faults.ts";
import type { RunMessage } from "./protocol.ts";

// The open:xlsx bound is about the encoded model, not the workbook: stub the
// engine so the test needs neither the staged gateway nor a 16 MiB fixture.
const modelSize = vi.hoisted(() => ({ bytes: 0 }));
vi.mock("@uniwork/office-engine/xlsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/office-engine/xlsx")>()),
  bindXlsxGateway: () => ({}),
  openXlsxModel: async () => ({ probe: {}, snapshot: {}, renderModel: "x".repeat(modelSize.bytes) }),
}));

let dir: string;
let message: RunMessage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "uw-office-handler-"));
  message = {
    type: "run",
    operation: "serialize",
    format: "md",
    inputPath: join(dir, "input.bin"),
    outputPath: join(dir, "output.bin"),
    payloadPath: null,
    tempDir: dir,
    sampleMs: 50,
    heapMb: 64,
    faults: true,
  };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("handler table", () => {
  it("binds md/html serialize, the pdf + xlsx open/serialize/edit lanes, the Q7 converters, the docx PDF export, the page export and the extract_text readers", () => {
    expect([...BOUND_OPERATIONS].sort()).toEqual([
      "convert:odt",
      "convert:xls",
      "edit:pdf",
      "edit:xlsx",
      "export:docx",
      "export:page",
      "extract_text:docx",
      "extract_text:pptx",
      "extract_text:xlsx",
      "open:pdf",
      "open:xlsx",
      "serialize:html",
      "serialize:md",
      "serialize:pdf",
      "serialize:xlsx",
    ]);
    expect(findHandler("serialize", "docx")).toBeUndefined();
    expect(findHandler("open", "md")).toBeUndefined();
    expect(findHandler("extract_text", "pdf")).toBeUndefined();
  });

  it("convert refuses a missing payload, a missing target and an unbound pair", async () => {
    const handler = findHandler("convert", "xls")!;
    const convertMessage: RunMessage = { ...message, operation: "convert", format: "xls" };
    expect(await handler(convertMessage)).toMatchObject({ ok: false, reason: "payload_required" });

    await writeFile(join(dir, "input.bin"), "not a workbook");
    await writeFile(join(dir, "ops.json"), "{not json");
    const withPayload = { ...convertMessage, payloadPath: join(dir, "ops.json") };
    expect(await handler(withPayload)).toMatchObject({ ok: false, reason: "convert_payload_invalid" });

    await writeFile(join(dir, "ops.json"), JSON.stringify({ target_format: "" }));
    expect(await handler(withPayload)).toMatchObject({ ok: false, reason: "target_format_required" });

    await writeFile(join(dir, "ops.json"), JSON.stringify({ target_format: "docx" }));
    expect(await handler(withPayload)).toMatchObject({ ok: false, code: "unsupported_operation", reason: "convert_not_bound:xls->docx" });

    await writeFile(join(dir, "ops.json"), JSON.stringify({ target_format: "xlsx" }));
    expect(await handler(withPayload)).toMatchObject({ ok: false, code: "engine_result_invalid", reason: "not_compound_file" });
  });

  it("serialize writes the exact input bytes and refuses invalid UTF-8 or a missing input", async () => {
    const handler = findHandler("serialize", "md")!;
    await writeFile(message.inputPath!, "# Tiêu đề\n");
    expect(await handler(message)).toEqual({ ok: true, warnings: [] });
    expect(await readFile(message.outputPath, "utf8")).toBe("# Tiêu đề\n");

    await writeFile(message.inputPath!, Buffer.from([0xc3, 0x28]));
    expect(await handler(message)).toMatchObject({ ok: false, code: "engine_result_invalid", reason: "invalid_utf8" });
    expect(await handler({ ...message, inputPath: null })).toMatchObject({ ok: false, reason: "input_required" });
  });

  const expectedFixtureTexts = {
    docx: [
      "# Báo cáo tổng hợp năm 2026",
      "Công ty Cổ phần UniWork Việt Nam",
      "Tài liệu kiểm thử tiếng Việt: dấu huyền, sắc, hỏi, ngã, nặng; chữ Đ và đ; tổ hợp ư, ơ, ă, â, ê, ô.",
      "## 1. Bảng số liệu",
      "Hạng mục | Quý I | Quý II",
      "Doanh thu | 1.250.000.000 | 1.410.000.000",
      "Chi phí | 780.000.000 | 820.000.000",
      "Lợi nhuận | 470.000.000 | 590.000.000",
      "",
    ].join("\n"),
    xlsx: [
      "Hạng mục,Quý I,Quý II",
      "Doanh thu,1250000000,780000000",
      "Chi phí,1410000000,820000000",
      "Lợi nhuận,1570000000,860000000",
      "Tăng trưởng,1730000000,900000000",
      "Lợi nhuận,4908000000,5408000000",
    ].join("\n"),
    pptx: [
      "## Slide 1",
      "Báo cáo tổng hợp năm 2026",
      "Công ty Cổ phần UniWork Việt Nam",
      "Notes:",
      "Ghi chú trình bày cho buổi họp tuần.",
    ].join("\n"),
  } as const;

  const fixtureRelativePaths = {
    docx: "../../../../docs/office/g0/fixtures/files/docs/docx-vietnamese.docx",
    xlsx: "../../../../docs/office/g0/fixtures/files/sheets/xlsx-vietnamese.xlsx",
    pptx: "../../../../docs/office/g0/fixtures/files/slides/pptx-notes.pptx",
  } as const;

  it("extract_text returns exact inline result.text for docx, xlsx and pptx without writing output.bin and maps typed failure classes", async () => {
    for (const format of ["docx", "xlsx", "pptx"] as const) {
      const bytes = await readFile(new URL(fixtureRelativePaths[format], import.meta.url));
      const handler = findHandler("extract_text", format)!;
      const extractMsg: RunMessage = { ...message, operation: "extract_text", format };
      await writeFile(extractMsg.inputPath!, bytes);
      expect(await handler(extractMsg)).toEqual({
        ok: true,
        warnings: [],
        result: {
          format,
          truncated: false,
          text: expectedFixtureTexts[format],
        },
      });
      await expect(stat(extractMsg.outputPath)).rejects.toThrow();
    }

    const docxHandler = findHandler("extract_text", "docx")!;
    const docxMsg: RunMessage = { ...message, operation: "extract_text", format: "docx" };

    const passwordAgile = await readFile(
      new URL("../../../../docs/office/g0/fixtures/files/docs/docx-password-agile.docx", import.meta.url),
    );
    await writeFile(docxMsg.inputPath!, passwordAgile);
    expect(await docxHandler(docxMsg)).toEqual({
      ok: false,
      code: "engine_result_invalid",
      reason: "password_required",
    });

    const legacyXls = await readFile(
      new URL("../../../../docs/office/g0/fixtures/files/sheets/legacy-xls.xls", import.meta.url),
    );
    const xlsxHandler = findHandler("extract_text", "xlsx")!;
    const xlsxMsg: RunMessage = { ...message, operation: "extract_text", format: "xlsx" };
    await writeFile(xlsxMsg.inputPath!, legacyXls);
    expect(await xlsxHandler(xlsxMsg)).toEqual({
      ok: false,
      code: "engine_result_invalid",
      reason: "not_office_file",
    });

    await writeFile(docxMsg.inputPath!, "not a zip");
    expect(await docxHandler(docxMsg)).toEqual({
      ok: false,
      code: "engine_result_invalid",
      reason: "corrupted",
    });
    expect(await docxHandler({ ...docxMsg, inputPath: null })).toEqual({
      ok: false,
      code: "engine_result_invalid",
      reason: "input_required",
    });
  });

  it("completes docx, xlsx and pptx extract_text jobs and reports typed failures through JobManager with exact inline text, no output_* fields and no PUT", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "uw-office-extract-job-"));
    const workerEntry = fileURLToPath(new URL("../../dist/worker.mjs", import.meta.url));
    let notifyFinished = () => {};
    const metrics = new Metrics();
    const origFinished = metrics.finished.bind(metrics);
    metrics.finished = (op, state, durationMs) => {
      origFinished(op, state, durationMs);
      notifyFinished();
    };
    const manager = new JobManager(
      {
        port: 0,
        host: "127.0.0.1",
        serviceToken: "x".repeat(32),
        grantKey: "y".repeat(32),
        outputOrigins: ["http://127.0.0.1"],
        maxWorkers: 1,
        maxQueue: 4,
        inputBudgetBytes: 50 * 1024 * 1024,
        limits: PROVISIONAL_LIMITS,
        tempRoot,
        workerEntry,
        sampleMs: 50,
        terminalRetentionMs: 60_000,
        maxRetainedJobs: 64,
        faultOperations: false,
        shutdownGraceMs: 1_000,
        sandbox: { mode: "off", uidBase: 20000, gidBase: 20000 },
      },
      metrics,
      Date.now,
    );
    try {
      for (const format of ["docx", "xlsx", "pptx"] as const) {
        const bytes = await readFile(new URL(fixtureRelativePaths[format], import.meta.url));
        const checksum = createHash("sha256").update(bytes).digest("hex");
        const jobDir = await mkdtemp(join(tempRoot, `uw-office-job-${format}-`));
        await writeFile(join(jobDir, "input.bin"), bytes);
        const now = Date.now();
        const grant: ServiceGrant = {
          v: 1,
          grant_id: `grant-extract-${format}`,
          job_id: `job-extract-${format}`,
          actor_id: "user-1",
          actor_kind: "human",
          organization_id: "org-1",
          workspace_id: "ws-1",
          document_id: "",
          drive_file_id: `01DRIVEFILE0000000000${format.toUpperCase()}`,
          operation: "extract_text",
          format,
          base_revision: 0,
          base_version_id: "",
          input: { checksum, length: bytes.byteLength },
          output: null,
          deadline_at: now + 30_000,
          issued_at: now,
          expires_at: now + 30_000,
        };
        bindEnvelope(
          grant,
          {
            operation: "extract_text",
            format,
            grantId: grant.grant_id,
            inputs: { checksum, length: bytes.byteLength },
          },
          ["http://127.0.0.1"],
        );
        const finished = new Promise<void>((resolve) => {
          notifyFinished = resolve;
        });
        manager.reserveInput(bytes.byteLength);
        const { job } = manager.submit({
          grant,
          fingerprint: `fp-extract-${format}`,
          requestId: `req-extract-${format}`,
          deadlineMs: 20_000,
          inputDir: jobDir,
          inputBytes: bytes.byteLength,
          payload: null,
        });
        await finished;
        const view = jobView(job);
        expect(view.state).toBe("completed");
        expect(view.operation).toBe("extract_text");
        expect(view.format).toBe(format);
        expect(view.output_file_id).toBeUndefined();
        expect(view.output_checksum).toBeUndefined();
        expect(view.output_length).toBeUndefined();
        expect(view.result).toEqual({
          format,
          truncated: false,
          text: expectedFixtureTexts[format],
        });
      }

      // Failure-class job through JobManager
      const encryptedBytes = await readFile(
        new URL("../../../../docs/office/g0/fixtures/files/docs/docx-password-agile.docx", import.meta.url),
      );
      const encryptedChecksum = createHash("sha256").update(encryptedBytes).digest("hex");
      const failDir = await mkdtemp(join(tempRoot, "uw-office-job-fail-"));
      await writeFile(join(failDir, "input.bin"), encryptedBytes);
      const now = Date.now();
      const failGrant: ServiceGrant = {
        v: 1,
        grant_id: "grant-extract-fail",
        job_id: "job-extract-fail",
        actor_id: "user-1",
        actor_kind: "human",
        organization_id: "org-1",
        workspace_id: "ws-1",
        document_id: "",
        drive_file_id: "01DRIVEFILE0000000000FAIL",
        operation: "extract_text",
        format: "docx",
        base_revision: 0,
        base_version_id: "",
        input: { checksum: encryptedChecksum, length: encryptedBytes.byteLength },
        output: null,
        deadline_at: now + 30_000,
        issued_at: now,
        expires_at: now + 30_000,
      };
      const failFinished = new Promise<void>((resolve) => {
        notifyFinished = resolve;
      });
      manager.reserveInput(encryptedBytes.byteLength);
      const { job: failJob } = manager.submit({
        grant: failGrant,
        fingerprint: "fp-extract-fail",
        requestId: "req-extract-fail",
        deadlineMs: 20_000,
        inputDir: failDir,
        inputBytes: encryptedBytes.byteLength,
        payload: null,
      });
      await failFinished;
      const failView = jobView(failJob);
      expect(failView.state).toBe("failed");
      expect(failView.error).toMatchObject({
        code: "engine_result_invalid",
        reason: "password_required",
      });
    } finally {
      await manager.shutdown(1_000);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("open:xlsx model bound", () => {
  const openMessage = async (): Promise<RunMessage> => {
    await writeFile(join(dir, "input.bin"), "stub");
    await writeFile(join(dir, "xlsx-gateway.mjs"), "export {};");
    return { ...message, operation: "open", format: "xlsx", xlsxAssetsDir: dir };
  };

  it("fails typed as upload_bounds when the encoded model passes 16 MiB", async () => {
    modelSize.bytes = 16 * 1024 * 1024 + 1;
    expect(await findHandler("open", "xlsx")!(await openMessage())).toEqual({
      ok: false,
      code: "upload_bounds",
      reason: "xlsx_open_model_too_large",
    });
  });

  it("writes the model when it fits", async () => {
    modelSize.bytes = 1024;
    expect(await findHandler("open", "xlsx")!(await openMessage())).toEqual({ ok: true, warnings: [] });
  });
});

describe("fault operations (safe subset)", () => {
  const fault = (line: string) => runFault(FAULT_PREFIX + line + "\n", message);

  it("reports the code it is told to, for the allow-list test", async () => {
    expect(await fault("code grant_expired")).toEqual({ ok: false, code: "grant_expired", reason: "fault" });
  });

  it("sleep and spin return control to the handler", async () => {
    expect(await fault("sleep 1")).toBeNull();
    expect(await fault("spin 5")).toBeNull();
  });

  it("output writes an output of the asked size", async () => {
    expect(await fault("output 1")).toEqual({ ok: true, warnings: [] });
    expect((await stat(message.outputPath)).size).toBe(1024 * 1024);
  });

  it("an unknown fault is a typed failure", async () => {
    expect(await fault("nonsense")).toMatchObject({ ok: false, code: "engine_result_invalid", reason: "unknown_fault" });
  });
});

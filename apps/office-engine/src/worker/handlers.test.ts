// In-process unit tests for the handler table and the fault operations that
// are safe to run inside the test process. The service tests already run
// both through real worker processes; these pin the pieces directly.

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOUND_OPERATIONS, findHandler } from "./handlers.ts";
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
  it("binds md/html serialize, the pdf + xlsx open/serialize/edit lanes, the Q7 converters and the docx PDF export", () => {
    expect([...BOUND_OPERATIONS].sort()).toEqual([
      "convert:odt",
      "convert:xls",
      "edit:pdf",
      "edit:xlsx",
      "export:docx",
      "open:pdf",
      "open:xlsx",
      "serialize:html",
      "serialize:md",
      "serialize:pdf",
      "serialize:xlsx",
    ]);
    expect(findHandler("serialize", "docx")).toBeUndefined();
    expect(findHandler("open", "md")).toBeUndefined();
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

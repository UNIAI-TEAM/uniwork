// In-process unit tests for the handler table and the fault operations that
// are safe to run inside the test process. The service tests already run
// both through real worker processes; these pin the pieces directly.

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOUND_OPERATIONS, findHandler } from "./handlers.ts";
import { FAULT_PREFIX, runFault } from "./faults.ts";
import type { RunMessage } from "./protocol.ts";

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
  it("binds only md/html serialize", () => {
    expect([...BOUND_OPERATIONS].sort()).toEqual(["serialize:html", "serialize:md"]);
    expect(findHandler("serialize", "docx")).toBeUndefined();
    expect(findHandler("open", "md")).toBeUndefined();
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

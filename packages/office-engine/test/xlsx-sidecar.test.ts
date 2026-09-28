// XLSX sidecar client tests — a fake NDJSON responder stands in for the Rust
// binary: the client is graded on framing, requestId matching, version checks,
// error-code mapping, timeout and crash cleanup. The real binary is proven by
// the g2-04 replay + container suite.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createXlsxSidecar } from "../src/node/xlsx-sidecar";

// A compliant responder: echoes {version:1, requestId, ok, result:{cells:[]}}.
const ECHO_SCRIPT = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const out = { version: 1, requestId: req.requestId, ok: true,
    result: req.command === "recalc_cells" ? { cells: [{ sheet: "S", row: 0, column: 0, formatted: "6", number: 6, isError: false, isFormula: true }], cached: false } : {} };
  process.stdout.write(JSON.stringify(out) + "\\n");
});
`;

// A responder that fails every request with a named code.
const ERROR_SCRIPT = (code: string) => `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({ version: 1, requestId: req.requestId, ok: false,
    error: { code: ${JSON.stringify(code)}, message: "forced" } }) + "\\n");
});
`;

// A responder that never answers (timeout path).
const SILENT_SCRIPT = `setInterval(() => {}, 1000)`;

// A responder that dies the moment a request lands — the in-flight write's
// pending request must settle typed, and the port must stay dead.
const CRASH_ON_LINE_SCRIPT = `
process.stdin.on("data", () => process.exit(1));
`;

// A responder that floods stderr (a panicking sidecar) then answers — the
// client drains it, so the request still resolves instead of deadlocking
// on a full pipe.
const STDERR_FLOOD_SCRIPT = `
for (let i = 0; i < 200; i++) process.stderr.write("panic line " + i + " " + "x".repeat(4000) + "\\n");
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({ version: 1, requestId: req.requestId, ok: true,
    result: { cells: [], cached: false } }) + "\\n");
});
`;

// A responder that emits a response far over the per-line bound — the client
// must refuse it typed rather than buffer an unbounded stream.
const GIANT_LINE_SCRIPT = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({ version: 1, requestId: req.requestId, ok: true,
    result: { cells: [] }, pad: "x".repeat(20 * 1024 * 1024) }) + "\\n");
});
`;

/** A portable stand-in: binaryPath is node itself and the script rides argv,
 *  so no platform shim is needed. */
function fakeBinary(script: string): { binaryPath: string; binaryArgs: string[] } {
  return { binaryPath: process.execPath, binaryArgs: ["-e", script] };
}

describe("xlsx sidecar client", () => {
  it("recalc round-trips over NDJSON with a matched requestId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(ECHO_SCRIPT), workDir: dir });
      const result = await port.recalc(new Uint8Array([80, 75]), [], [{ sheet: "S", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }]);
      expect(result.cells[0]).toMatchObject({ formatted: "6", number: 6, isFormula: true });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("maps sidecar error codes to boundary codes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(ERROR_SCRIPT("unsupported_version")), workDir: dir });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "protocol_mismatch" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a silent sidecar hits the request timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(SILENT_SCRIPT), workDir: dir, timeoutMs: 500 });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_timeout" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("spawn failure => engine_crashed, not a hang", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ binaryPath: join(dir, "missing-binary"), workDir: dir });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_crashed" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a child that exits mid-request settles it typed and the port stays dead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(CRASH_ON_LINE_SCRIPT), workDir: dir });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_crashed" });
      // Terminal: the same port never silently respawns for a later request.
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_crashed" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a timeout kills the child AND the port — no wedged process survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(SILENT_SCRIPT), workDir: dir, timeoutMs: 400 });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_timeout" });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_crashed" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a sidecar flooding stderr cannot deadlock the request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(STDERR_FLOOD_SCRIPT), workDir: dir });
      const result = await port.recalc(new Uint8Array([80, 75]), [], []);
      expect(result.cells).toEqual([]);
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("a response line over the bound => engine_result_invalid, terminal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-test-"));
    try {
      const port = createXlsxSidecar({ ...fakeBinary(GIANT_LINE_SCRIPT), workDir: dir });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({
        code: "engine_result_invalid",
      });
      await expect(port.recalc(new Uint8Array([80, 75]), [], [])).rejects.toMatchObject({ code: "engine_crashed" });
      await port.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

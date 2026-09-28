// XLSX native sidecar client — Node-only binding of the Rust xlsx-sidecar
// protocol (main.rs: NDJSON over stdin/stdout, request envelope
// {version:1, requestId, command, ...}, response {version, requestId, ok,
// result|error:{code,message}}).
//
// The sidecar is a real child process owned by this port: a job's recalc
// stages the workbook bytes into the job temp dir, issues recalc_cells
// against that path, and close() kills the process AND unlinks the staging
// file so no state — file or resident model — crosses into the next job.
// Crash/exit rejects every in-flight request; the caller's cleanup path (the
// supervisor's kill-by-tag) owns what this client cannot reach.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import {
  XLSX_SIDECAR_PROTOCOL_VERSION,
  type XlsxRecalcCell,
  type XlsxRecalcEdit,
  type XlsxRecalcPort,
  type XlsxRecalcRead,
  type XlsxRecalcResult,
} from "../xlsx/engine";

export interface XlsxSidecarOptions {
  /** Absolute path to the xlsx-sidecar binary (xlsx-assets resolves it when
   *  the caller does not pass one). */
  binaryPath: string;
  /** Extra argv for the binary — production passes none; tests use it to run
   *  a Node shim as the stand-in sidecar. */
  binaryArgs?: string[];
  /** Directory the staged workbook lands in — the job's private temp dir in
   *  the service; a mkdtemp under os.tmpdir() otherwise. */
  workDir?: string;
  /** Per-request deadline; the default matches the job deadline envelope. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface SidecarResponse {
  version?: number;
  requestId?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

/** Sidecar error.code → the boundary code the worker reports. */
function mapSidecarError(code: string | undefined, message: string | undefined): EngineBoundaryError {
  switch (code) {
    case "unsupported_version":
      return new EngineBoundaryError("protocol_mismatch", { detail: message ?? "sidecar protocol version" });
    case "cancelled":
      return new EngineBoundaryError("engine_cancelled", { detail: message ?? "cancelled" });
    case "recalc_busy":
      return new EngineBoundaryError("engine_overloaded", { detail: message ?? "sidecar busy" });
    case "invalid_request":
    case "invalid_json":
      return new EngineBoundaryError("engine_result_invalid", { detail: message ?? code });
    default:
      return new EngineBoundaryError("engine_crashed", { detail: message ?? code ?? "sidecar error" });
  }
}

export class XlsxSidecar implements XlsxRecalcPort {
  private child: ChildProcess | null = null;
  private reader: Interface | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private stagedPath: string | null = null;
  private stagedDir: string | null = null;

  constructor(private readonly opts: XlsxSidecarOptions) {}

  private ensure(): ChildProcess {
    if (this.closed) throw new EngineBoundaryError("engine_crashed", { detail: "xlsx sidecar released" });
    if (this.child) return this.child;
    const workDir = this.opts.workDir ?? (this.stagedDir = mkdtempSync(join(tmpdir(), "xlsx-sidecar-")));
    const child = spawn(this.opts.binaryPath, this.opts.binaryArgs ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd: workDir,
      // Only what the process needs: no service env leaks into the sandbox's
      // native helper beyond temp placement. PATH is left empty — the binary
      // is invoked by absolute path and the sidecar needs no lookups.
      env: { TMPDIR: workDir, TEMP: workDir, TMP: workDir, HOME: workDir },
    });
    child.on("error", () => this.die());
    child.once("exit", () => this.die());
    this.reader = createInterface({ input: child.stdout! });
    this.reader.on("line", (line) => this.onLine(line));
    this.child = child;
    return child;
  }

  private die(): void {
    const err = new EngineBoundaryError("engine_crashed", { detail: "xlsx sidecar exited" });
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
    this.child = null;
    this.reader?.close();
    this.reader = null;
  }

  private onLine(line: string): void {
    let msg: SidecarResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // a non-JSON line is diagnostics noise, never a response
    }
    const id = msg.requestId;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.version !== XLSX_SIDECAR_PROTOCOL_VERSION) {
      p.reject(new EngineBoundaryError("protocol_mismatch", { detail: `sidecar response version ${msg.version}` }));
      return;
    }
    if (msg.ok === true) {
      p.resolve(msg.result);
    } else {
      p.reject(mapSidecarError(msg.error?.code, msg.error?.message));
    }
  }

  private request(command: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const child = this.ensure();
    const requestId = randomUUID();
    const line = JSON.stringify({ version: XLSX_SIDECAR_PROTOCOL_VERSION, requestId, ...command });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new EngineBoundaryError("engine_timeout", { detail: "xlsx sidecar request timed out" }));
      }, timeoutMs ?? this.opts.timeoutMs ?? 60_000);
      this.pending.set(requestId, { resolve, reject, timer });
      child.stdin!.write(line + "\n", (error) => {
        if (error) {
          this.pending.delete(requestId);
          clearTimeout(timer);
          reject(new EngineBoundaryError("engine_crashed", { detail: "sidecar stdin closed" }));
        }
      });
    });
  }

  /** Stage the workbook bytes once per recalc call; the sidecar is
   *  path-based, so the file lives under workDir for the request duration. */
  private stage(bytes: Uint8Array): string {
    const dir = this.opts.workDir ?? (this.stagedDir ??= mkdtempSync(join(tmpdir(), "xlsx-sidecar-")));
    const path = join(dir, `workbook-${randomUUID()}.xlsx`);
    writeFileSync(path, bytes);
    this.stagedPath = path;
    return path;
  }

  private unstage(): void {
    if (this.stagedPath) {
      try {
        rmSync(this.stagedPath, { force: true });
      } catch {
        /* cleanup failure is non-fatal; the job dir dies with the job */
      }
      this.stagedPath = null;
    }
  }

  async recalc(
    sourceBytes: Uint8Array,
    edits: readonly XlsxRecalcEdit[],
    reads: readonly XlsxRecalcRead[],
  ): Promise<XlsxRecalcResult> {
    const path = this.stage(sourceBytes);
    try {
      const result = (await this.request({
        command: "recalc_cells",
        path,
        edits: edits.map((e) => ({ sheet: e.sheet, row: e.row, column: e.column, input: e.input })),
        reads: reads.map((r) => ({
          sheet: r.sheet,
          range: {
            startRow: r.range.startRow,
            endRow: r.range.endRow,
            startColumn: r.range.startColumn,
            endColumn: r.range.endColumn,
          },
        })),
      })) as { cells?: XlsxRecalcCell[]; cached?: boolean } | undefined;
      if (!result || !Array.isArray(result.cells)) {
        throw new EngineBoundaryError("engine_result_invalid", { detail: "sidecar recalc returned no cell list" });
      }
      return { cells: result.cells, cached: result.cached };
    } finally {
      this.unstage();
    }
  }

  /** Ask the sidecar to drop a queued/in-flight request, then release. */
  async cancel(targetRequestId: string): Promise<void> {
    if (this.closed || !this.child) return;
    try {
      await this.request({ command: "cancel", targetRequestId }, 5_000);
    } catch {
      /* cancel is best-effort — the process dies on close() regardless */
    }
  }

  /** Release the process and every staged file. Idempotent — awaits the exit
   *  event so a caller that removes the workDir does not race a dying child. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (child) {
      this.reader?.close();
      this.reader = null;
      const exited = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.killed) return resolve();
        child.once("exit", () => resolve());
        setTimeout(resolve, 5_000).unref();
      });
      child.stdin?.end();
      child.kill("SIGKILL");
      await exited;
    }
    this.unstage();
    if (this.stagedDir) {
      try {
        rmSync(this.stagedDir, { recursive: true, force: true });
      } catch {
        /* ditto */
      }
      this.stagedDir = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new EngineBoundaryError("engine_cancelled", { detail: "xlsx sidecar closed" }));
    }
    this.pending.clear();
  }
}

export function createXlsxSidecar(opts: XlsxSidecarOptions): XlsxSidecar {
  return new XlsxSidecar(opts);
}

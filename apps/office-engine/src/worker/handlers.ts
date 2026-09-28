// Operation handlers bound in this service build. A handler reads the job's
// input file (and, for edit ops, the ops.json payload the service wrote
// beside it) and writes the job's output file; all paths are chosen by the
// service inside the job's private temp dir.
//
// Bound today: serialize for md/html (G2-06: the editor holds the source, the
// service validates it as text and hands the exact bytes to the output
// target) and the G2-05 pdf lane: open (probe → probe.json), serialize
// (validated byte pass-through — the Documents commit path) and edit (the
// real pdfium pipeline: ops.json edits → verified output bytes). XLSX
// (G2-04) and asset operations register here when those lanes bind them;
// until then the service answers unsupported_operation before a job exists.

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  applyPdfEditBytes,
  PdfTypedError,
  probePdf,
} from "@uniwork/office-engine/pdf";
import {
  applyXlsxEditBytes,
  bindXlsxGateway,
  probeXlsx,
  XlsxTypedError,
  type XlsxGatewayFunctions,
  type XlsxRecalcPort,
} from "@uniwork/office-engine/xlsx";
import {
  createXlsxSidecar,
  xlsxGatewayArtifactPath,
  xlsxSidecarPath,
} from "@uniwork/office-engine/xlsx/native";
import type { HandlerOutcome, RunMessage } from "./protocol.ts";

type Handler = (message: RunMessage) => Promise<HandlerOutcome>;

/** write-then-rename: the supervisor never sees a half-written output file. */
async function writeOutput(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = path + ".tmp";
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function serializeText(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "engine_result_invalid", reason: "invalid_utf8" };
  }
  await writeOutput(message.outputPath, bytes);
  return { ok: true, warnings: [] };
}

/** Map the adapter's typed failures to worker outcome codes; anything else is
    rethrown so the job reports engine_crashed, not a mislabeled refusal. */
function pdfFail(error: unknown): HandlerOutcome {
  if (error instanceof PdfTypedError) return { ok: false, code: error.code, reason: error.reason };
  throw error;
}

// ── XLSX (G2-04) ───────────────────────────────────────────────────────────
//
// The lane loads the patched upstream gateway artifact (dist/xlsx-gateway.mjs,
// staged beside the bundle in the image / under UNIWORK_XLSX_ASSETS in dev)
// and — for edit — the Rust recalc sidecar as a child process owned by this
// worker. The sidecar stages its workbook copy inside the job temp dir and
// dies with the worker, so no resident model or file survives a job.

const xlsxGatewayCache = new Map<string, Promise<XlsxGatewayFunctions>>();

function xlsxGateway(assetsDir?: string): Promise<XlsxGatewayFunctions> {
  const artifact = xlsxGatewayArtifactPath(assetsDir);
  let cached = xlsxGatewayCache.get(artifact);
  if (!cached) {
    cached = import(pathToFileURL(artifact).href).then((mod) => bindXlsxGateway(mod as never));
    xlsxGatewayCache.set(artifact, cached);
  }
  return cached;
}

/** The engine build identity bound into each session — the gateway artifact's
 *  own sha256, so a swapped bundle can never silently inherit a snapshot. */
async function xlsxEngineVersion(assetsDir?: string): Promise<string> {
  const artifact = xlsxGatewayArtifactPath(assetsDir);
  return createHash("sha256").update(await readFile(artifact)).digest("hex");
}

/** Lazy sidecar port: the binary is resolved only when the adapter actually
    asks for recalculation, so formula-free edits never require it, and the
    engine_incompatible refusal fires only on the path that truly needs the
    native engine. Whatever is spawned still dies with the job via close(). */
function xlsxRecalc(assetsDir: string | undefined, tempDir: string): XlsxRecalcPort {
  let real: XlsxRecalcPort | undefined;
  return {
    async recalc(sourceBytes, edits, reads) {
      if (!real) real = createXlsxSidecar({ binaryPath: xlsxSidecarPath(assetsDir), workDir: tempDir });
      return real.recalc(sourceBytes, edits, reads);
    },
    async close() {
      if (real) await real.close();
    },
  };
}

function xlsxFail(error: unknown): HandlerOutcome {
  if (error instanceof XlsxTypedError) return { ok: false, code: error.code, reason: error.reason };
  throw error;
}

/** open:xlsx — probe bytes into a document-model summary JSON. */
async function openXlsx(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    const engine = await xlsxGateway(message.xlsxAssetsDir);
    const probe = await probeXlsx(engine, bytes);
    await writeOutput(message.outputPath, JSON.stringify({ document_model: probe }));
    return { ok: true, warnings: [] };
  } catch (error) {
    return xlsxFail(error);
  }
}

/** serialize:xlsx — the Documents commit path: bytes already carry saved
    content; the service proves they parse, then passes them through. */
async function serializeXlsx(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    const engine = await xlsxGateway(message.xlsxAssetsDir);
    const probe = await probeXlsx(engine, bytes);
    await writeOutput(message.outputPath, bytes);
    const warnings =
      probe.preservedParts.length > 0
        ? [{ code: "parts_preserved_not_editable", detail: `${probe.preservedParts.length} package part(s) preserved verbatim (first: ${probe.preservedParts[0]})` }]
        : [];
    return { ok: true, warnings };
  } catch (error) {
    return xlsxFail(error);
  }
}

/** edit:xlsx — ops.json edits → gateway assemble + native recalc <v> refresh
    → verified output. The sidecar is created for the job and always killed
    in finally: a crash, timeout or cancel can never leave it resident. */
async function editXlsx(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  if (!message.payloadPath) return { ok: false, code: "engine_result_invalid", reason: "ops_payload_missing" };
  const bytes = await readFile(message.inputPath);
  let ops: unknown[];
  try {
    const payload: unknown = JSON.parse(await readFile(message.payloadPath, "utf8"));
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { edits?: unknown }).edits)) {
      return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
    }
    ops = (payload as { edits: unknown[] }).edits;
  } catch {
    return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
  }
  let recalc: XlsxRecalcPort | undefined;
  try {
    const engine = await xlsxGateway(message.xlsxAssetsDir);
    recalc = xlsxRecalc(message.xlsxAssetsDir, message.tempDir);
    const result = await applyXlsxEditBytes(engine, recalc, bytes, ops, await xlsxEngineVersion(message.xlsxAssetsDir));
    await writeOutput(message.outputPath, result.bytes);
    return { ok: true, warnings: result.warnings };
  } catch (error) {
    return xlsxFail(error);
  } finally {
    if (recalc) await recalc.close().catch(() => {});
  }
}

/** open:pdf — probe bytes into a document-model summary JSON. The output is
    the probe artifact, not the input. */
async function openPdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    const probe = await probePdf(bytes);
    await writeOutput(message.outputPath, JSON.stringify({ document_model: probe }));
    return { ok: true, warnings: [] };
  } catch (error) {
    return pdfFail(error);
  }
}

/** serialize:pdf — same shape as serializeText: the model's committed bytes
    are already a PDF; the service proves they parse (typed encrypted/corrupt
    refusals) and hands them unchanged to the output target. */
async function serializePdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    const probe = await probePdf(bytes);
    await writeOutput(message.outputPath, bytes);
    if (!probe.hasTextLayer && probe.pageCount > 0) {
      return {
        ok: true,
        warnings: [{ code: "no_text_layer", detail: "document has no searchable text on any page" }],
      };
    }
    return { ok: true, warnings: [] };
  } catch (error) {
    return pdfFail(error);
  }
}

/** edit:pdf — ops.json edits → applyPdfEditBytes → verified output. A missing
    payload file means the submit path forgot to write it (engine bug), not a
    caller fault. */
async function editPdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  if (!message.payloadPath) return { ok: false, code: "engine_result_invalid", reason: "ops_payload_missing" };
  const bytes = await readFile(message.inputPath);
  let edits: unknown[];
  try {
    const payload: unknown = JSON.parse(await readFile(message.payloadPath, "utf8"));
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { edits?: unknown }).edits)) {
      return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
    }
    edits = (payload as { edits: unknown[] }).edits;
  } catch (error) {
    if (error instanceof PdfTypedError) throw error;
    return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
  }
  try {
    const result = await applyPdfEditBytes(bytes, edits);
    await writeOutput(message.outputPath, result.bytes);
    return { ok: true, warnings: result.warnings };
  } catch (error) {
    return pdfFail(error);
  }
}

const HANDLERS: Record<string, Handler> = {
  "serialize:md": serializeText,
  "serialize:html": serializeText,
  "open:pdf": openPdf,
  "serialize:pdf": serializePdf,
  "edit:pdf": editPdf,
  "open:xlsx": openXlsx,
  "serialize:xlsx": serializeXlsx,
  "edit:xlsx": editXlsx,
};

/** Keys ("operation:format") this build binds; capability rows read it. */
export const BOUND_OPERATIONS: readonly string[] = Object.keys(HANDLERS);

export function findHandler(operation: string, format: string): Handler | undefined {
  return HANDLERS[operation + ":" + format];
}

// Operation handlers bound in this service build. A handler reads the job's
// input file (and, for edit ops, the ops.json payload the service wrote
// beside it) and writes the job's output file; all paths are chosen by the
// service inside the job's private temp dir.
//
// Bound today: serialize for md/html (G2-06: the editor holds the source, the
// service validates it as text and hands the exact bytes to the output
// target) and the G2-05 pdf lane: open (probe → probe.json), serialize
// (validated byte pass-through — the Documents commit path) and edit (the
// real pdfium pipeline: ops.json edits → verified output bytes), and the
// G2-04 xlsx lane: open, serialize and edit through the patched gateway plus
// the per-job native recalc sidecar. Asset operations register here when
// their lane binds them; until then the service answers unsupported_operation
// before a job exists.

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyXlsxEditBytes,
  bindXlsxGateway,
  openXlsxModel,
  probeXlsx,
  XlsxTypedError,
  type XlsxGatewayFunctions,
  type XlsxRecalcPort,
} from "@uniwork/office-engine/xlsx";
import {
  convertDocument,
  ConvertTypedError,
} from "@uniwork/office-engine/convert/native";
import {
  createXlsxSidecar,
  xlsxGatewayArtifactPath,
  xlsxSidecarPath,
} from "@uniwork/office-engine/xlsx/native";
import { DocsPdfError, renderDocxPdf } from "./docs-pdf.ts";
import type { HandlerOutcome, RunMessage } from "./protocol.ts";

type Handler = (message: RunMessage) => Promise<HandlerOutcome>;

type PdfModule = typeof import("@uniwork/office-engine/pdf");

// The pdf graph (pdf-lib, the image codecs, two dozen pipeline modules) costs
// over a second of cpu to evaluate, and a job's cpu budget starts counting at
// fork: paid eagerly at module scope, an instant markdown or fault job can
// cpu_limit before its handler ever runs (UNI-688). Pdf jobs load it once, on
// first use; every other operation's worker never evaluates it.
let pdfModule: Promise<PdfModule> | null = null;
function loadPdf(): Promise<PdfModule> {
  pdfModule ??= import("@uniwork/office-engine/pdf");
  return pdfModule;
}

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
    rethrown so the job reports engine_crashed, not a mislabeled refusal. The
    error class arrives with the lazily loaded module. */
function pdfFail(error: unknown, PdfTypedError: PdfModule["PdfTypedError"]): HandlerOutcome {
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

type XlsxGatewayBuild = { functions: XlsxGatewayFunctions; engineVersion: string };

const xlsxGatewayCache = new Map<string, Promise<XlsxGatewayBuild>>();

/** The engine build identity bound into each session — an identity stamp of
 *  the loaded build (gateway module + sidecar) fixed at load time, so a
 *  swapped bundle can never silently inherit a snapshot's stamp while the
 *  old code keeps running. */
function xlsxGateway(assetsDir?: string): Promise<XlsxGatewayBuild> {
  const artifact = xlsxGatewayArtifactPath(assetsDir);
  let cached = xlsxGatewayCache.get(artifact);
  if (!cached) {
    cached = (async () => {
      const gatewaySha = createHash("sha256").update(await readFile(artifact)).digest("hex");
      const functions = bindXlsxGateway((await import(pathToFileURL(artifact).href)) as never);
      let sidecarSha = "no-sidecar";
      try {
        sidecarSha = createHash("sha256").update(await readFile(xlsxSidecarPath(assetsDir))).digest("hex");
      } catch {
        /* an unresolved or unreadable sidecar stamps as "no-sidecar" */
      }
      return { functions, engineVersion: `gw:${gatewaySha};sc:${sidecarSha}` };
    })();
    xlsxGatewayCache.set(artifact, cached);
  }
  return cached;
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

// ── Q7 conversion (G2-07b) ─────────────────────────────────────────────────
//
// Legacy/ODF -> OOXML runs here, in the service, never in a browser bundle.
// The job's payload names the target format; the converter names every
// category it does not carry in the result's fidelity, and the job result
// carries the change list (what the copy will contain) for the pre-accept
// warning. The source bytes are never written back: the output is a new file.

interface ConvertJobPayload {
  readonly target_format?: unknown;
  readonly source_version_id?: unknown;
}

async function convertLegacy(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  if (!message.payloadPath) return { ok: false, code: "engine_result_invalid", reason: "payload_required" };
  let payload: ConvertJobPayload;
  try {
    payload = JSON.parse(await readFile(message.payloadPath, "utf8")) as ConvertJobPayload;
  } catch {
    return { ok: false, code: "engine_result_invalid", reason: "convert_payload_invalid" };
  }
  if (typeof payload.target_format !== "string" || payload.target_format === "") {
    return { ok: false, code: "engine_result_invalid", reason: "target_format_required" };
  }
  const bytes = await readFile(message.inputPath);
  try {
    const converted = convertDocument(message.format, payload.target_format, bytes);
    await writeOutput(message.outputPath, converted.bytes);
    return {
      ok: true,
      warnings:
        converted.fidelity.lost.length > 0
          ? [{ code: "conversion_lossy", detail: `limited fidelity: ${converted.fidelity.lost.join(", ")}` }]
          : [],
      result: {
        operation: message.operation,
        source_format: converted.sourceFormat,
        target_format: converted.targetFormat,
        ...(typeof payload.source_version_id === "string" ? { source_version_id: payload.source_version_id } : {}),
        fidelity: { level: converted.fidelity.level, lost: converted.fidelity.lost },
        content: converted.content,
      },
    };
  } catch (error) {
    if (error instanceof ConvertTypedError) return { ok: false, code: error.code, reason: error.reason };
    throw error;
  }
}

const XLSX_OPEN_MODEL_MAX_BYTES = 16 * 1024 * 1024;

/** open:xlsx — probe bytes into a document-model summary JSON. */
async function openXlsx(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    const { functions: engine } = await xlsxGateway(message.xlsxAssetsDir);
    const model = await openXlsxModel(engine, bytes);
    // G3-05c: the render model rides the same payload (layout/styles/cached
    // formula results) so the browser can mount the vendored sheets renderer.
    const encoded = JSON.stringify({ document_model: model.probe, snapshot: model.snapshot, render_model: model.renderModel });
    // The browser consumes this model through the staged output download. A
    // hard bound prevents a pathological workbook from turning a probe job
    // into an unbounded JSON response; the engine's normal output limit still
    // applies at the supervisor boundary.
    if (Buffer.byteLength(encoded, "utf8") > XLSX_OPEN_MODEL_MAX_BYTES) {
      // Typed as the contract byte bound (413, non-retryable) so the web can
      // offer the desktop app instead of retrying (UNI-956).
      return { ok: false, code: "upload_bounds", reason: "xlsx_open_model_too_large" };
    }
    await writeOutput(message.outputPath, encoded);
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
    const { functions: engine } = await xlsxGateway(message.xlsxAssetsDir);
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
    const { functions: engine, engineVersion } = await xlsxGateway(message.xlsxAssetsDir);
    recalc = xlsxRecalc(message.xlsxAssetsDir, message.tempDir);
    const result = await applyXlsxEditBytes(engine, recalc, bytes, ops, engineVersion);
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
  const pdf = await loadPdf();
  const bytes = await readFile(message.inputPath);
  try {
    const probe = await pdf.probePdf(bytes);
    await writeOutput(message.outputPath, JSON.stringify({ document_model: probe }));
    return { ok: true, warnings: [] };
  } catch (error) {
    return pdfFail(error, pdf.PdfTypedError);
  }
}

/** serialize:pdf — same shape as serializeText: the model's committed bytes
    are already a PDF; the service proves they parse (typed encrypted/corrupt
    refusals) and hands them unchanged to the output target. */
async function serializePdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const pdf = await loadPdf();
  const bytes = await readFile(message.inputPath);
  try {
    const probe = await pdf.probePdf(bytes);
    await writeOutput(message.outputPath, bytes);
    if (!probe.hasTextLayer && probe.pageCount > 0) {
      return {
        ok: true,
        warnings: [{ code: "no_text_layer", detail: "document has no searchable text on any page" }],
      };
    }
    return { ok: true, warnings: [] };
  } catch (error) {
    return pdfFail(error, pdf.PdfTypedError);
  }
}

/** edit:pdf — ops.json edits → applyPdfEditBytes → verified output. A missing
    payload file means the submit path forgot to write it (engine bug), not a
    caller fault. */
async function editPdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  if (!message.payloadPath) return { ok: false, code: "engine_result_invalid", reason: "ops_payload_missing" };
  const pdf = await loadPdf();
  const bytes = await readFile(message.inputPath);
  let edits: unknown[];
  try {
    const payload: unknown = JSON.parse(await readFile(message.payloadPath, "utf8"));
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { edits?: unknown }).edits)) {
      return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
    }
    edits = (payload as { edits: unknown[] }).edits;
  } catch (error) {
    if (error instanceof pdf.PdfTypedError) throw error;
    return { ok: false, code: "engine_result_invalid", reason: "ops_payload_invalid" };
  }
  try {
    const result = await pdf.applyPdfEditBytes(bytes, edits);
    await writeOutput(message.outputPath, result.bytes);
    return { ok: true, warnings: result.warnings };
  } catch (error) {
    return pdfFail(error, pdf.PdfTypedError);
  }
}

// ── DOCX -> PDF export (UNI-1013) ──────────────────────────────────────────
//
// The pinned genoffice Docs web bundle renders and paginates the document in a
// headless Chromium (docs-pdf.ts); the only target is pdf. Without the staged
// bundle + Chromium the job fails as engine_incompatible, never as a fallback
// to another renderer.

/** Below the service's job ceiling so a stuck renderer fails as a named error
    before the supervisor's deadline kill. */
const DOCS_PDF_TIMEOUT_MS = 100_000;

async function exportDocxPdf(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  if (!message.payloadPath) return { ok: false, code: "engine_result_invalid", reason: "payload_required" };
  let payload: ConvertJobPayload;
  try {
    payload = JSON.parse(await readFile(message.payloadPath, "utf8")) as ConvertJobPayload;
  } catch {
    return { ok: false, code: "engine_result_invalid", reason: "export_payload_invalid" };
  }
  if (payload.target_format !== "pdf") return { ok: false, code: "unsupported_operation", reason: "export_pair_not_bound" };
  if (!message.docsPdfAssetsDir) return { ok: false, code: "engine_incompatible", reason: "docs_pdf_assets_missing" };
  // Chromium renders an untrusted document with its own sandbox off (a uid-dropped
  // process in a container cannot create the namespaces it needs), so the engine's
  // per-slot uid sandbox must be what confines it. Without that, refuse; never
  // run it unconfined.
  if (message.sandboxed !== true) return { ok: false, code: "engine_incompatible", reason: "sandbox_required" };
  const pdf = await loadPdf();
  try {
    const rendered = await renderDocxPdf(
      await readFile(message.inputPath),
      {
        chromiumPath: join(message.docsPdfAssetsDir, "chromium"),
        bundleDir: join(message.docsPdfAssetsDir, "bundle"),
        profileDir: join(message.tempDir, "chromium-profile"),
        timeoutMs: DOCS_PDF_TIMEOUT_MS,
        noSandbox: true,
      },
      async ([first, ...rest]) => {
        if (!first) throw new DocsPdfError("engine_result_invalid", "merge_without_parts");
        return (await pdf.mergePdfBytes(first, rest)).bytes;
      },
    );
    await writeOutput(message.outputPath, rendered.pdf);
    return {
      ok: true,
      warnings: [],
      result: {
        operation: message.operation,
        source_format: "docx",
        target_format: "pdf",
        ...(typeof payload.source_version_id === "string" ? { source_version_id: payload.source_version_id } : {}),
        renderer: "genoffice-docs-web",
        print_calls: rendered.printCalls,
      },
    };
  } catch (error) {
    if (error instanceof DocsPdfError) return { ok: false, code: error.code, reason: error.reason };
    throw error;
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
  "convert:xls": convertLegacy,
  "convert:odt": convertLegacy,
  "export:docx": exportDocxPdf,
};

/** Keys ("operation:format") this build binds; capability rows read it. */
export const BOUND_OPERATIONS: readonly string[] = Object.keys(HANDLERS);

export function findHandler(operation: string, format: string): Handler | undefined {
  return HANDLERS[operation + ":" + format];
}

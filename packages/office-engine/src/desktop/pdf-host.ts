// @uniwork/office-engine/desktop — the PDF host lane. The desktop main process
// owns pdfium/pdf-lib (Node only); the renderer reaches it through the typed
// `desktop:engine-call` payload and never imports this module (ADR 0021). The
// two entries below are the whole lane: `open` probes the bytes into a
// view-safe page summary, `edit` applies one batch and returns the verified
// output bytes. Paths and file handles stay on the host side.
import { applyPdfEditBytes, probePdf, type PdfEditOutcome, type PdfProbe } from "../pdf/index";

/** Operations the IPC schema lets a caller name. Only `open` and `edit` are
 * bound; the rest answer `engine_operation_unsupported` before any payload is
 * read. */
export type DesktopEngineOperation = "open" | "edit" | "capability" | "serialize" | "cancel";

export interface DesktopEngineCall {
  readonly operation: DesktopEngineOperation;
  /** Opaque host handle; never a filesystem path. */
  readonly handle: string;
  readonly args: {
    readonly dataBase64?: unknown;
    readonly edits?: unknown;
    readonly password?: unknown;
  };
}

export interface DesktopEngineOpenResult {
  readonly ok: true;
  readonly operation: "open";
  readonly probe: PdfProbe;
}

export interface DesktopEngineEditResult {
  readonly ok: true;
  readonly operation: "edit";
  readonly dataBase64: string;
  readonly warnings: PdfEditOutcome["warnings"];
  readonly report: PdfEditOutcome["report"];
}

export type DesktopEngineCallResult = DesktopEngineOpenResult | DesktopEngineEditResult;

/** Typed refusal for a malformed call: the IPC dispatcher turns a thrown
 * error into the channel's failure surface, so a missing payload never
 * fabricates an empty document. */
export class DesktopEngineCallError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("desktop engine call refused");
    this.name = "DesktopEngineCallError";
    this.code = code;
  }
}

function decode(input: unknown): Uint8Array {
  if (typeof input !== "string") throw new DesktopEngineCallError("engine_input_missing");
  return Uint8Array.from(Buffer.from(input, "base64"));
}

/** Answer one validated `desktop:engine-call`. The operation is dispatched
 * first so an unbound one is refused by name rather than as a missing payload.
 * Every failure throws a typed error; a partial edit never returns bytes. */
export async function handleDesktopEngineCall(call: DesktopEngineCall): Promise<DesktopEngineCallResult> {
  if (call.operation === "open") {
    const bytes = decode(call.args.dataBase64);
    const password = typeof call.args.password === "string" ? call.args.password : undefined;
    return { ok: true, operation: "open", probe: await probePdf(bytes, password) };
  }
  if (call.operation === "edit") {
    const bytes = decode(call.args.dataBase64);
    if (!Array.isArray(call.args.edits)) throw new DesktopEngineCallError("engine_input_missing");
    const result = await applyPdfEditBytes(bytes, call.args.edits);
    return { ok: true, operation: "edit", dataBase64: Buffer.from(result.bytes).toString("base64"), warnings: result.warnings, report: result.report };
  }
  throw new DesktopEngineCallError("engine_operation_unsupported");
}

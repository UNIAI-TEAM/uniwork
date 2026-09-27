// Operation handlers bound in this service build. A handler reads the job's
// input file and writes the job's output file; both paths are chosen by the
// service inside the job's private temp dir.
//
// Only one operation is bound today: serialize for md and html. Those formats
// have no engine (runtime-conclusion.md §3.5) - the editor holds the source
// and the service's job is to validate it as text and hand the exact bytes to
// the output target, so the Go side gets a real completed job with a real
// output object. DOCX/PPTX (G2-03), XLSX (G2-04), PDF (G2-05) and asset
// operations (G2-06) register their handlers here when those lanes bind them;
// until then the service answers unsupported_operation before a job exists.

import { readFile, writeFile } from "node:fs/promises";
import type { HandlerOutcome, RunMessage } from "./protocol.ts";

type Handler = (message: RunMessage) => Promise<HandlerOutcome>;

async function serializeText(message: RunMessage): Promise<HandlerOutcome> {
  if (!message.inputPath) return { ok: false, code: "engine_result_invalid", reason: "input_required" };
  const bytes = await readFile(message.inputPath);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "engine_result_invalid", reason: "invalid_utf8" };
  }
  await writeFile(message.outputPath, bytes);
  return { ok: true, warnings: [] };
}

const HANDLERS: Record<string, Handler> = {
  "serialize:md": serializeText,
  "serialize:html": serializeText,
};

/** Keys ("operation:format") this build binds; capability rows read it. */
export const BOUND_OPERATIONS: readonly string[] = Object.keys(HANDLERS);

export function findHandler(operation: string, format: string): Handler | undefined {
  return HANDLERS[operation + ":" + format];
}

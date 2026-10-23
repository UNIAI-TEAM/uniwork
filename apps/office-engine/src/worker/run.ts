// Handler thread: runs exactly one operation over files in the job's private
// temp dir and posts one outcome. It gets no network target, no grant and no
// credential - the supervisor verifies and uploads the output itself.

import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import type { HandlerOutcome, RunMessage } from "./protocol.ts";
import { findHandler } from "./handlers.ts";
import { FAULT_PREFIX, runFault } from "./faults.ts";

async function main(message: RunMessage): Promise<HandlerOutcome> {
  const handler = findHandler(message.operation, message.format);
  if (!handler) return { ok: false, code: "unsupported_operation", reason: "no_handler" };
  if (message.faults && message.inputPath) {
    const head = (await readFile(message.inputPath)).subarray(0, 256).toString("utf8");
    if (head.startsWith(FAULT_PREFIX)) {
      const outcome = await runFault(head, message);
      if (outcome) return outcome;
    }
  }
  return handler(message);
}

main(workerData as RunMessage).then(
  (outcome) => parentPort?.postMessage(outcome),
  () => parentPort?.postMessage({ ok: false, code: "engine_crashed", reason: "handler_threw" } satisfies HandlerOutcome),
);

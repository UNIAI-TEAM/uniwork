// Test-only fault operations. They exist so the service's own tests and the Go
// integration tests can drive every limit and failure path on the REAL worker
// (deadline, CPU, memory, temp, crash, process tree) instead of a mocked
// transport. They run only when the service starts with
// OFFICE_ENGINE_FAULT_OPERATIONS=1 - the image and the compose profile never
// set it - and only for an input whose first line starts with FAULT_PREFIX.
//
//   uniwork-fault:sleep <ms>        wait, then serialize normally
//   uniwork-fault:spin <ms>         burn CPU on the handler thread
//   uniwork-fault:rss <MiB>         hold off-heap memory
//   uniwork-fault:heap              grow the JS heap until the V8 cap
//   uniwork-fault:temp <MiB>        fill the job temp dir, then wait
//   uniwork-fault:grandchild <ms>   spawn a child process, record its pid, wait
//   uniwork-fault:crash             kill the worker process
//   uniwork-fault:output <MiB>      write an output of that size

import { spawn } from "node:child_process";
import { writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { HandlerOutcome, RunMessage } from "./protocol.ts";

export const FAULT_PREFIX = "uniwork-fault:";
const MiB = 1024 * 1024;

const held: unknown[] = [];

export async function runFault(head: string, message: RunMessage): Promise<HandlerOutcome | null> {
  const line = head.slice(FAULT_PREFIX.length).split(/\r?\n/, 1)[0] ?? "";
  const [kind, rawArg] = line.trim().split(/\s+/, 2);
  const arg = Number(rawArg ?? 0);
  switch (kind) {
    case "sleep":
      await sleep(arg);
      return null;
    case "spin": {
      const end = Date.now() + arg;
      let x = 0;
      while (Date.now() < end) x += Math.sqrt(x + 1);
      held.push(x);
      return null;
    }
    case "rss": {
      for (let i = 0; i < arg; i++) held.push(Buffer.alloc(MiB, 1));
      await sleep(60_000);
      return null;
    }
    case "heap": {
      for (;;) held.push(new Array(1_000_000).fill({ grow: held.length }));
    }
    case "temp": {
      const file = join(message.tempDir, "fill.bin");
      for (let i = 0; i < arg; i++) {
        await appendFile(file, Buffer.alloc(MiB, 2));
        await sleep(5);
      }
      await sleep(60_000);
      return null;
    }
    case "grandchild": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
      await writeFile(join(message.tempDir, "grandchild.pid"), String(child.pid));
      await sleep(arg);
      return null;
    }
    case "crash":
      process.kill(process.pid, "SIGKILL");
      await sleep(60_000);
      return null;
    case "output":
      await writeFile(message.outputPath, Buffer.alloc(arg * MiB, 3));
      return { ok: true, warnings: [] };
    default:
      return { ok: false, code: "engine_result_invalid", reason: "unknown_fault" };
  }
}

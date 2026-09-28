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
//   uniwork-fault:orphan <ms>       double fork: an intermediate process starts a
//                                   detached (setsid) child and exits, so the
//                                   child leaves the worker's tree and process
//                                   group; its pid is recorded inside the job
//                                   dir and the worker waits ms for the test
//   uniwork-fault:code <code>       report a failure with that engine code
//   uniwork-fault:crash             kill the worker process
//   uniwork-fault:output <MiB>      write an output of that size
//   uniwork-fault:identity <ms>     record the worker's uid/gid/pid inside the
//                                   job dir, wait ms, then output them; the
//                                   sandbox tests use it to pin slot uids
//   uniwork-fault:probe-read <abs>  output "read:<bytes>" or "denied:<code>" for
//                                   an absolute path the job must not reach
//   uniwork-fault:probe-write <abs|self>
//                                   output "wrote" or "denied:<code>"; "self"
//                                   writes inside the job's own temp dir
//   uniwork-fault:plant-output <abs|hard>
//                                   replace output.bin with a symlink to <abs>
//                                   (the supervisor must refuse to follow it)
//                                   or a hard link to input.bin (nlink>1)

import { spawn } from "node:child_process";
import { writeFile, appendFile, link, readFile, rm, symlink } from "node:fs/promises";
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
    case "orphan": {
      // The intermediate prints the orphan's pid and exits; only the job tag
      // in the orphan's environment still links it to this job. The marker is
      // inside the job dir: under the per-slot uid sandbox the worker owns
      // nothing outside it.
      const script =
        "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true,windowsHide:true});" +
        "c.unref();process.stdout.write(String(c.pid));";
      // Resolve on "close", not "exit": exit can fire before stdout has
      // drained its pid, a spawn failure is an "error" event, and an empty
      // stdout is a failure the test must see, not a hang or a bad filename.
      const pid = await new Promise<string>((resolve, reject) => {
        const mid = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
        let out = "";
        mid.stdout.on("data", (d: Buffer) => (out += d.toString()));
        mid.on("error", reject);
        mid.on("close", (code) => {
          const pid = out.trim();
          if (pid === "" || code !== 0) {
            reject(new Error(`orphan fault: no pid (exit ${code})`));
            return;
          }
          resolve(pid);
        });
      });
      await writeFile(join(message.tempDir, "orphan.pid"), pid);
      if (arg > 0) await sleep(arg);
      return null;
    }
    case "code":
      return { ok: false, code: rawArg ?? "", reason: "fault" };
    case "crash":
      process.kill(process.pid, "SIGKILL");
      await sleep(60_000);
      return null;
    case "output":
      await writeFile(message.outputPath, Buffer.alloc(arg * MiB, 3));
      return { ok: true, warnings: [] };
    case "identity": {
      const uid = typeof process.getuid === "function" ? process.getuid() : -1;
      const gid = typeof process.getgid === "function" ? process.getgid() : -1;
      await writeFile(join(message.tempDir, "identity.json"), JSON.stringify({ uid, gid, pid: process.pid }));
      if (arg > 0) await sleep(arg);
      await writeFile(message.outputPath, "uid=" + uid + " gid=" + gid);
      return { ok: true, warnings: [] };
    }
    case "probe-read": {
      const body = await readFile(rawArg ?? "").then(
        (b) => "read:" + b.length,
        (e: NodeJS.ErrnoException) => "denied:" + (e.code ?? "ERR"),
      );
      await writeFile(message.outputPath, body);
      return { ok: true, warnings: [] };
    }
    case "probe-write": {
      const target = rawArg === "self" ? join(message.tempDir, "probe-self.marker") : (rawArg ?? "");
      const body = await writeFile(target, "x").then(
        () => "wrote",
        (e: NodeJS.ErrnoException) => "denied:" + (e.code ?? "ERR"),
      );
      await writeFile(message.outputPath, body);
      return { ok: true, warnings: [] };
    }
    case "plant-output": {
      await rm(message.outputPath, { force: true });
      if (rawArg === "hard") {
        await link(join(message.tempDir, "input.bin"), message.outputPath);
      } else {
        await symlink(rawArg ?? "/etc/hostname", message.outputPath);
      }
      return { ok: true, warnings: [] };
    }
    default:
      return { ok: false, code: "engine_result_invalid", reason: "unknown_fault" };
  }
}

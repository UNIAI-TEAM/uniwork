// Output hand-off. The supervisor - not the handler - measures the output file
// and PUTs it to the one write target the grant names (the FileService
// provider-output target from RegisterProviderOutput). The engine holds no
// storage credential: the target's own signature is the only authority, and
// it is valid for exactly that object until its expiry.
//
// The job dir belongs to the worker's slot uid, so a compromised worker could
// make output.bin a symlink (to /etc/shadow, to a sibling job's input, to
// /proc/<supervisor>/environ) or a hard link to a file it cannot read and let
// the supervisor uid read it out to the grant target. Everything below runs
// on ONE fd opened with O_NOFOLLOW and is gated by fstat: a plain regular
// file, a single link, owned by the slot uid. The hash and the PUT both come
// from that fd's bytes, so there is no measure-vs-put TOCTOU either.

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { GrantOutput } from "./grants.ts";

export interface MeasuredOutput {
  checksum: string;
  length: number;
  /** The exact bytes that were hashed — putOutput sends these, never the path. */
  data: Buffer;
}

/** Read the whole file in bounded chunks, refusing past maxBytes, so a
    still-appending writer can never make us buffer more than the cap the
    caller allows. The cap - not a fixed read window - decides the total: a
    file between the window and the cap must arrive WHOLE, never truncated
    (SIZE-S1 raised the cap to the document bound, far past 64 MiB). */
async function readCapped(fd: { read(...args: unknown[]): Promise<{ bytesRead: number }> }, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const want = Math.min(64 << 20, maxBytes + 1 - total);
    const buf = Buffer.allocUnsafe(want);
    const { bytesRead } = await fd.read(buf, 0, want, null);
    if (bytesRead === 0) break;
    chunks.push(buf.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

export async function measureOutput(path: string, maxBytes: number, expectedUid?: number): Promise<MeasuredOutput> {
  let fd;
  try {
    fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    // ENOENT, or ELOOP/ELOOP-derived for a planted symlink.
    throw new EngineBoundaryError("engine_result_invalid", { reason: "output_missing" });
  }
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || (expectedUid !== undefined && info.uid !== expectedUid)) {
      // fifo/device/socket, a second link, or a file another uid owns — all of
      // them mean the worker pointed output.bin somewhere it must not.
      throw new EngineBoundaryError("engine_result_invalid", { reason: "output_not_a_file" });
    }
    if (info.size > maxBytes) {
      throw new EngineBoundaryError("upload_bounds", { reason: "output_limit", max_output_bytes: maxBytes });
    }
    const data = await readCapped(fd, maxBytes);
    if (data.length > maxBytes) {
      throw new EngineBoundaryError("upload_bounds", { reason: "output_limit", max_output_bytes: maxBytes });
    }
    return { checksum: createHash("sha256").update(data).digest("hex"), length: data.length, data };
  } finally {
    await fd.close().catch(() => undefined);
  }
}

export async function putOutput(output: MeasuredOutput, target: GrantOutput, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, "content-length": String(output.length) },
      body: output.data,
      redirect: "error",
      signal,
    } as RequestInit);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new EngineBoundaryError("engine_crashed", { reason: "output_write_failed" });
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.status < 200 || res.status >= 300) {
    throw new EngineBoundaryError("engine_crashed", { reason: "output_write_rejected", target_status: res.status });
  }
}

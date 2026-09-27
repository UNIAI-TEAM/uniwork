// Output hand-off. The supervisor - not the handler - measures the output file
// and PUTs it to the one write target the grant names (the FileService
// provider-output target from RegisterProviderOutput). The engine holds no
// storage credential: the target's own signature is the only authority, and
// it is valid for exactly that object until its expiry.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { GrantOutput } from "./grants.ts";

export interface MeasuredOutput {
  checksum: string;
  length: number;
}

export async function measureOutput(path: string, maxBytes: number): Promise<MeasuredOutput> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new EngineBoundaryError("engine_result_invalid", { reason: "output_missing" });
  }
  if (size > maxBytes) throw new EngineBoundaryError("upload_bounds", { reason: "output_limit", max_output_bytes: maxBytes });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { checksum: hash.digest("hex"), length: size };
}

export async function putOutput(path: string, output: MeasuredOutput, target: GrantOutput, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, "content-length": String(output.length) },
      body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
      duplex: "half",
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

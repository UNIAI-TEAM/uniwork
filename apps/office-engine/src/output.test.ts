// measureOutput must measure the WHOLE file up to maxBytes: the bounded
// read used to stop buffering at its 64 MiB read window, which silently
// truncated an output between 64 MiB and the cap into a short, wrong upload.
// SIZE-S1 raised the cap to the document bound, so the window must follow
// the cap, not a fixed chunk.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { measureOutput } from "./output.ts";

const MiB = 1024 * 1024;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "uw-office-output-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("measureOutput", () => {
  it("measures and returns a whole file larger than the 64 MiB read window", async () => {
    const bytes = Buffer.alloc(64 * MiB + 123, "b");
    const path = join(dir, "big.bin");
    await writeFile(path, bytes);
    const measured = await measureOutput(path, 200 * MiB);
    expect(measured.length).toBe(bytes.length);
    expect(measured.data.length).toBe(bytes.length);
    expect(measured.data.equals(bytes)).toBe(true);
  });

  it("refuses an output over maxBytes as upload_bounds", async () => {
    const path = join(dir, "over.bin");
    await writeFile(path, Buffer.alloc(16));
    await expect(measureOutput(path, 8)).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "upload_bounds",
    });
    const error = await measureOutput(path, 8).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineBoundaryError);
  });
});

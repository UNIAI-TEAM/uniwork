import { describe, expect, it } from "vitest";
import { createFakeFolderUploadTransport } from "./fake-transport";

async function setup() {
  const transport = createFakeFolderUploadTransport();
  const batch = await transport.plan(
    {
      parent_id: null,
      root_name: "root",
      share_with_workspace: false,
      folders: [],
      files: [{ file_key: "k1", path: "", filename: "a.txt", size_bytes: 1 }],
    },
    { idempotencyKey: "i1" },
  );
  const target = batch.files[0]!.target!;
  return { transport, target, blob: new Blob(["a"]) };
}

// Real timers on purpose: the bug was a clamped setTimeout, which fake timers would hide.
const settleMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("fake transport holdPuts", () => {
  it("keeps a PUT pending until release, then resolves it", async () => {
    const { transport, target, blob } = await setup();
    const release = transport.holdPuts();
    let settled = false;
    const put = transport.put(target, blob).finally(() => {
      settled = true;
    });
    await settleMs(30);
    expect(settled).toBe(false);
    expect(transport.peakPuts).toBe(1);
    release();
    await expect(put).resolves.toEqual({ etag: expect.any(String) });
  });

  it("rejects a held PUT when its signal aborts", async () => {
    const { transport, target, blob } = await setup();
    transport.holdPuts();
    const ctrl = new AbortController();
    const put = transport.put(target, blob, { signal: ctrl.signal });
    const outcome = put.then(
      () => "resolved",
      (e: unknown) => (e as DOMException).name,
    );
    await settleMs(30);
    ctrl.abort();
    await expect(outcome).resolves.toBe("AbortError");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createFileIpcHandlers, createIpcDispatcher } from "./ipc";
import { FileHandleRegistry } from "./files/registry";
import { desktopFileResponseSchema } from "../shared/ipc";
import { incomingBytes } from "../renderer/office/bytes";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const tempRoots: string[] = [];
afterEach(async () => { while (tempRoots.length) await fs.rm(tempRoots.pop()!, { recursive: true, force: true }); });

// One large fixture at a time (the disk is tight): generated sparse here and
// removed afterEach, never checked in.
const SIZE = 410 * 1024 * 1024;

describe("binary file transport (no base64, no string ceiling)", () => {
  it("delivers a 410 MiB local file from the registry to the renderer as binary with the right length", async () => {
    const root = resolve("../../.uniwork-dev-run/files", `binary-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await fs.mkdir(root, { recursive: true });
    tempRoots.push(root);
    const path = join(root, "huge.docx");
    const handle = await fs.open(path, "w");
    try {
      await handle.truncate(SIZE);
      await handle.write(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 0, 4, 0);
      await handle.write(new Uint8Array([7, 7, 7]), 0, 3, SIZE - 3);
    } finally { await handle.close(); }

    const registry = new FileHandleRegistry({ sessionId: "s" });
    const handlers = createFileIpcHandlers({ registry, pickOpen: async () => path, isOpened: () => true });
    const dispatch = createIpcDispatcher(handlers, context);

    // Main side: the real handler, the real validator and the response schema.
    const answered = await dispatch("desktop:file-pick-open", { sessionGeneration: "session_1234" });
    // Electron's structured clone; the buffer is transferred rather than copied
    // so this test holds one 410 MiB allocation, not two.
    const sent = answered as { data: Uint8Array };
    expect(sent.data).toBeInstanceOf(Uint8Array);
    const wire = structuredClone(answered, { transfer: [sent.data.buffer] });

    // Renderer side: the same response schema and the shared byte normaliser.
    const received = desktopFileResponseSchema.parse(wire);
    expect(received.opened).toBe(true);
    const bytes = incomingBytes(received.data);
    expect(bytes.byteLength).toBe(SIZE);
    expect(received.metadata?.byteLength).toBe(SIZE);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.subarray(SIZE - 3))).toEqual([7, 7, 7]);
  }, 120_000);
});

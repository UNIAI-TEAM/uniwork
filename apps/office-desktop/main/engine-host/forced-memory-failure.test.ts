import type { DesktopEngineCall, DesktopEngineCallResult } from "@uniwork/office-engine/desktop";
import { describe, expect, it, vi } from "vitest";
import { isMemoryFailure } from "../../shared/memory";
import type { FileHandleRegistry } from "../files/registry";
import { createFileIpcHandlers } from "../ipc";
import { withForcedMemoryFailure } from "./forced-memory-failure";

const engines = () => ({
  pdfCall: vi.fn(async (_call: DesktopEngineCall) => ({ ok: true }) as unknown as DesktopEngineCallResult),
  xlsx: { open: vi.fn(async (_bytes: Uint8Array) => ({ snapshot: {}, renderModel: {} })), edit: vi.fn(async () => ({ bytes: new Uint8Array(1), checksum: "c" })) },
  dispose: vi.fn(),
});
const call = { operation: "open" } as unknown as DesktopEngineCall;
const forced = { UNIWORK_OFFICE_FORCE_OOM: "1" };

/** What Electron's invoke turns a rejected handler into on the renderer side. */
const relayed = (error: unknown) => new Error(`Error invoking remote method 'desktop:engine-call': ${String(error)}`);

describe("withForcedMemoryFailure", () => {
  it("fails the first engine job once as an allocation failure in an unpackaged launch, then runs jobs normally", async () => {
    const inner = engines();
    const wrapped = withForcedMemoryFailure(inner, { packaged: false, env: forced });
    const failure = await wrapped.pdfCall(call).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "RangeError", code: "insufficient_memory" });
    expect(inner.pdfCall).not.toHaveBeenCalled();
    // The renderer only sees the invoke wrapper, and still reads it as out of memory.
    expect(isMemoryFailure(relayed(failure))).toBe(true);
    await expect(wrapped.pdfCall(call)).resolves.toEqual({ ok: true });
    await expect(wrapped.xlsx.open(new Uint8Array(1))).resolves.toEqual({ snapshot: {}, renderModel: {} });
    expect(wrapped.dispose).toBe(inner.dispose);
  });

  it("answers the local xlsx open with the typed file_insufficient_memory", async () => {
    const wrapped = withForcedMemoryFailure(engines(), { packaged: false, env: forced });
    const registry = { read: async () => new Uint8Array(4) } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, xlsx: wrapped.xlsx, isOpened: () => true });
    await expect(handlers["desktop:file-xlsx"]({ sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", operation: "open", baseRevision: "1" })).resolves.toMatchObject({ state: "failed", code: "file_insufficient_memory" });
  });

  it.each([
    ["a packaged build, even with the variable set", { packaged: true, env: forced }],
    ["an unpackaged launch without the variable", { packaged: false, env: {} }],
    ["an unpackaged launch with another value", { packaged: false, env: { UNIWORK_OFFICE_FORCE_OOM: "true" } }],
    ["no options", undefined],
  ])("is inert in %s", async (_label, options) => {
    const inner = engines();
    expect(withForcedMemoryFailure(inner, options)).toBe(inner);
  });
});

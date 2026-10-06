import { describe, expect, it } from "vitest";
import { IpcValidationError, validateIpcRequest } from "./ipc";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const call = (args: Record<string, unknown>) => ({ sessionGeneration: "session_1234", operation: "edit", handle: "handle:1", args });
const MIB = 1024 * 1024;

describe("engine-call binary data at the IPC seam", () => {
  it.each([32, 64])("validates a %i MiB Uint8Array in constant time (no per-byte walk)", (mib) => {
    const data = new Uint8Array(mib * MIB);
    const started = performance.now();
    const parsed = validateIpcRequest("desktop:engine-call", call({ data }), context);
    const elapsed = performance.now() - started;
    console.info(`engine-call ${mib} MiB validate: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(50);
    expect((parsed.args.data as Uint8Array).byteLength).toBe(mib * MIB);
  });

  it("normalises an ArrayBuffer to an exact Uint8Array", () => {
    const parsed = validateIpcRequest("desktop:engine-call", call({ data: new Uint8Array([1, 2, 3]).buffer }), context);
    expect(parsed.args.data).toBeInstanceOf(Uint8Array);
    expect([...(parsed.args.data as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it("trims a Uint8Array view to its own bytes", () => {
    const view = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
    const parsed = validateIpcRequest("desktop:engine-call", call({ data: view }), context);
    const data = parsed.args.data as Uint8Array;
    expect([...data]).toEqual([1, 2, 3]);
    expect(data.buffer.byteLength).toBe(3);
  });

  it("refuses a non-byte args.data", () => {
    expect(() => validateIpcRequest("desktop:engine-call", call({ data: "AAAA" }), context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:engine-call", call({ data: new Float64Array(2) }), context)).toThrowError(IpcValidationError);
  });

  it("still refuses a path-like key next to binary data", () => {
    expect(() => validateIpcRequest("desktop:engine-call", call({ data: new Uint8Array(4), file_path: "/etc/passwd" }), context)).toThrowError(IpcValidationError);
  });

  it("keeps the 64 KiB cap on a big data field of any non-byte channel", () => {
    const big = new Uint8Array(MIB);
    const base = { sessionGeneration: "session_1234" };
    expect(() => validateIpcRequest("desktop:file-open", { ...base, handle: "h", data: big }, context)).toThrowError(expect.objectContaining({ code: "oversize" }));
    expect(() => validateIpcRequest("desktop:public-config", { ...base, data: big }, context)).toThrowError(expect.objectContaining({ code: "oversize" }));
    // A nested `data` below args is not exempt either.
    expect(() => validateIpcRequest("desktop:engine-call", call({ nested: { data: big } }), context)).toThrowError(expect.objectContaining({ code: "oversize" }));
  });

  it("keeps the byte exemption on the byte channels", () => {
    const big = new Uint8Array(MIB);
    const handle = "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle, data: big }, context)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { DESKTOP_IPC_CHANNELS, IPC_MAX_BYTES, IpcValidationError, validateIpcRequest } from "./ipc";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234", allowedExternalHosts: ["docs.uniwork.com"] };
const valid = { sessionGeneration: "session_1234", operation: "capability", handle: "handle:1", args: {} } as const;

describe("desktop IPC allowlist", () => {
  it("enumerates only opaque operations", () => {
    expect(DESKTOP_IPC_CHANNELS).toEqual(["desktop:bootstrap", "desktop:engine-call", "desktop:open-external"]);
    expect(DESKTOP_IPC_CHANNELS.some((channel) => /fs|exec|http/i.test(channel))).toBe(false);
  });
  it("accepts a valid engine request", () => expect(validateIpcRequest("desktop:engine-call", valid, context)).toEqual(valid));
  it.each([
    ["unknown channel", "desktop:unknown", valid, "unknown_channel"],
    ["wrong sender", "desktop:engine-call", valid, "sender"],
    ["wrong frame", "desktop:engine-call", valid, "frame"],
    ["wrong origin", "desktop:engine-call", valid, "origin"],
    ["stale session", "desktop:engine-call", { ...valid, sessionGeneration: "session_old1" }, "session"],
    ["bad schema", "desktop:engine-call", { ...valid, operation: "readFile" }, "schema"],
  ])("rejects %s", (_label, channel, payload, code) => {
    const mutated = { ...context };
    if (code === "sender") mutated.senderId = 8;
    if (code === "frame") mutated.frameId = 1;
    if (code === "origin") mutated.origin = "https://evil.example";
    expect(() => validateIpcRequest(channel, payload, mutated)).toThrowError(IpcValidationError);
    try { validateIpcRequest(channel, payload, mutated); } catch (error) { expect((error as IpcValidationError).code).toBe(code); }
  });
  it("rejects payloads over the byte limit", () => {
    const large = { ...valid, args: { value: "x".repeat(IPC_MAX_BYTES) } };
    expect(() => validateIpcRequest("desktop:engine-call", large, context)).toThrow(/byte limit/);
  });
  it("rejects structured-clone values instead of measuring only JSON", () => {
    const payload = { ...valid, args: { buffer: new ArrayBuffer(8 * 1024 * 1024) } };
    expect(() => validateIpcRequest("desktop:engine-call", payload, context)).toThrowError(IpcValidationError);
    try { validateIpcRequest("desktop:engine-call", payload, context); } catch (error) { expect((error as IpcValidationError).code).toBe("oversize"); }
  });
  it("requires the external channel to use the exact HTTPS host allowlist", () => {
    const request = { sessionGeneration: "session_1234", url: "https://docs.uniwork.com/help" };
    expect(validateIpcRequest("desktop:open-external", request, context)).toEqual(request);
    for (const url of ["file:///etc/passwd", "http://docs.uniwork.com/help", "https://evil.example/"]) {
      expect(() => validateIpcRequest("desktop:open-external", { ...request, url }, context)).toThrowError(IpcValidationError);
      try { validateIpcRequest("desktop:open-external", { ...request, url }, context); } catch (error) { expect((error as IpcValidationError).code).toBe("external_url"); }
    }
  });
});

import { describe, expect, it } from "vitest";
import { createAuthIpcHandlers, DESKTOP_IPC_CHANNELS, desktopDraftResponseSchema, desktopFileMetadataSchema, desktopFileResponseSchema, desktopSessionMetadataSchema, IPC_MAX_BYTES, IpcValidationError, validateIpcRequest } from "./ipc";
import { NativeLoginManager } from "./auth/manager";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234", allowedExternalHosts: ["docs.uniwork.com"] };
const valid = { sessionGeneration: "session_1234", operation: "capability", handle: "handle:1", args: {} } as const;

describe("desktop IPC allowlist", () => {
  it("enumerates only opaque operations", () => {
    expect(DESKTOP_IPC_CHANNELS).toEqual(["desktop:bootstrap", "desktop:engine-call", "desktop:open-external", "desktop:auth-start", "desktop:auth-cancel", "desktop:auth-session", "desktop:file-pick-open", "desktop:file-open", "desktop:file-save", "desktop:file-save-as", "desktop:draft-checkpoint"]);
    expect(DESKTOP_IPC_CHANNELS.some((channel) => /fs|exec|http/i.test(channel))).toBe(false);
  });
  it("accepts a valid engine request", () => expect(validateIpcRequest("desktop:engine-call", valid, context)).toEqual(valid));
  it("rejects renderer paths and accepts only opaque file handles", () => {
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" }, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", path: "C:\\secret.txt", dataBase64: "b2s=" }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:engine-call", { ...valid, args: { path: "C:\\secret.txt" } }, context)).toThrowError(IpcValidationError);
  });
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
  it("accepts only metadata and opaque auth commands at the IPC boundary", () => {
    expect(desktopFileMetadataSchema.parse({ handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "x.txt", byteLength: 1, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` })).toMatchObject({ name: "x.txt" });
    expect(desktopFileResponseSchema.parse({ opened: false })).toEqual({ opened: false });
    expect(desktopDraftResponseSchema.parse({ stored: true, generation: 1 })).toEqual({ stored: true, generation: 1 });
    expect(desktopSessionMetadataSchema.parse({ status: "signed-out" })).toEqual({ status: "signed-out" });
    expect(desktopSessionMetadataSchema.parse({ status: "signed-in", accountId: "account-1", deploymentId: "production-eu" })).toMatchObject({ status: "signed-in" });
    expect(() => desktopSessionMetadataSchema.parse({ status: "signed-in", accessToken: "secret" })).toThrow();
    expect(validateIpcRequest("desktop:auth-start", { sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" }, context)).toEqual({ sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" });
    expect(validateIpcRequest("desktop:auth-cancel", { sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" }, context)).toMatchObject({ attemptId: expect.stringMatching(/^attempt_/) });
    expect(validateIpcRequest("desktop:auth-session", { sessionGeneration: "session_1234" }, context)).toEqual({ sessionGeneration: "session_1234" });
    expect(() => validateIpcRequest("desktop:auth-start", { sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu", accessToken: "secret" }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:auth-cancel", { sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", refreshToken: "secret" }, context)).toThrowError(IpcValidationError);
  });
  it("maps auth handlers to metadata-only responses", async () => {
    const manager = { isBound: () => true, startLogin: async () => ({ status: "pending" as const, attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", expiresAt: 123 }), cancelLogin: () => ({ status: "signed-out" as const }), getMetadata: () => ({ status: "signed-out" as const }) } as unknown as NativeLoginManager;
    const handlers = createAuthIpcHandlers(manager);
    await expect(handlers["desktop:auth-start"]({ sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" })).resolves.toEqual({ status: "pending", attemptId: expect.stringMatching(/^attempt_/), expiresAt: 123 });
    expect(handlers["desktop:auth-cancel"]({ sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" })).toEqual({ status: "signed-out" });
    expect(handlers["desktop:auth-session"]({ sessionGeneration: "session_1234" })).toEqual({ status: "signed-out" });
    const rejecting = createAuthIpcHandlers({ ...manager, isBound: () => false } as unknown as NativeLoginManager);
    await expect(rejecting["desktop:auth-start"]({ sessionGeneration: "session_1234", clientId: "other", deploymentId: "staging" })).rejects.toThrow(/binding/);
  });
  it("rejects token-shaped fields returned by an untrusted manager implementation", () => {
    const leakyManager = {
      isBound: () => true,
      startLogin: async () => ({ status: "pending" as const, attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", expiresAt: 123 }),
      cancelLogin: () => ({ status: "signed-out" as const, accessToken: "opaque-test-value" }),
      getMetadata: () => ({ status: "signed-out" as const, refreshToken: "opaque-test-value" }),
    } as unknown as NativeLoginManager;
    const handlers = createAuthIpcHandlers(leakyManager);
    expect(() => handlers["desktop:auth-cancel"]({ sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" })).toThrow();
    expect(() => handlers["desktop:auth-session"]({ sessionGeneration: "session_1234" })).toThrow();
  });
});

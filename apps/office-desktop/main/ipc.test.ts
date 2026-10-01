import { describe, expect, it, vi } from "vitest";
import { createAuthIpcHandlers, createDraftIpcHandlers, createFileIpcHandlers, createOfficeIpcHandlers, createIpcDispatcher, DESKTOP_IPC_CHANNELS, desktopAuthConfigResponseSchema, desktopDiagnosticsResponseSchema, desktopDraftResponseSchema, desktopFileMetadataSchema, desktopFileResponseSchema, desktopLibraryResponseSchema, desktopSessionMetadataSchema, IPC_MAX_BYTES, IPC_FILE_MAX_BYTES, IpcValidationError, validateIpcRequest } from "./ipc";
import { NativeLoginManager } from "./auth/manager";
import { LocalFileError, type FileHandleRegistry } from "./files/registry";
import type { DesktopDraftStore } from "./drafts/store";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234", allowedExternalHosts: ["docs.uniwork.com"] };
const valid = { sessionGeneration: "session_1234", operation: "capability", handle: "handle:1", args: {} } as const;

describe("desktop IPC allowlist", () => {
  it("enumerates only opaque operations", () => {
    expect(DESKTOP_IPC_CHANNELS).toEqual(["desktop:bootstrap", "desktop:engine-call", "desktop:open-external", "desktop:auth-start", "desktop:auth-cancel", "desktop:auth-session", "desktop:auth-config", "desktop:auth-logout", "desktop:diagnostics", "desktop:window-theme", "desktop:file-pick-open", "desktop:file-open", "desktop:file-save", "desktop:file-save-as", "desktop:draft-checkpoint", "desktop:library-list", "desktop:library-context", "desktop:library-recent", "desktop:library-search", "desktop:library-create", "desktop:library-download", "desktop:office-open", "desktop:office-save"]);
    expect(DESKTOP_IPC_CHANNELS.some((channel) => /fs|exec|http/i.test(channel))).toBe(false);
  });
  it("accepts a valid engine request", () => expect(validateIpcRequest("desktop:engine-call", valid, context)).toEqual(valid));
  it("rejects renderer paths and accepts only opaque file handles", () => {
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" }, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", path: "C:\\secret.txt", dataBase64: "b2s=" }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:engine-call", { ...valid, args: { path: "C:\\secret.txt" } }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "x".repeat(100_000) }, context)).not.toThrow();
    expect(IPC_FILE_MAX_BYTES).toBeGreaterThan(IPC_MAX_BYTES);
  });
  it("accepts realistic documents without regex stack overflow", () => {
    const dataBase64 = Buffer.alloc(10 * 1024 * 1024).toString("base64");
    expect(() => validateIpcRequest("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64 }, context)).not.toThrow();
  }, 20_000);
  it("allows DOCX save bytes above the control-message budget", () => {
    const dataBase64 = Buffer.alloc(96 * 1024).toString("base64");
    const request = { sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1", intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64, checksum: `sha256:${"a".repeat(64)}` };
    expect(() => validateIpcRequest("desktop:office-save", request, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:office-save", { ...request, dataBase64: "x".repeat(IPC_FILE_MAX_BYTES) }, context)).toThrowError(IpcValidationError);
  });

  it("sanitizes file handler errors and validates handler responses", async () => {
    const registry = { openPath: async () => { throw new LocalFileError("symlink_refused", "C:\\secret.txt"); }, save: async () => { throw new LocalFileError("external_modification", "C:\\secret.txt"); } } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, pickOpen: async () => "C:\\secret.txt" });
    await expect(handlers["desktop:file-pick-open"]({ sessionGeneration: "session_1234" })).rejects.toMatchObject({ code: "symlink_refused", message: "local file operation refused" });
    await expect(handlers["desktop:file-save"]({ sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" })).rejects.toMatchObject({ code: "external_modification" });
    const dispatcher = createIpcDispatcher({ "desktop:file-save": async () => ({ opened: true, path: "C:\\secret.txt" }) }, context);
    await expect(dispatcher("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" })).rejects.toThrow(IpcValidationError);
  });

  it("binds draft checkpoint identity in main and does not expose draft errors", async () => {
    const store = { checkpointPlaintext: async () => { throw new Error("/secret/key and plaintext"); } } as unknown as DesktopDraftStore;
    const handlers = createDraftIpcHandlers({ store, session: { sessionId: "s", deploymentId: "dep", accountId: "a", generation: 1 }, identity: { deploymentId: "dep", accountId: "a", organizationId: "o", workspaceId: "w", documentId: "d", base: { revision: "1", version: "v" } } });
    await expect(handlers["desktop:draft-checkpoint"]({ sessionGeneration: "session_1234", draftId: "draft", generation: 1, dataBase64: "b2s=" })).rejects.toMatchObject({ code: "storage_unavailable", message: "draft operation refused" });
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
    expect(desktopAuthConfigResponseSchema.parse({ clientId: "com.uniwork.office", deploymentId: "production-eu" })).toEqual({ clientId: "com.uniwork.office", deploymentId: "production-eu" });
    expect(desktopSessionMetadataSchema.parse({ status: "signed-out" })).toEqual({ status: "signed-out" });
    expect(desktopSessionMetadataSchema.parse({ status: "signed-in", accountId: "account-1", deploymentId: "production-eu" })).toMatchObject({ status: "signed-in" });
    expect(() => desktopSessionMetadataSchema.parse({ status: "signed-in", accessToken: "secret" })).toThrow();
    expect(validateIpcRequest("desktop:auth-start", { sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" }, context)).toEqual({ sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" });
    expect(validateIpcRequest("desktop:auth-cancel", { sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" }, context)).toMatchObject({ attemptId: expect.stringMatching(/^attempt_/) });
    expect(validateIpcRequest("desktop:auth-session", { sessionGeneration: "session_1234" }, context)).toEqual({ sessionGeneration: "session_1234" });
    expect(validateIpcRequest("desktop:auth-config", { sessionGeneration: "session_1234" }, context)).toEqual({ sessionGeneration: "session_1234" });
    expect(validateIpcRequest("desktop:auth-logout", { sessionGeneration: "session_1234", scope: "device" }, context)).toEqual({ sessionGeneration: "session_1234", scope: "device" });
    expect(() => validateIpcRequest("desktop:auth-start", { sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu", accessToken: "secret" }, context)).toThrowError(IpcValidationError);
    expect(() => validateIpcRequest("desktop:auth-cancel", { sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", refreshToken: "secret" }, context)).toThrowError(IpcValidationError);
  });
  it("returns diagnostics without content or credential fields", async () => {
    const dispatcher = createIpcDispatcher({ "desktop:diagnostics": () => ({ appId: "com.uniwork.office", appVersion: "0.0.0", engineVersion: "genoffice@09485f88+uniwork-office.0", contractVersion: "uniwork-office-engine-contract/1", protocolVersion: 1, channel: "dev", buildId: "unsigned-dev" }) }, context);
    await expect(dispatcher("desktop:diagnostics", { sessionGeneration: "session_1234" })).resolves.toEqual(expect.objectContaining({ channel: "dev", buildId: "unsigned-dev" }));
    await expect(dispatcher("desktop:diagnostics", { sessionGeneration: "session_1234", content: "secret" })).rejects.toThrowError(IpcValidationError);
    expect(desktopDiagnosticsResponseSchema.parse({ appId: "com.uniwork.office", appVersion: "0.0.0", engineVersion: "genoffice@09485f88+uniwork-office.0", contractVersion: "uniwork-office-engine-contract/1", protocolVersion: 1, channel: "dev", buildId: "unsigned-dev" })).not.toHaveProperty("content");
  });
  it("maps auth handlers to metadata-only responses", async () => {
    const manager = { isBound: () => true, getBinding: () => ({ clientId: "com.uniwork.office", deploymentId: "production-eu" }), startLogin: async () => ({ status: "pending" as const, attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", expiresAt: 123 }), cancelLogin: () => ({ status: "signed-out" as const }), getMetadata: () => ({ status: "signed-out" as const }), logout: async () => ({ status: "signed-out" as const }) } as unknown as NativeLoginManager;
    const handlers = createAuthIpcHandlers(manager);
    await expect(handlers["desktop:auth-start"]({ sessionGeneration: "session_1234", clientId: "com.uniwork.office", deploymentId: "production-eu" })).resolves.toEqual({ status: "pending", attemptId: expect.stringMatching(/^attempt_/), expiresAt: 123 });
    expect(handlers["desktop:auth-cancel"]({ sessionGeneration: "session_1234", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" })).toEqual({ status: "signed-out" });
    expect(handlers["desktop:auth-session"]({ sessionGeneration: "session_1234" })).toEqual({ status: "signed-out" });
    expect(handlers["desktop:auth-config"]({ sessionGeneration: "session_1234" })).toEqual({ clientId: "com.uniwork.office", deploymentId: "production-eu" });
    await expect(handlers["desktop:auth-logout"]({ sessionGeneration: "session_1234", scope: "device" })).resolves.toEqual({ status: "signed-out" });
    const rejecting = createAuthIpcHandlers({ ...manager, isBound: () => false } as unknown as NativeLoginManager);
    await expect(rejecting["desktop:auth-start"]({ sessionGeneration: "session_1234", clientId: "other", deploymentId: "staging" })).rejects.toThrow(/binding/);
  });

  it("binds library and DOCX save operations to the typed main transport", async () => {
    const transport = {
      context: vi.fn(async () => ({ deployments: [{ id: "dep", name: "Test" }], accounts: [{ id: "acct", name: "Account" }], organizations: [{ id: "org", name: "Org" }], workspaces: [{ id: "ws-1", name: "Workspace" }] })),
      list: vi.fn(async () => ({ documents: [{ id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true }], nextCursor: null, engineAvailable: false })),
      download: vi.fn(async () => ({ documentId: "doc-1", version: 1, filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` })),
      open: vi.fn(async () => ({ document: { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true }, dataBase64: "aGVsbG8=", filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: `sha256:${"a".repeat(64)}` })),
      save: vi.fn(async (input: { intentId: string; idempotencyKey: string }) => ({ documentId: "doc-1", intentId: input.intentId, idempotencyKey: input.idempotencyKey, versionId: "version-2", revision: "10", checksum: `sha256:${"b".repeat(64)}` })),
    };
    const handlers = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => true });
    await expect(handlers["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).resolves.toMatchObject({ engineAvailable: false });
    await expect(handlers["desktop:office-save"]({ sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1", intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` })).resolves.toMatchObject({ revision: "10" });
    expect(transport.save).toHaveBeenCalledOnce();
    expect(desktopLibraryResponseSchema.safeParse(await handlers["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).success).toBe(true);
    const signedOut = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => false });
    await expect(signedOut["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).rejects.toMatchObject({ code: "login_required" });
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

import { describe, expect, it, vi } from "vitest";
import { createAuthIpcHandlers, createDraftIpcHandlers, createFileIpcHandlers, createOfficeIpcHandlers, createIpcDispatcher, DESKTOP_IPC_CHANNELS, desktopAuthConfigResponseSchema, desktopDiagnosticsResponseSchema, desktopDraftResponseSchema, desktopFileMetadataSchema, desktopFileResponseSchema, desktopFileXlsxResponseSchema, desktopLibraryResponseSchema, desktopSessionMetadataSchema, IPC_MAX_BYTES, IPC_FILE_MAX_BYTES, IpcValidationError, validateIpcRequest } from "./ipc";
import { NativeLoginManager } from "./auth/manager";
import { LocalFileError, type FileHandleRegistry } from "./files/registry";
import type { DesktopDraftStore } from "./drafts/store";
import { createOfficeSaveGuard } from "../../../packages/core/office/save-guard";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234", allowedExternalHosts: ["docs.uniwork.com"] };
const valid = { sessionGeneration: "session_1234", operation: "capability", handle: "handle:1", args: {} } as const;

describe("desktop IPC allowlist", () => {
  it("enumerates only opaque operations", () => {
    expect(DESKTOP_IPC_CHANNELS).toEqual(["desktop:bootstrap", "desktop:engine-call", "desktop:open-external", "desktop:auth-start", "desktop:auth-cancel", "desktop:auth-session", "desktop:auth-config", "desktop:auth-logout", "desktop:diagnostics", "desktop:window-theme", "desktop:appearance", "desktop:tabs-update", "desktop:file-pick-open", "desktop:file-create", "desktop:file-open", "desktop:file-save", "desktop:file-save-as", "desktop:file-xlsx", "desktop:draft-checkpoint", "desktop:draft-list", "desktop:draft-recover", "desktop:draft-discard", "desktop:local-state", "desktop:local-mode", "desktop:recent-list", "desktop:recent-open", "desktop:recent-remove", "desktop:library-list", "desktop:library-context", "desktop:public-config", "desktop:library-recent", "desktop:library-search", "desktop:library-create", "desktop:library-download", "desktop:office-open", "desktop:office-context", "desktop:office-save", "desktop:office-job", "desktop:leave-resolved", "desktop:print-document"]);
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
    const request = { sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1", format: "docx" as const, intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64, checksum: `sha256:${"a".repeat(64)}` };
    expect(() => validateIpcRequest("desktop:office-save", request, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:office-save", { ...request, dataBase64: "x".repeat(IPC_FILE_MAX_BYTES) }, context)).toThrowError(IpcValidationError);
  });
  it("allows PDF engine payloads above the control-message budget but refuses a genuinely oversized one", () => {
    const payload = { ...valid, operation: "edit" as const, args: { dataBase64: "x".repeat(100_000), edits: [] } };
    expect(() => validateIpcRequest("desktop:engine-call", payload, context)).not.toThrow();
    expect(() => validateIpcRequest("desktop:engine-call", { ...valid, args: { value: "x".repeat(IPC_FILE_MAX_BYTES) } }, context)).toThrowError(IpcValidationError);
  });
  it("accepts user content that starts with a path-like character", () => {
    const payload = { ...valid, operation: "edit" as const, args: { dataBase64: "b2s=", edits: [{ op: "insert", value: "/leading slash" }], password: "/secret-password" } };
    expect(validateIpcRequest("desktop:engine-call", payload, context)).toEqual(payload);
    expect(() => validateIpcRequest("desktop:engine-call", { ...valid, args: { nested: { file_path: "/etc/passwd" } } }, context)).toThrowError(IpcValidationError);
  });

  it("opens and edits a local .xlsx through the bundled engine and rejects an un-carried pick", async () => {
    const metadata = { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "Budget.xlsx", byteLength: 4, modifiedAtMs: 9, checksum: `sha256:${"a".repeat(64)}` };
    const registry = { read: async () => new Uint8Array([1, 2, 3, 4]), openPath: async () => metadata } as unknown as FileHandleRegistry;
    const xlsx = {
      open: async () => ({ snapshot: { revision: 0, sheets: [] }, renderModel: { revision: 0, activeTab: 0, date1904: false, sheets: [], styles: [], dxfStyles: [] } }),
      edit: async () => ({ bytes: new Uint8Array([9, 9]), checksum: `sha256:${"b".repeat(64)}` }),
    };
    const handlers = createFileIpcHandlers({ registry, xlsx, isOpened: () => true, pickOpen: async () => "C:\\Budget.xlsx" });
    const opened = await handlers["desktop:file-xlsx"]({ sessionGeneration: "session_1234", handle: metadata.handle, operation: "open", baseRevision: "9" }) as { state: string; outputBase64?: string };
    expect(opened.state).toBe("completed");
    expect(JSON.parse(Buffer.from(opened.outputBase64!, "base64").toString("utf8"))).toMatchObject({ snapshot: { revision: 0 } });
    const edited = await handlers["desktop:file-xlsx"]({ sessionGeneration: "session_1234", handle: metadata.handle, operation: "edit", baseRevision: "9", edits: [{ op: "set_cell" }] }) as { state: string; outputChecksum?: string };
    expect(edited.state).toBe("completed");
    expect(edited.outputChecksum).toBe(`sha256:${"b".repeat(64)}`);
    // A picked .xlsx registers a local open; an extension outside the shared
    // format table (here a legacy .xls) still answers unsupported.
    expect(await handlers["desktop:file-pick-open"]({ sessionGeneration: "session_1234" })).toMatchObject({ opened: true, metadata: { name: "Budget.xlsx" } });
    const legacy = createFileIpcHandlers({ registry, pickOpen: async () => "C:\\Budget.xls" });
    expect(await legacy["desktop:file-pick-open"]({ sessionGeneration: "session_1234" })).toEqual({ opened: false, unsupported: true });
  });
  it("sanitizes file handler errors and validates handler responses", async () => {
    const registry = { openPath: async () => { throw new LocalFileError("symlink_refused", "C:\\secret.txt"); }, save: async () => { throw new LocalFileError("external_modification", "C:\\secret.txt"); } } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, pickOpen: async () => "C:\\secret.docx" });
    // A refusal answers with a stable wire code, never the internal reason, the
    // message or the path (Electron would drop a thrown code anyway).
    const refusedPick = await handlers["desktop:file-pick-open"]({ sessionGeneration: "session_1234" });
    expect(refusedPick).toEqual({ opened: false, code: "file_access_denied" });
    expect(JSON.stringify(refusedPick)).not.toContain("secret");
    await expect(handlers["desktop:file-save"]({ sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" })).resolves.toEqual({ opened: false, code: "file_changed_on_disk" });
    const dispatcher = createIpcDispatcher({ "desktop:file-save": async () => ({ opened: true, path: "C:\\secret.txt" }) }, context);
    await expect(dispatcher("desktop:file-save", { sessionGeneration: "session_1234", handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", dataBase64: "b2s=" })).rejects.toThrow(IpcValidationError);
  });
  it.each([
    ["invalid_path", "file_invalid_path"],
    ["not_found", "file_not_found"],
    ["symlink_refused", "file_access_denied"],
    ["locked", "file_locked"],
    ["external_modification", "file_changed_on_disk"],
    ["invalid_handle", "file_handle_invalid"],
    ["session_revoked", "file_session_revoked"],
    ["write_failed", "file_write_failed"],
    ["replace_failed", "file_replace_failed"],
    ["read_failed", "file_read_failed"],
    ["too_large", "file_too_large"],
  ] as const)("answers a %s refusal on every file command with code %s", async (internal, wire) => {
    const fail = async () => { throw new LocalFileError(internal, "C:\\secret\\path.docx"); };
    const registry = { openPath: fail, openPathFromHandle: fail, read: fail, save: fail, saveAs: fail, createUntitled: fail } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, xlsx: {} as never, pickOpen: async () => "C:\\a.docx", pickSaveAs: async () => "C:\\a.docx", recents: { resolve: async () => ({ path: "C:\\a.docx" }) } as never });
    const handle = "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";
    const session = { sessionGeneration: "session_1234" };
    const answers = await Promise.all([
      handlers["desktop:file-pick-open"](session),
      handlers["desktop:file-create"]({ ...session, format: "docx" }),
      handlers["desktop:file-open"]({ ...session, handle }),
      handlers["desktop:file-save"]({ ...session, handle, dataBase64: "b2s=" }),
      handlers["desktop:file-save-as"]({ ...session, handle, dataBase64: "b2s=" }),
      handlers["desktop:recent-open"]({ ...session, id: `recent_${"a".repeat(16)}` }),
    ]);
    // A Save over the limit has its own code: the open-side copy would mislead.
    const saveWire = internal === "too_large" ? "file_save_too_large" : wire;
    for (const [index, answer] of answers.entries()) {
      const code = index === 3 || index === 4 ? saveWire : wire;
      const expected = internal === "not_found" && "missing" in answer ? { opened: false, missing: true } : { opened: false, code };
      expect(answer).toEqual(expected);
      expect(desktopFileResponseSchema.parse(answer)).toEqual(expected);
      expect(JSON.stringify(answer)).not.toMatch(/secret|path.docx|[A-Z]:/);
    }
    await expect(handlers["desktop:file-xlsx"]({ ...session, handle, operation: "open", baseRevision: "1" })).resolves.toEqual({ state: "failed", code: wire });
  });
  it("answers an unbound xlsx engine and an unknown refusal with typed codes, and rethrows engine faults", async () => {
    const handle = "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";
    const request = { sessionGeneration: "session_1234", handle, operation: "open" as const, baseRevision: "1" };
    const registry = { read: async () => new Uint8Array([1]) } as unknown as FileHandleRegistry;
    await expect(createFileIpcHandlers({ registry })["desktop:file-xlsx"](request)).resolves.toEqual({ state: "failed", code: "file_engine_unavailable" });
    await expect(createFileIpcHandlers({ registry, isOpened: () => false })["desktop:file-save"]({ sessionGeneration: "session_1234", handle, dataBase64: "b2s=" })).resolves.toEqual({ opened: false, code: "file_handle_invalid" });
    const faulty = createFileIpcHandlers({ registry, xlsx: { open: async () => { throw new Error("xlsx_recalc_unavailable"); } } as never });
    await expect(faulty["desktop:file-xlsx"](request)).rejects.toThrow("xlsx_recalc_unavailable");
    expect(desktopFileResponseSchema.safeParse({ opened: false, code: "C:\\secret" }).success).toBe(false);
    // A code names a refusal: a successful answer never carries one.
    expect(desktopFileResponseSchema.safeParse({ opened: true, code: "file_locked" }).success).toBe(false);
    expect(desktopFileXlsxResponseSchema.safeParse({ state: "completed", code: "file_locked" }).success).toBe(false);
    expect(desktopFileXlsxResponseSchema.safeParse({ state: "failed", code: "file_locked" }).success).toBe(true);
  });
  it("reads an unexpected open-side fault as file_read_failed and a save-side one as file_write_failed", async () => {
    const handle = "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";
    const session = { sessionGeneration: "session_1234" };
    const boom = async () => { throw new Error("EACCES: C:\\secret\\file.docx"); };
    const registry = { openPath: boom, openPathFromHandle: boom, read: boom, save: boom } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, pickOpen: async () => "C:\\a.docx" });
    await expect(handlers["desktop:file-pick-open"](session)).resolves.toEqual({ opened: false, code: "file_read_failed" });
    await expect(handlers["desktop:file-open"]({ ...session, handle })).resolves.toEqual({ opened: false, code: "file_read_failed" });
    await expect(handlers["desktop:file-save"]({ ...session, handle, dataBase64: "b2s=" })).resolves.toEqual({ opened: false, code: "file_write_failed" });
  });
  it("names a failed draft checkpoint before a local Save and writes nothing", async () => {
    const metadata = { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "x.docx", byteLength: 1, modifiedAtMs: 7, checksum: `sha256:${"a".repeat(64)}` };
    const save = vi.fn(async () => metadata);
    const registry = { openPathFromHandle: async () => metadata, save } as unknown as FileHandleRegistry;
    const checkpoint = async () => { throw new Error("/secret/draft key unavailable"); };
    const answer = await createFileIpcHandlers({ registry, checkpoint })["desktop:file-save"]({ sessionGeneration: "session_1234", handle: metadata.handle, dataBase64: "b2s=" });
    expect(answer).toEqual({ opened: false, code: "file_checkpoint_failed" });
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(answer)).not.toContain("secret");
  });
  it("shares one non-queueing guard across local Save calls and releases it on failure", async () => {
    const guard = createOfficeSaveGuard();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const metadata = { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "x.txt", byteLength: 1, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` };
    const registry = { save: async () => { await pending; return metadata; } } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, saveGuard: guard });
    const first = handlers["desktop:file-save"]({ sessionGeneration: "session_1234", handle: metadata.handle, dataBase64: "b2s=" });
    expect(guard.busy).toBe(true);
    await expect(handlers["desktop:file-save"]({ sessionGeneration: "session_1234", handle: metadata.handle, dataBase64: "b2s=" })).resolves.toEqual({ opened: false, code: "file_save_in_progress" });
    release();
    await expect(first).resolves.toEqual({ opened: true, metadata });
    expect(guard.busy).toBe(false);
  });

  it("accepts every format-table pick and refuses any other extension", async () => {
    const metadata = { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "Deck.pptx", byteLength: 1, modifiedAtMs: 7, checksum: `sha256:${"a".repeat(64)}` };
    const registry = { openPath: async () => metadata, read: async () => new Uint8Array([1]) } as unknown as FileHandleRegistry;
    for (const path of ["C:\\Deck.pptx", "C:\\Report.pdf", "C:\\Plan.docx", "C:\\Sheet.xlsx", "C:\\Notes.md", "C:\\Page.html"]) {
      const handlers = createFileIpcHandlers({ registry, pickOpen: async () => path });
      await expect(handlers["desktop:file-pick-open"]({ sessionGeneration: "session_1234" })).resolves.toMatchObject({ opened: true, metadata });
    }
    for (const path of ["C:\\notes.txt", "C:\\Sheet.xls", "C:\\Deck.ppt"]) {
      const refused = createFileIpcHandlers({ registry, pickOpen: async () => path });
      await expect(refused["desktop:file-pick-open"]({ sessionGeneration: "session_1234" })).resolves.toEqual({ opened: false, unsupported: true });
    }
    const recents = { resolve: async () => ({ path: "C:\\Deck.pptx" }) };
    const recentHandlers = createFileIpcHandlers({ registry, recents: recents as never });
    await expect(recentHandlers["desktop:recent-open"]({ sessionGeneration: "session_1234", id: `recent_${"a".repeat(16)}` })).resolves.toMatchObject({ opened: true });
    const refusedRecent = createFileIpcHandlers({ registry, recents: { resolve: async () => ({ path: "C:\\notes.txt" }) } as never });
    await expect(refusedRecent["desktop:recent-open"]({ sessionGeneration: "session_1234", id: `recent_${"a".repeat(16)}` })).resolves.toEqual({ opened: false, unsupported: true });
  });

  it("records a local open without a durable draft, and checkpoints only before a write", async () => {
    const metadata = { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name: "x.docx", byteLength: 1, modifiedAtMs: 7, checksum: `sha256:${"a".repeat(64)}` };
    const checkpoint = vi.fn(async () => undefined);
    const onOpened = vi.fn();
    const registry = { openPath: async () => metadata, openPathFromHandle: async () => metadata, read: async () => new Uint8Array([1]), save: async () => metadata } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, onOpened, checkpoint, pickOpen: async () => "C:\\x.docx", pickSaveAs: async () => "C:\\x.docx" });
    await handlers["desktop:file-open"]({ sessionGeneration: "session_1234", handle: metadata.handle });
    await handlers["desktop:file-pick-open"]({ sessionGeneration: "session_1234" });
    expect(onOpened).toHaveBeenCalledTimes(2);
    expect(checkpoint).not.toHaveBeenCalled();
    await handlers["desktop:file-save"]({ sessionGeneration: "session_1234", handle: metadata.handle, dataBase64: "b2s=" });
    expect(checkpoint).toHaveBeenCalledWith(metadata, expect.any(Uint8Array));
  });

  it("binds draft checkpoint identity in main and does not expose draft errors", async () => {
    const store = { checkpointPlaintext: async () => { throw new Error("/secret/key and plaintext"); } } as unknown as DesktopDraftStore;
    const handlers = createDraftIpcHandlers({ store, session: { sessionId: "s", deploymentId: "dep", accountId: "a", generation: 1 }, identity: { deploymentId: "dep", accountId: "a", organizationId: "o", workspaceId: "w", documentId: "d", base: { revision: "1", version: "v" } } });
    await expect(handlers["desktop:draft-checkpoint"]({ sessionGeneration: "session_1234", documentId: "d", draftId: "draft", generation: 1, dataBase64: "b2s=" })).rejects.toMatchObject({ code: "storage_unavailable", message: "draft operation refused" });
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
    expect(() => validateIpcRequest("desktop:window-theme", large, context)).toThrow(/byte limit/);
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
    expect(desktopSessionMetadataSchema.parse({ status: "locked", lockedReason: "keyring" })).toEqual({ status: "locked", lockedReason: "keyring" });
    expect(() => desktopSessionMetadataSchema.parse({ status: "signed-out", lockedReason: "keyring" })).toThrow();
    expect(() => desktopSessionMetadataSchema.parse({ status: "locked", lockedReason: "other" })).toThrow();
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
      publicConfig: vi.fn(async () => ({ flags: { office_engine: true, office_docx: false } })),
      list: vi.fn(async () => ({ documents: [{ id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true }], nextCursor: null, engineAvailable: false })),
      download: vi.fn(async () => ({ documentId: "doc-1", version: 1, filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` })),
      open: vi.fn(async () => ({ document: { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file", format: "docx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true }, dataBase64: "aGVsbG8=", filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: `sha256:${"a".repeat(64)}` })),
      openContext: vi.fn(async () => ({ document: { id: "doc-x", workspaceId: "ws-1", title: "Plan.xlsx", kind: "file", format: "xlsx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true } })),
      officeJob: vi.fn(async (input: { format: string }) => ({ jobId: "job-1", documentId: "doc-x", state: "completed" as const, outputBase64: "aGVsbG8=", outputChecksum: `sha256:${"a".repeat(64)}` })),
      save: vi.fn(async (input: { intentId: string; idempotencyKey: string }) => ({ documentId: "doc-1", intentId: input.intentId, idempotencyKey: input.idempotencyKey, versionId: "version-2", revision: "10", checksum: `sha256:${"b".repeat(64)}` })),
    };
    const handlers = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => true });
    await expect(handlers["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).resolves.toMatchObject({ engineAvailable: false });
    await expect(handlers["desktop:office-save"]({ sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1", format: "docx", intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` })).resolves.toMatchObject({ revision: "10" });
    expect(transport.save).toHaveBeenCalledOnce();
    await expect(handlers["desktop:office-context"]({ sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-x" })).resolves.toMatchObject({ document: { id: "doc-x", format: "xlsx" } });
    await expect(handlers["desktop:office-job"]({ sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-x", format: "xlsx", operation: "open", baseRevision: "9" })).resolves.toMatchObject({ jobId: "job-1" });
    expect(transport.officeJob).toHaveBeenCalledWith(expect.objectContaining({ format: "xlsx" }));
    expect(desktopLibraryResponseSchema.safeParse(await handlers["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).success).toBe(true);
    await expect(handlers["desktop:public-config"]({ sessionGeneration: "session_1234" })).resolves.toEqual({ flags: { office_engine: true, office_docx: false } });
    expect(transport.publicConfig).toHaveBeenLastCalledWith(undefined);
    await handlers["desktop:public-config"]({ sessionGeneration: "session_1234", organizationId: "org-1" });
    expect(transport.publicConfig).toHaveBeenLastCalledWith("org-1");
    // A malformed transport answer degrades to no flags instead of throwing.
    transport.publicConfig.mockResolvedValueOnce({ flags: { office_engine: "yes" } } as never);
    await expect(handlers["desktop:public-config"]({ sessionGeneration: "session_1234" })).resolves.toEqual({ flags: {} });
    const signedOut = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => false });
    await expect(signedOut["desktop:public-config"]({ sessionGeneration: "session_1234" })).rejects.toMatchObject({ code: "login_required" });
    await expect(signedOut["desktop:library-list"]({ sessionGeneration: "session_1234", workspaceId: "ws-1" })).rejects.toMatchObject({ code: "login_required" });
  });
  it("refuses a save whose declared format disagrees with the format main opened", async () => {
    const row = { id: "deck-1", workspaceId: "ws-1", title: "Deck.pptx", kind: "file", format: "pptx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
    const transport = {
      open: vi.fn(async () => ({ document: row, dataBase64: "aGVsbG8=", filename: "Deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", checksum: `sha256:${"a".repeat(64)}` })),
      save: vi.fn(async (input: { intentId: string; idempotencyKey: string }) => ({ documentId: "deck-1", intentId: input.intentId, idempotencyKey: input.idempotencyKey, versionId: "version-2", revision: "10", checksum: `sha256:${"b".repeat(64)}` })),
    };
    const handlers = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => true });
    await handlers["desktop:office-open"]({ sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "deck-1" });
    const save = { sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "deck-1", intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` };
    await expect(handlers["desktop:office-save"]({ ...save, format: "docx" })).rejects.toMatchObject({ code: "document_context_refused" });
    expect(transport.save).not.toHaveBeenCalled();
    await expect(handlers["desktop:office-save"]({ ...save, format: "pptx" })).resolves.toMatchObject({ revision: "10" });
    expect(transport.save).toHaveBeenCalledWith(expect.objectContaining({ format: "pptx" }));
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

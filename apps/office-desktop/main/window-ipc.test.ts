import { describe, expect, it, vi } from "vitest";
import { desktopFileResponseSchema } from "../shared/ipc";
import { LocalFileError, type FileHandleRegistry } from "./files/registry";
import { registerWindowIpc } from "./window-ipc";

const meta = (name: string) => ({ handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name, byteLength: 3, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` });
const scope = { accountId: "local", deploymentId: "local", sessionId: "s1" } as never;

function setup(registry: Partial<Record<keyof FileHandleRegistry, unknown>>, deviceScope: () => never = () => scope) {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const mainFrame = {};
  const webContents = { mainFrame, once: vi.fn(), isLoading: () => false, send: vi.fn() };
  const localOpenContext = vi.fn();
  registerWindowIpc({
    ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => { handlers.set(channel, handler); } } as never,
    app: { on: vi.fn() } as never,
    window: { webContents } as never,
    dispatch: vi.fn(),
    fileRegistry: registry as unknown as FileHandleRegistry,
    deviceScope,
    localOpenContext,
    nativeFiles: [],
    argv: [],
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  const drop = (path: unknown, from: unknown = event) => handlers.get("desktop:native-drop-open")!(from, { path });
  return { drop, localOpenContext, event };
}

describe("desktop:native-drop-open", () => {
  it("opens a dropped file through the handle registry and records the open", async () => {
    const metadata = meta("Dropped.docx");
    const { drop, localOpenContext } = setup({ openEvent: async () => metadata, read: async () => new Uint8Array([1, 2, 3]) });
    const answer = await drop("C:\\Docs\\Dropped.docx");
    expect(desktopFileResponseSchema.parse(answer)).toEqual({ opened: true, metadata, dataBase64: "AQID" });
    expect(localOpenContext).toHaveBeenCalledWith(metadata);
  });

  it.each([
    ["invalid_path", "file_invalid_path"],
    ["not_found", "file_not_found"],
    ["symlink_refused", "file_access_denied"],
    ["locked", "file_locked"],
    ["read_failed", "file_read_failed"],
    ["too_large", "file_too_large"],
  ] as const)("answers a %s refusal at open with code %s, never the message or the path", async (internal, wire) => {
    const { drop, localOpenContext } = setup({ openEvent: async () => { throw new LocalFileError(internal, "C:\\secret\\Dropped.docx"); }, read: async () => new Uint8Array() });
    const answer = await drop("C:\\secret\\Dropped.docx");
    expect(answer).toEqual({ opened: false, code: wire });
    expect(JSON.stringify(answer)).not.toMatch(/secret|Dropped|[A-Z]:/);
    expect(localOpenContext).not.toHaveBeenCalled();
  });

  it("answers a refused read after a successful open the same way", async () => {
    const { drop, localOpenContext } = setup({ openEvent: async () => meta("Dropped.docx"), read: async () => { throw new LocalFileError("too_large"); } });
    await expect(drop("C:\\Dropped.docx")).resolves.toEqual({ opened: false, code: "file_too_large" });
    expect(localOpenContext).not.toHaveBeenCalled();
  });

  it("reads an unexpected fault as file_read_failed", async () => {
    const { drop } = setup({ openEvent: async () => { throw new Error("EACCES: C:\\secret"); }, read: async () => new Uint8Array() });
    await expect(drop("C:\\Dropped.docx")).resolves.toEqual({ opened: false, code: "file_read_failed" });
  });

  it("answers file_session_revoked when the device scope changed during the read", async () => {
    let scopes = 0;
    const { drop, localOpenContext } = setup({ openEvent: async () => meta("Dropped.docx"), read: async () => new Uint8Array([1]) }, (() => ({ accountId: "local", deploymentId: "local", sessionId: `s${scopes++}` })) as never);
    await expect(drop("C:\\Dropped.docx")).resolves.toEqual({ opened: false, code: "file_session_revoked" });
    expect(localOpenContext).not.toHaveBeenCalled();
  });

  it("answers unsupported before the registry sees a file outside the format table", async () => {
    const openEvent = vi.fn();
    const { drop } = setup({ openEvent, read: async () => new Uint8Array() });
    await expect(drop("C:\\Docs\\notes.xls")).resolves.toEqual({ opened: false, unsupported: true });
    expect(openEvent).not.toHaveBeenCalled();
  });

  it("still refuses a foreign sender, a missing frame match and a relative or non-string path by throwing", async () => {
    const { drop, event } = setup({ openEvent: vi.fn(), read: vi.fn() });
    await expect(drop("C:\\a.docx", { sender: {}, senderFrame: {} })).rejects.toThrow("invalid_sender");
    await expect(drop("C:\\a.docx", { sender: event.sender, senderFrame: {} })).rejects.toThrow("invalid_sender");
    await expect(drop("relative.docx")).rejects.toThrow("invalid_file");
    await expect(drop(42)).rejects.toThrow("invalid_file");
  });
});

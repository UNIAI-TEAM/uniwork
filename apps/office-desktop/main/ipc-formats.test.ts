import { describe, expect, it, vi } from "vitest";
import { createFileIpcHandlers, IpcValidationError, validateIpcRequest } from "./ipc";
import type { FileHandleRegistry } from "./files/registry";

const context = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234", allowedExternalHosts: ["docs.uniwork.com"] };
const session = { sessionGeneration: "session_1234" };
const meta = (name: string) => ({ handle: "file_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", name, byteLength: 1, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` });

describe("desktop format validation at the IPC boundary", () => {
  it.each(["docx", "pdf", "md", "html", "xlsx"])("accepts desktop:file-create with format %s", (format) => {
    expect(validateIpcRequest("desktop:file-create", { ...session, format }, context)).toEqual({ ...session, format });
  });

  it("defaults desktop:file-create to DOCX and rejects formats outside the table", () => {
    expect(validateIpcRequest("desktop:file-create", session, context)).toEqual({ ...session, format: "docx" });
    for (const format of ["pptx", "markdown", "htm", "txt", "MD", ""]) {
      expect(() => validateIpcRequest("desktop:file-create", { ...session, format }, context)).toThrowError(IpcValidationError);
    }
    expect(() => validateIpcRequest("desktop:library-create", { ...session, workspaceId: "ws", title: "x", format: "pptx" }, context)).toThrowError(IpcValidationError);
  });

  it("refuses to create a blank XLSX: the table carries it but no generator exists yet", async () => {
    const createUntitled = vi.fn(async (_bytes: Uint8Array, untitled: string) => meta(untitled));
    const handlers = createFileIpcHandlers({ registry: { createUntitled } as unknown as FileHandleRegistry });
    await expect(handlers["desktop:file-create"]({ ...session, format: "xlsx" })).rejects.toThrow("document_format_unbound");
    expect(createUntitled).not.toHaveBeenCalled();
  });

  it.each([["md", "Untitled.md"], ["html", "Untitled.html"]] as const)("creates a blank %s named %s", async (format, name) => {
    const createUntitled = vi.fn(async (_bytes: Uint8Array, untitled: string) => meta(untitled));
    const handlers = createFileIpcHandlers({ registry: { createUntitled } as unknown as FileHandleRegistry });
    const result = await handlers["desktop:file-create"]({ ...session, format });
    expect(createUntitled).toHaveBeenCalledWith(expect.any(Uint8Array), name);
    expect(result).toMatchObject({ opened: true, metadata: { name } });
    expect(typeof (result as { dataBase64?: unknown }).dataBase64).toBe("string"); // a blank Markdown file is zero bytes
  });

  it.each([
    ["C:/notes.txt", false], ["C:/page.xhtml", false], ["C:/readme", false], ["C:/a.md.txt", false],
    ["C:/notes.md", true], ["C:/NOTES.MARKDOWN", true], ["C:/page.html", true], ["C:/page.HTM", true],
  ])("picking %s is opened=%s", async (path, accepted) => {
    const openPath = vi.fn(async () => meta(path));
    const registry = { openPath, read: async () => new Uint8Array([1]) } as unknown as FileHandleRegistry;
    const handlers = createFileIpcHandlers({ registry, pickOpen: async () => path });
    const result = await handlers["desktop:file-pick-open"](session);
    if (accepted) expect(result).toMatchObject({ opened: true });
    else { expect(result).toEqual({ opened: false, unsupported: true }); expect(openPath).not.toHaveBeenCalled(); }
  });

  it("refuses an unsupported recent entry without opening it", async () => {
    const openPath = vi.fn();
    const handlers = createFileIpcHandlers({ registry: { openPath } as unknown as FileHandleRegistry, recents: { resolve: async () => ({ path: "C:/x.txt" }) } as never });
    await expect(handlers["desktop:recent-open"]({ ...session, id: `recent_${"a".repeat(32)}` })).resolves.toEqual({ opened: false, unsupported: true });
    expect(openPath).not.toHaveBeenCalled();
  });
});

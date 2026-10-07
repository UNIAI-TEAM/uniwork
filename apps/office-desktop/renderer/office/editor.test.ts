import { expect, it, vi } from "vitest";
import { createDesktopDocxEditor } from "./editor";

it("routes native menu Save to the same guarded action as the editor", async () => {
  const bridge = { call: vi.fn(async () => ({ document: { id: "doc-1" }, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), filename: "x.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: `sha256:${"a".repeat(64)}` })) };
  const saveAction = vi.fn(async () => undefined);
  const editor = createDesktopDocxEditor({ bridge: bridge as never, sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1", saveAction });
  await editor.open();
  editor.markDirty();
  await editor.handleNativeSave();
  expect(saveAction).toHaveBeenCalledWith("menu");
  expect(editor.getDirty()).toBe(false);
  await editor.handleNativeSave();
  expect(saveAction).toHaveBeenCalledTimes(1);
});

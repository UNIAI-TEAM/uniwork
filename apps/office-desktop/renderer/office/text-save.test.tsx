/** @vitest-environment jsdom */
import { createHash } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createByteDocumentSession, type OpenedBytes } from "./session";
import { OpenByteDocument } from "./open-document";
import type { RendererBridge } from "../app";
import type { DesktopDraftMetadata } from "../../shared/ipc";

const handle = `file_${"t".repeat(40)}`;
const utf8 = (value: string) => new TextEncoder().encode(value);
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromB64 = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: handle, generation: 1, baseRevision: "10", baseVersionId: "v10" };
const BOM = [0xef, 0xbb, 0xbf];

const mdBytes = new Uint8Array([...BOM, ...utf8("# Xin chào\r\nTiếng Việt: đ ệ ơ ư\r\n")]);
const htmlBytes = utf8("<!doctype html><html><body><p>Đây là trang</p></body></html>\r\n");

type Payload = { data?: Uint8Array; handle?: string; draftId?: string; generation?: number };

/** A local-file bridge: file-save lands the bytes, drafts live in a map. No
 * network channel exists on it, so any office-save/engine call fails the test. */
function localHarness(format: "md" | "html", original: Uint8Array, over: Partial<OpenedBytes> = {}) {
  const files = { saved: [] as Uint8Array[] };
  const drafts = new Map<string, { bytes: Uint8Array; generation: number }>();
  const channels: string[] = [];
  const row = (draftId: string): DesktopDraftMetadata => ({ draftId, identity: { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: handle, base: { revision: "10", version: "v10" } }, generation: drafts.get(draftId)!.generation, checksum: sha(drafts.get(draftId)!.bytes), byteLength: drafts.get(draftId)!.bytes.length, updatedAt: 1 });
  const meta = (bytes: Uint8Array) => ({ handle, name: `Doc.${format}`, byteLength: bytes.length, modifiedAtMs: 20, checksum: sha(bytes) });
  const call = vi.fn(async (channel: string, payload: Payload) => {
    channels.push(channel);
    switch (channel) {
      case "desktop:file-save": { const bytes = payload.data!; files.saved.push(bytes); return { opened: true, metadata: meta(bytes) }; }
      case "desktop:file-open": return { opened: true, metadata: meta(original) };
      case "desktop:draft-list": return { drafts: [...drafts.keys()].map(row) };
      case "desktop:draft-checkpoint": { const generation = payload.generation!; drafts.set(payload.draftId!, { bytes: payload.data!, generation }); return { stored: true, generation }; }
      case "desktop:draft-recover": { const draft = drafts.get(payload.draftId!)!; return { status: "recovered", metadata: row(payload.draftId!), data: draft.bytes }; }
      case "desktop:draft-discard": drafts.delete(payload.draftId!); return { discarded: true };
      default: throw new Error(`Unexpected IPC: ${channel}`);
    }
  });
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const open = (opened: Partial<OpenedBytes> = {}) => createByteDocumentSession(bridge, identity, { format, data: Uint8Array.from(Buffer.from(b64(original), "base64")), checksum: sha(original), localHandle: handle, ...over, ...opened });
  return { bridge, call, files, drafts, channels, open };
}

type TextSession = ReturnType<typeof createByteDocumentSession>;
const text = (session: TextSession) => (session.editor as unknown as { getText(): string }).getText();
const setText = (session: TextSession, value: string) => (session.editor as unknown as { setText(value: string): void }).setText(value);

it("saves an unedited .md as exactly the original bytes (BOM, CRLF, Vietnamese kept)", async () => {
  const { open, files } = localHarness("md", mdBytes);
  const session = open();
  await session.openEditor();
  expect(text(session)).toBe("# Xin chào\r\nTiếng Việt: đ ệ ơ ư\r\n");
  session.coordinator.markDirty(session.editor.getDirtyGeneration() + 1);
  expect((await session.coordinator.save("button")).accepted).toBe(true);
  expect(Array.from(files.saved[0]!)).toEqual(Array.from(mdBytes));
  session.dispose();
});

it("saves an edited .md through the coordinator with the BOM and CRLF preserved", async () => {
  const { open, files, channels } = localHarness("md", mdBytes);
  const session = open();
  await session.openEditor();
  setText(session, "# Tiêu đề mới\r\nDòng hai\r\n");
  expect(session.coordinator.getState().state).toBe("dirty");
  expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
  expect(Array.from(files.saved[0]!)).toEqual([...BOM, ...utf8("# Tiêu đề mới\r\nDòng hai\r\n")]);
  expect(channels).toContain("desktop:file-save");
  expect(channels.filter((channel) => /office-save|engine-call/.test(channel))).toEqual([]);
  session.dispose();
});

it("saves an edited .html as plain UTF-8 with no BOM added", async () => {
  const { open, files } = localHarness("html", htmlBytes);
  const session = open();
  await session.openEditor();
  setText(session, "<p>Xin chào</p>\n");
  expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
  expect(Array.from(files.saved[0]!)).toEqual(Array.from(utf8("<p>Xin chào</p>\n")));
  session.dispose();
});

it("reopening the saved bytes decodes to the same text (encode(decode(bytes)) === bytes)", async () => {
  for (const [format, bytes] of [["md", mdBytes], ["html", htmlBytes]] as const) {
    const { open, files } = localHarness(format, bytes);
    const first = open();
    await first.openEditor();
    first.coordinator.markDirty(first.editor.getDirtyGeneration() + 1);
    await first.coordinator.save("button");
    const reopened = localHarness(format, files.saved[0]!).open();
    await reopened.openEditor();
    expect(text(reopened)).toBe(text(first));
    expect(Array.from((await reopened.editor.captureSnapshot()).value)).toEqual(Array.from(bytes));
    first.dispose(); reopened.dispose();
  }
});

it("checkpoints the encoded bytes through the existing draft seam only", async () => {
  const { open, drafts, channels } = localHarness("md", mdBytes);
  const session = open();
  await session.openEditor();
  setText(session, "# Bản nháp\r\n");
  expect(await session.keepDraft()).toBe(true);
  const [stored] = [...drafts.values()];
  expect(Array.from(stored!.bytes)).toEqual([...BOM, ...utf8("# Bản nháp\r\n")]);
  expect(channels.filter((channel) => channel.startsWith("desktop:draft"))).toContain("desktop:draft-checkpoint");
  expect(channels.filter((channel) => /office-|engine-call|library-/.test(channel))).toEqual([]);
  session.dispose();
});

it("recovers a draft into the editor and the mounted view shows the recovered text", async () => {
  const { open, drafts, bridge } = localHarness("md", mdBytes);
  const first = open();
  await first.openEditor();
  setText(first, "# Bản nháp\r\n");
  await first.keepDraft();
  first.dispose();
  expect(drafts.size).toBe(1);
  const session = open();
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Doc.md" kind="local" onBack={() => undefined} />);
  await screen.findByTestId("md-editor", {}, { timeout: 15000 });
  fireEvent.click(await screen.findByRole("button", { name: /Khôi phục/ }));
  await waitFor(() => expect(text(session)).toBe("# Bản nháp\r\n"), { timeout: 10000 });
  expect(session.coordinator.getState().state).toBe("dirty");
  expect(await screen.findByTestId("md-editor")).toBeInTheDocument();
  await act(async () => undefined);
});

it("shows the failure state for invalid UTF-8 and never opens the editor", async () => {
  const invalid = new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a]);
  const { open, bridge, files } = localHarness("md", invalid);
  const session = open();
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Bad.md" kind="local" onBack={() => undefined} />);
  expect(await screen.findByTestId("office-open-error", {}, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.queryByTestId("md-editor")).toBeNull();
  expect(files.saved).toHaveLength(0);
});

it("cannot edit a read-only open: setText is inert and Save is refused", async () => {
  const { open, files } = localHarness("html", htmlBytes, { canSave: false });
  const session = open();
  await session.openEditor();
  setText(session, "<p>changed</p>");
  expect(text(session)).toBe(new TextDecoder().decode(htmlBytes));
  expect(session.coordinator.getState().state).not.toBe("dirty");
  expect(session.canSave).toBe(false);
  expect(files.saved).toHaveLength(0);
  session.dispose();
});

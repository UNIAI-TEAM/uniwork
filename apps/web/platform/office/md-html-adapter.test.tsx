// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { OfficeCapabilityEntry, OfficeIdentity, OfficeSerializedOutput } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createTextFormatAdapter } from "./md-html-adapter";
import type { TextDocumentsTransport } from "./text-save-transport";

// A kitchen-sink source: YAML frontmatter, a GFM table, fenced code, raw HTML
// and an HTML comment. Opening and serialising it without an edit must return
// the exact same bytes - the text lane never parses or normalises.
const KITCHEN_SINK = [
  "---",
  "title: Báo cáo",
  "tags: [gfm, frontmatter]",
  "---",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```ts",
  'const value = "<not html>";',
  "```",
  "",
  '<div data-keep="yes">raw <b>HTML</b></div>',
  "<!-- comment: keep -->",
  "",
].join("\n");

const identity: OfficeIdentity = {
  deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws",
  documentId: "doc", generation: 1, baseVersionId: "version-1", baseRevision: "1",
};
const capability = (format: "md" | "html"): OfficeCapabilityEntry => ({
  format, operation: "serialize", host: "web", engineBuild: "genoffice-test",
  contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [],
});

function draftStore(): IndexedDbDraftStore {
  return {
    checkpointEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    rebaseEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
    recoverEncrypted: vi.fn(async () => ({ status: "missing" as const })),
    deleteDurable: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    clearMemory: vi.fn(),
  } as unknown as IndexedDbDraftStore;
}
function keyProvider(): DraftKeyProvider {
  return {
    encrypt: vi.fn(async () => ({ ciphertext: new Uint8Array([1]), wrappedKey: new Uint8Array([2]), checksum: "sha256:1" })),
    decrypt: vi.fn(), recover: vi.fn(), clearMemory: vi.fn(async () => undefined), registerCleanup: vi.fn(() => () => undefined),
  };
}

function documents(bytes: Uint8Array, format: "md" | "html"): TextDocumentsTransport & { uploaded: Blob[] } {
  const uploaded: Blob[] = [];
  void format;
  return {
    uploaded,
    read: vi.fn(async () => bytes),
    upload: vi.fn(async (file: Blob) => {
      uploaded.push(file);
      const data = await readBlob(file);
      return { upload_id: "upload-1", checksum_sha256: await sha256Hex(data), size_bytes: data.length, claim_expires_at: "2099-01-01T00:00:00Z" };
    }),
    // Echo the staged bytes' digest so the transport's receipt cross-check
    // passes, exactly as the real Documents commit route answers.
    commit: vi.fn(async () => {
      const last = uploaded.at(-1);
      const data = last ? await readBlob(last) : new Uint8Array();
      return { document: { id: "doc", revision: "2" }, version: { id: "v2", checksum_sha256: await sha256Hex(data), size_bytes: data.length } };
    }),
  };
}

// jsdom's Blob has no arrayBuffer(); read the staged bytes through FileReader,
// which jsdom does implement, so the assertion still checks real content.
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function adapter(format: "md" | "html", bytes = new TextEncoder().encode(KITCHEN_SINK)) {
  const files = documents(bytes, format);
  const created = createTextFormatAdapter({
    identity,
    session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 },
    format, documents: files, capability: capability(format), title: format === "md" ? "Notes" : "Page",
    draftStore: draftStore(), keyProvider: keyProvider(),
  });
  return { adapter: created, files };
}

describe("web Markdown/HTML format adapter", () => {
  it.each(["md", "html"] as const)("round-trips the raw source byte-identically through serialize (%s)", async (format) => {
    const bytes = new TextEncoder().encode(KITCHEN_SINK);
    const { adapter: created } = adapter(format, bytes);
    await created.open.open();
    expect(created.editor.source?.getText()).toBe(KITCHEN_SINK);
    const output = (await created.session.coordinator.getState()) && (await created.editor.captureSnapshot());
    expect(output.value.text).toBe(KITCHEN_SINK);
    const serialized = await created.session.draft.draftStore && created.session.coordinator.getState();
    void serialized;
    // The transport serializes the captured snapshot; the bytes must be the source bytes.
    const intent = { intentId: "i", idempotencyKey: "k", snapshotGeneration: 1, snapshotFingerprint: "f", snapshot: output.value, operation: "manual_save" as const, createdAt: 0, identity };
    const out = (await created.session.coordinator.getState()) && (await (created as unknown as { editor: { serializeSnapshot(s: unknown): Promise<{ bytes: Uint8Array; checksum: string }> } }).editor.serializeSnapshot(output));
    expect(new TextDecoder().decode(out.bytes)).toBe(KITCHEN_SINK);
    expect(out.checksum).toBe(await sha256Hex(bytes));
    void intent;
    await created.session.dispose();
  });

  it("exposes the standard EditorHandle surface and the SourceTextPort", async () => {
    const { adapter: created } = adapter("md");
    expect(created.editor.format).toBe("md");
    expect(typeof created.editor.open).toBe("function");
    expect(typeof created.editor.captureSnapshot).toBe("function");
    expect(typeof created.editor.getDirtyGeneration).toBe("function");
    expect(typeof created.editor.dispose).toBe("function");
    expect(typeof created.editor.source?.getText).toBe("function");
    expect(typeof created.editor.source?.setText).toBe("function");
    expect(typeof created.editor.source?.subscribe).toBe("function");
    await created.session.dispose();
  });

  it("writes only the raw text on save and reports the engine's asset manifest", async () => {
    // The reference has no bytes staged, so the engine manifest is empty and
    // the reference is dangling: the text keeps it verbatim and no asset is
    // uploaded. The manifest lists assets with bytes, never authored strings.
    const source = "![Anh](assets/fixture-image.png)\n\nEnd\n";
    const { adapter: created, files } = adapter("md", new TextEncoder().encode(source));
    await created.open.open();
    expect(created.editor.getAssetManifest?.()).toEqual({ entries: [] });
    created.editor.source?.setText(source + "more\n");
    created.session.coordinator.markDirty(created.editor.getDirtyGeneration());
    const result = await created.session.coordinator.save("button");
    expect(result.accepted).toBe(true);
    expect(files.uploaded).toHaveLength(1);
    expect(new TextDecoder().decode(await readBlob(files.uploaded[0]!))).toBe(source + "more\n");
    await created.session.dispose();
  });

  it("counts a source edit as dirty and undo restores the previous text", async () => {
    const { adapter: created } = adapter("html");
    await created.open.open();
    expect(created.editor.getDirtyGeneration()).toBe(0);
    created.editor.source?.setText("<!doctype html>\n<p>changed</p>");
    expect(created.editor.getDirtyGeneration()).toBe(1);
    created.editor.undo?.();
    expect(created.editor.source?.getText()).toBe(KITCHEN_SINK);
    await created.session.dispose();
  });

  it("renders the matching view with the adapter's editor, open port and coordinator", async () => {
    const { adapter: created } = adapter("md");
    expect(isValidElement(created.editorView)).toBe(true);
    const props = (created.editorView as { props: Record<string, unknown> }).props;
    expect(props.editor).toBe(created.editor);
    expect(props.documentKey).toBe("doc");
    expect(typeof (props.open as { open: unknown }).open).toBe("function");
    expect(props.capability).toMatchObject({ format: "md", status: "available" });
    await created.session.dispose();
  });

  it("reports a corrupted source as a typed open failure, never a blank", async () => {
    const { adapter: created } = adapter("md", new Uint8Array([0xc3, 0x28]));
    expect(await created.open.open()).toMatchObject({ outcome: "failed", failure_class: "corrupted", format: "md" });
    await created.session.dispose();
  });
});

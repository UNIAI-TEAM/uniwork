// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, isValidElement, StrictMode, useEffect, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeCapabilityEntry, OfficeIdentity, OfficeSerializedOutput } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createTextFormatAdapter } from "./md-html-adapter";
import type { TextDocumentsTransport } from "./text-save-transport";

// S3c: an md mount now really mounts the isolated frame, which opens an asset
// scope through the authenticated transport. Mock that one endpoint so the
// test exercises the renderer + frame policy without a live server; the real
// schemas stay in the loop everywhere else.
vi.mock("@uniwork/core/api/endpoints/office", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/office")>()),
  createPreviewScope: vi.fn(async () => ({
    origin: "https://preview-assets.example",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    assets: [],
  })),
}));

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

initI18n();
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", TestResizeObserver);

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

  it("replaying a retained intent serializes its own snapshot without rewinding the live editor", async () => {
    const source = "first line\n";
    const { adapter: created, files } = adapter("md", new TextEncoder().encode(source));
    await created.open.open();
    // Mint an intent, then fail its commit ambiguously so the coordinator
    // retains it for a replay - exactly the recoverPendingSave path.
    vi.mocked(files.commit).mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const intentText = source + "typed after the intent\n";
    created.editor.source?.setText(intentText);
    created.session.coordinator.markDirty(created.editor.getDirtyGeneration());
    const first = await created.session.coordinator.save("button");
    expect(first.accepted).toBe(false);
    expect(created.session.coordinator.getState().activeIntentId).toBeTruthy();

    // The user keeps typing while the outcome is unknown.
    const typedAfter = intentText + "and more after that\n";
    created.editor.source?.setText(typedAfter);
    created.session.coordinator.markDirty(created.editor.getDirtyGeneration());
    const replay = await created.session.coordinator.save("button");
    expect(replay.accepted).toBe(true);
    // The replay writes the intent's own bytes (its idempotency key binds them)...
    expect(new TextDecoder().decode(await readBlob(files.uploaded.at(-1)!))).toBe(intentText);
    // ...but serializing that snapshot must NOT rewind the live editor.
    expect(created.editor.source?.getText()).toBe(typedAfter);
    await created.session.dispose();
  });

  it("bounds the undo history so a long editing session cannot retain every revision", async () => {
    const { adapter: created } = adapter("md", new TextEncoder().encode("base\n"));
    await created.open.open();
    for (let index = 1; index <= 250; index += 1) created.editor.source?.setText(`base\n${index}\n`);
    // 250 edits push 250 previous values; the cap keeps the newest 100, so the
    // stack bottoms out at the 150th value, not the original document.
    for (let index = 0; index < 100; index += 1) created.editor.undo?.();
    // The stack is exhausted at its bound, not at the original document.
    expect(created.editor.source?.getText()).toBe("base\n150\n");
    created.editor.undo?.();
    expect(created.editor.source?.getText()).toBe("base\n150\n");
    await created.session.dispose();
  });

  it("renders the matching view with the adapter's editor, open port and coordinator", async () => {
    const { adapter: created } = adapter("md");
    expect(isValidElement(created.editorView)).toBe(true);
    const props = (created.editorView as { props: Record<string, unknown> }).props;
    expect((props.editor as { getText?(): string }).getText?.()).toBe(created.editor.getText?.());
    expect(props.editor).not.toBe(created.editor);
    expect(props.documentKey).toBe("doc");
    expect(typeof (props.open as { open: unknown }).open).toBe("function");
    expect(props.capability).toMatchObject({ format: "md", status: "available" });
    await created.session.dispose();
  });

  it("passes an isolated preview port to the HTML view so preview modes are live", async () => {
    // S3b-preview: without this the HTML surface shows "Preview unavailable"
    // in preview / split / present. The adapter builds the port; the view
    // mounts it. HTML gets a renderer-free port: the engine makes the copy.
    const { adapter: created } = adapter("html");
    const props = (created.editorView as { props: Record<string, unknown> }).props;
    const preview = props.preview as { mount?: unknown } | undefined;
    expect(preview).toBeDefined();
    expect(typeof preview?.mount).toBe("function");
    await created.session.dispose();
  });

  it("gives the Markdown port a renderer so an md mount renders instead of refusing (S3c)", async () => {
    // S3c: the host passes renderMarkdown into createOfficePreviewPort, backed
    // by the engine's browser-safe buildMarkdownPreviewCopy. The port therefore
    // accepts an md mount (no "preview runtime is unavailable") and the frame
    // receives safe HTML, not the typed unavailable state.
    const { adapter: created } = adapter("md");
    const props = (created.editorView as { props: Record<string, unknown> }).props;
    const preview = props.preview as { mount(input: unknown): Promise<{ iframe: HTMLIFrameElement; dispose(): void }> };
    const session = await preview.mount({
      container: document.createElement("div"),
      format: "md",
      title: "Notes",
      text: "# heading\n\n<script>alert(1)</script>",
      manifest: { entries: [] },
    });
    expect(session.iframe.srcdoc).toContain("<h1>heading</h1>");
    expect(session.iframe.srcdoc).not.toMatch(/<script>alert/);
    session.dispose();
    await created.session.dispose();
  });

  it("reports a corrupted source as a typed open failure, never a blank", async () => {
    const { adapter: created } = adapter("md", new Uint8Array([0xc3, 0x28]));
    expect(await created.open.open()).toMatchObject({ outcome: "failed", failure_class: "corrupted", format: "md" });
    await created.session.dispose();
  });

  // UNI-928 regression: the views used to dispose the handle in their open
  // effect cleanup, so a StrictMode replay (or a Retry) reopened a dead handle
  // ("text_editor_disposed"). The session owns disposal.
  async function mountStrict(created: ReturnType<typeof adapter>["adapter"]) {
    const container = document.createElement("div");
    document.body.append(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Host(): ReactElement {
      // Mirrors OfficeEditorHost: dispose is deferred a microtask so the
      // StrictMode replay re-arms the flag and only a real unmount releases.
      const mounted = useRef(false);
      useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; queueMicrotask(() => { if (!mounted.current) void created.session.dispose(); }); };
      }, []);
      return created.editorView as ReactElement;
    }
    let root!: Root;
    await act(async () => { root = createRoot(container); root.render(createElement(StrictMode, null, createElement(Host))); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    return { container, root };
  }

  it.each(["md", "html"] as const)("survives a StrictMode double mount and releases the engine once on unmount (%s)", async (format) => {
    await setLocale("en");
    const { adapter: created } = adapter(format);
    const dispose = vi.spyOn(created.editor, "dispose");
    const { container, root } = await mountStrict(created);
    expect(container.querySelector(`[data-testid="${format}-error-state"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="${format}-opening"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="${format}-editor"]`)).not.toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(dispose).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it.each(["md", "html"] as const)("retries a failed read on the same adapter (%s)", async (format) => {
    await setLocale("en");
    const { adapter: created, files } = adapter(format);
    const read = vi.mocked(files.read);
    const succeed = read.getMockImplementation()!;
    read.mockImplementationOnce(() => Promise.reject(new Error("transient")));
    const { container, root } = await mountStrict(created);
    const errorState = container.querySelector(`[data-testid="${format}-error-state"]`);
    expect(errorState).not.toBeNull();
    expect(errorState?.textContent).not.toContain("text_editor_disposed");
    read.mockImplementation(succeed);
    await act(async () => { (errorState!.querySelector("button") as HTMLButtonElement).click(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(container.querySelector(`[data-testid="${format}-opening"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="${format}-editor"]`)).not.toBeNull();
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    container.remove();
  });
});

describe("web HTML visual-edit host (office_html_visual_edit)", () => {
  const PAGE = "<!doctype html><html><head><title>T</title></head><body><main><p>One</p><p>Two</p></main></body></html>";
  type VisualHost = { parseMap(text: string): { elements: Array<{ sid: number; tag: string }> }; revision(): number; applyPatchSet(set: unknown): void };
  const hostOf = (created: { editorView: unknown }) => (created.editorView as { props: { visualEdit?: VisualHost } }).props.visualEdit;

  it("hands the HTML view a host with a real parse map; Markdown gets none", async () => {
    const html = adapter("html", new TextEncoder().encode(PAGE)).adapter;
    await html.open.open();
    const host = hostOf(html)!;
    expect(host.parseMap(PAGE).elements.map((element) => element.tag)).toEqual(["html", "head", "title", "body", "main", "p", "p"]);
    expect(hostOf(adapter("md").adapter)).toBeUndefined();
  });

  it("a visual edit is an ordinary text edit: dirty, undoable, and in the saved bytes", async () => {
    const created = adapter("html", new TextEncoder().encode(PAGE)).adapter;
    await created.open.open();
    const host = hostOf(created)!;
    const first = host.parseMap(PAGE).elements.find((element) => element.tag === "p")!;
    const range = PAGE.indexOf("<p>One</p>");
    expect(first.sid).toBeGreaterThan(0);
    const dirtyBefore = created.editor.getDirtyGeneration();
    host.applyPatchSet({ patches: [{ from: range + 3, to: range + 6, text: "Uno" }], baseVersion: host.revision(), origin: "inspector", label: "set_text" });
    expect(created.editor.source?.getText()).toContain("<p>Uno</p>");
    expect(created.editor.getDirtyGeneration()).toBeGreaterThan(dirtyBefore);
    const snapshot = await created.editor.captureSnapshot();
    const serialized = await created.editor.serializeSnapshot(snapshot);
    expect(new TextDecoder().decode(serialized.bytes)).toContain("<p>Uno</p>");
    created.editor.undo?.();
    expect(created.editor.source?.getText()).toBe(PAGE);
  });

  it("a stale base revision changes nothing", async () => {
    const created = adapter("html", new TextEncoder().encode(PAGE)).adapter;
    await created.open.open();
    const host = hostOf(created)!;
    expect(() => host.applyPatchSet({ patches: [{ from: 0, to: 0, text: "x" }], baseVersion: host.revision() + 7, origin: "inspector", label: "t" })).toThrow();
    expect(created.editor.source?.getText()).toBe(PAGE);
  });
});

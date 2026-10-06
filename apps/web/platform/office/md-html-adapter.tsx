"use client";

import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createHtmlEngine, type HtmlUpstream, type UpstreamParseMap, type UpstreamPatch, type UpstreamPatchError, type UpstreamPatchSet } from "@uniwork/office-engine/html";
import { createMarkdownEngine, type MarkdownUpstream } from "@uniwork/office-engine/markdown";
import type { TextDocumentEngine } from "@uniwork/office-engine/assets";
import { sha256Hex } from "@uniwork/office-contracts";
import { useSession } from "@uniwork/core/auth";
import { getOfficeCapabilities, type OfficeCapabilities } from "@uniwork/core/api/endpoints/office";
import type { OfficeCapabilityEntry, OfficeIdentity, StableSnapshot } from "@uniwork/core/office";
import { HtmlEditor, MarkdownEditor, type HtmlEditorProps, type IsolatedPreviewPort, type MarkdownEditorProps, type TextEditorHandle, type TextOpenFailure, type TextOpenOutcome } from "@uniwork/views/office";
import { createOfficeEditorSession, type BrowserOfficeDraftOptions, type OfficeEditorSession } from "./editor-host-core";
import { OfficeEditorHost, type OfficeEditorHostProps, type OfficeFormatAdapter } from "./editor-host";
import { createTextDocumentsTransport, createTextSaveTransport, TEXT_ENGINE_NAME, type TextDocumentSnapshot, type TextDocumentsTransport, type TextFormat } from "./text-save-transport";
import { renderMarkdownPreview } from "./markdown-preview-copy";
import { createHttpPreviewAssetProxy, createOfficePreviewPort } from "./preview-port";

// The web host's Markdown/HTML format adapter (S3, UNI-928). It mirrors
// docx-adapter.tsx: an engine-backed EditorHandle, the real save transport,
// and the shared editor view, composed by the shared coordinator and the
// protected browser draft lifecycle. The document IS its source text: the
// adapter never parses, normalises or reformats - raw text in, raw text out -
// so a save writes the same bytes the editor holds.

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const BOM_BYTES = [0xef, 0xbb, 0xbf] as const;

/**
 * The undo/redo stacks retain a full copy of the document per edit, and the
 * source view calls `setText` per keystroke. Cap the depth so a large document
 * cannot hold O(edits x size) memory; the oldest history is dropped first.
 * Per-keystroke coalescing is a separate UX question, not a bound.
 */
const MAX_UNDO_ENTRIES = 100;

function pushBounded(stack: string[], value: string): void {
  stack.push(value);
  if (stack.length > MAX_UNDO_ENTRIES) stack.shift();
}

/** The engine's text serialize is identity-encoding: UTF-8 of the source plus
 *  the document's BOM flag, which the engine keeps as an encoding property,
 *  not a character. Mirrored here so a snapshot can be serialized without
 *  touching a live session (see `serializeSnapshot`). */
function encodeSource(text: string, bom: boolean): Uint8Array {
  const body = utf8(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(BOM_BYTES, 0);
  out.set(body, 3);
  return out;
}

/**
 * Browser-side upstream bindings.
 *
 * The vendored asset-lifecycle modules for Markdown/HTML are Electron
 * main-process files: they import node:fs/crypto/path at top level, so the
 * browser bundle cannot resolve them (the G2-06 replay only gets away with it
 * by stubbing every Node builtin to throw). This binding is a copied
 * test-fake (packages/office-engine/src/assets/test-fakes.ts), NOT the
 * vendored upstream, so it is knowingly narrower than the real scanner.
 *
 * What it does NOT implement, relative to upstream's asset-lifecycle:
 *   * no `<!-- -->` HTML-comment skipping (an `<img src>` inside a comment is
 *     scanned as a real reference; upstream's `htmlImageSourceRanges` skips it)
 *   * no `'title'` / `(title)` title forms and no `\]` escapes in
 *     `![alt](src)` - the Markdown image regex accepts only a `"title"`
 *   * no unclosed-fence tolerance (a fence that never closes hides the rest)
 *   * no overlap-ambiguity detection: `validatePatchSet` checks only staleness,
 *     dropping the fake's own bounds/overlap checks
 *   * `buildParseMap` always returns an empty map
 *
 * Impact is ≈zero today: `scanReferences` only feeds `snapshot.references`
 * (unused by this adapter) and the manifest panel, which web never populates.
 * A browser build of the vendored modules MUST land BEFORE M5 (asset carry)
 * or H3+ (`applyPatchSet` / parse map / data-sid) rely on this binding, or an
 * under/over-scan and an always-empty parse map will silently corrupt.
 *
 * Until then, the web host binds a deliberately narrow, browser-safe upstream
 * over the same contract:
 *
 *   * Markdown - `![alt](dest)` and inline `<img src>` outside code fences and
 *     inline code. This is the same scan the engine's own unit fake models.
 *   * HTML - `<img src>` only, matching upstream's `extractDocumentImageSources`
 *     (apps/html/src/main/asset-lifecycle.ts:851). The parse map is empty: the
 *     web surface edits raw source, so no edit path compiles to source patches.
 *
 * A limited scan can only under-carry assets; it can never rewrite the text a
 * save writes, because every save serialises the raw source.
 */
function markdownImageRanges(markdown: string): Array<{ start: number; end: number; source: string; angle: boolean }> {
  const fences: Array<[number, number]> = [];
  for (const match of markdown.matchAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm)) fences.push([match.index, match.index + match[0].length]);
  const inline: Array<[number, number]> = [];
  for (const match of markdown.matchAll(/`+[^`\n]*`+/g)) inline.push([match.index, match.index + match[0].length]);
  const inCode = (index: number) => fences.some(([a, b]) => index >= a && index < b) || inline.some(([a, b]) => index >= a && index < b);
  const ranges: Array<{ start: number; end: number; source: string; angle: boolean }> = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    if (inCode(match.index)) continue;
    const token = match[1]!;
    const start = match.index + match[0].indexOf(token);
    const angle = token.startsWith("<");
    ranges.push({ start: angle ? start + 1 : start, end: angle ? start + token.length - 1 : start + token.length, source: angle ? token.slice(1, -1) : token, angle });
  }
  for (const match of markdown.matchAll(/<img\s[^>]*?src="([^"]*)"/gi)) {
    if (inCode(match.index)) continue;
    const start = match.index + match[0].length - 1 - match[1]!.length;
    ranges.push({ start, end: start + match[1]!.length, source: match[1]!, angle: true });
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function bindMarkdown(): MarkdownUpstream {
  return {
    extractMarkdownImageSources: (markdown) => markdownImageRanges(markdown).map((range) => range.source),
    rewriteMarkdownImageSources(markdown, rewrites) {
      let out = "";
      let cursor = 0;
      for (const range of markdownImageRanges(markdown)) {
        const next = rewrites.get(range.source);
        if (next === undefined) continue;
        const wrap = !range.angle && /[\s()]/.test(next);
        out += markdown.slice(cursor, range.start) + (wrap ? "<" + next + ">" : next);
        cursor = range.end;
      }
      return cursor === 0 ? markdown : out + markdown.slice(cursor);
    },
  };
}

function htmlImageSources(html: string): string[] {
  return [...html.matchAll(/<img\s[^>]*?src="([^"]*)"/gi)].map((match) => match[1]!);
}

function bindHtml(): HtmlUpstream {
  return {
    buildParseMap: (text: string, version: number, previous?: UpstreamParseMap | null): UpstreamParseMap => previous ?? { version, elements: [], bySid: new Map(), errorCount: 0 },
    validatePatchSet: (set: UpstreamPatchSet, currentVersion: number): UpstreamPatchError | null => (set.baseVersion === currentVersion ? null : { kind: "stale", baseVersion: set.baseVersion, currentVersion }),
    applyPatches: (text: string, patches: readonly UpstreamPatch[]) => [...patches].sort((left, right) => left.from - right.from || left.to - right.to).reverse().reduce((out, patch) => out.slice(0, patch.from) + patch.text + out.slice(patch.to), text),
    isDocEmpty: (text) => !/<(?:img|svg|video|audio|canvas|iframe|picture|object|embed)\b/i.test(text) && text.replace(/<(title|script|style)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "").trim() === "",
    extractDocumentImageSources: htmlImageSources,
  };
}

function createEngine(format: TextFormat) {
  return format === "md" ? createMarkdownEngine({ upstream: bindMarkdown() }) : createHtmlEngine({ upstream: bindHtml() });
}

type TextEngine = TextDocumentEngine;

export interface TextFormatAdapterOptions extends BrowserOfficeDraftOptions<TextDocumentSnapshot> {
  format: TextFormat;
  documents: TextDocumentsTransport;
  capability: OfficeCapabilityEntry;
  title: string;
  clipboard?: { readText?(): Promise<string>; writeText?(text: string): Promise<void> };
}

export interface TextFormatAdapter {
  session: OfficeEditorSession<TextDocumentSnapshot>;
  editor: TextEditorHandle<TextDocumentSnapshot>;
  capability: OfficeCapabilityEntry;
  editorView: ReactNode;
  open: { open(signal?: AbortSignal): Promise<TextOpenOutcome> };
  onRecoverSnapshot(snapshot: StableSnapshot<TextDocumentSnapshot>): Promise<void>;
}

function openFailure(documentId: string, format: TextFormat, error: unknown): TextOpenFailure {
  const cause = error as { failureClass?: string; message?: string };
  return { outcome: "failed", document_id: documentId, format, failure_class: (cause.failureClass as TextOpenFailure["failure_class"]) ?? "engine_error", message: cause.message ?? "text_open_failed" };
}

/** The engine-backed handle: `source` is the ONE text source the views read. */
function createTextHandle(options: { engine: TextEngine; format: TextFormat; documentId: string; readBytes(): Promise<Uint8Array> }) {
  let ref: string | null = null;
  let text = "";
  let bom = false;
  let generation = 0;
  let disposed = false;
  let opening: Promise<void> | null = null;
  const past: string[] = [];
  const future: string[] = [];
  const listeners = new Set<(value: string) => void>();
  const emit = () => { for (const listener of listeners) listener(text); };

  const setText = (next: string) => {
    if (next === text) return;
    pushBounded(past, text);
    future.length = 0;
    text = next;
    generation += 1;
    if (ref) options.engine.replaceText(ref, next);
    emit();
  };

  const handle: TextEditorHandle<TextDocumentSnapshot> & {
    openOutcome(): TextOpenOutcome | null;
    serializeSnapshot(snapshot: StableSnapshot<TextDocumentSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
    restoreSnapshot(snapshot: StableSnapshot<TextDocumentSnapshot>): void;
  } = {
    format: options.format,
    source: { getText: () => text, setText, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    clipboard: undefined,
    getText: () => text,
    setText,
    getAssetManifest: () => (ref ? { entries: options.engine.snapshot(ref).manifest.entries.map((entry) => ({ key: entry.key, sha256: entry.sha256, media_type: entry.media_type, origin: entry.origin })) } : { entries: [] }),
    async open() {
      if (disposed) throw new Error("text_editor_disposed");
      if (ref) return;
      opening ??= (async () => {
        const bytes = await options.readBytes();
        if (disposed) throw new Error("text_editor_disposed");
        const outcome = await options.engine.open({ bytes, format: options.format, document_id: options.documentId });
        if (disposed) throw new Error("text_editor_disposed");
        if (outcome.outcome !== "opened") {
          throw Object.assign(new Error(outcome.message ?? "text_open_failed"), { failureClass: outcome.failure_class });
        }
        ref = outcome.document_model_ref;
        bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        text = options.engine.snapshot(ref).text;
        generation = 0;
        emit();
      })();
      try { await opening; } finally { opening = null; }
    },
    getDirtyGeneration: () => generation,
    async captureSnapshot() {
      const value: TextDocumentSnapshot = { text };
      return { generation, fingerprint: await sha256Hex(utf8(text)), value, sizeBytes: utf8(text).length };
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return;
      pushBounded(future, text);
      text = previous;
      generation += 1;
      if (ref) options.engine.replaceText(ref, text);
      emit();
    },
    redo() {
      const next = future.pop();
      if (next === undefined) return;
      pushBounded(past, text);
      text = next;
      generation += 1;
      if (ref) options.engine.replaceText(ref, text);
      emit();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (ref) options.engine.close(ref);
      ref = null;
      listeners.clear();
    },
    async cancel() { /* No background work to stop: edits are synchronous. */ },
    openOutcome: () => (ref ? { outcome: "opened", document_id: options.documentId, document_model_ref: ref, warnings: [] } : null),
    async serializeSnapshot(snapshot) {
      if (disposed) throw new Error("text_editor_disposed");
      if (!ref) throw new Error("text_editor_not_open");
      // Serialize the snapshot's OWN bytes; never mutate the live editor. The
      // coordinator replays a retained intent's snapshot through this port
      // (recoverPendingSave -> runIntent), and the user may have typed after
      // the intent was minted - rewinding `text` here would silently discard
      // those edits from the editor and every `source.subscribe` listener.
      // The engine's text serialize is identity-encoding (UTF-8 + the BOM
      // flag), so encoding the snapshot's text with the session's BOM flag
      // reproduces `engine.serialize` for those bytes exactly.
      const bytes = encodeSource(snapshot.value.text, bom);
      return { bytes, checksum: await sha256Hex(bytes) };
    },
    restoreSnapshot(snapshot) {
      if (disposed || !ref) throw new Error("text_restore_unavailable");
      text = snapshot.value.text;
      options.engine.replaceText(ref, text);
      generation = Math.max(generation, snapshot.generation);
      emit();
    },
  };
  return handle;
}

/**
 * The isolated preview port for one adapter (S3b-preview, UNI-928).
 *
 * Built once per adapter - the views call `mount` when a preview pane becomes
 * visible and `dispose` on unmount - so a re-render never rebuilds the iframe
 * policy. The host owns every sandbox/CSP/asset decision (preview.ts); this
 * only supplies the document scope, the authenticated asset proxy, the theme
 * and the ADR 0027 opt-in. No new dependency, no second iframe policy.
 *
 * HTML is fully wired: the engine builds the preview copy inside the isolated
 * frame (buildHtmlPreviewCopy), so preview / split / present all render.
 *
 * Markdown is wired too: `renderMarkdown` renders the source to safe HTML in
 * the engine lane (buildMarkdownPreviewCopy - a dependency-free subset
 * renderer, because the office boundary gate rejects `@tiptap/*`,
 * `@uniwork/views/office/markdown` and `marked` from apps/web/platform/office),
 * and the same frame pass then resolves local images and applies the isolation
 * policy. An `md` mount renders instead of showing "Preview unavailable".
 */
function createPreviewPort(identity: OfficeIdentity, format: TextFormat): IsolatedPreviewPort {
  return createOfficePreviewPort({
    scope: { document_id: identity.documentId, job_id: `preview:${identity.documentId}` },
    proxy: createHttpPreviewAssetProxy(identity.documentId),
    // Visual-edit (ADR 0027) is HTML-only; the Markdown surface never asks.
    allowVisualEdit: format === "html",
    // Markdown has no engine-side source the frame can render: the host hands
    // the port the engine's browser-safe renderer. HTML already IS its own
    // preview copy, so it takes none.
    renderMarkdown: format === "md" ? renderMarkdownPreview : undefined,
    color_scheme: previewColorScheme(),
  });
}

/** Dark mode is a `.dark` subtree class in this app (globals.css), not a media
 *  query, so read it once when the port is built. */
function previewColorScheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function createTextFormatAdapter(options: TextFormatAdapterOptions): TextFormatAdapter {
  const engine = createEngine(options.format);
  const editor = createTextHandle({ engine, format: options.format, documentId: options.identity.documentId, readBytes: options.documents.read });
  if (options.clipboard) editor.clipboard = options.clipboard;
  // The session (OfficeEditorHost unmount -> session.dispose) owns the real
  // editor's disposal. The views dispose the handle they are given in their
  // open-effect cleanup, which StrictMode replays and Retry re-runs, so they
  // get a handle whose dispose is inert (same as the PPTX adapter).
  const viewEditor: typeof editor = { ...editor, dispose: async () => undefined };
  const transport = createTextSaveTransport({ documentId: options.identity.documentId, format: options.format, documents: options.documents, serialize: (snapshot) => editor.serializeSnapshot(snapshot) });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);
  let opening: Promise<void> | null = null;
  const open = {
    async open(signal?: AbortSignal): Promise<TextOpenOutcome> {
      if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
      try {
        opening ??= editor.open().catch((error: unknown) => { opening = null; throw error; });
        await opening;
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const outcome = editor.openOutcome();
        if (!outcome) throw new Error("text_open_outcome_missing");
        return outcome;
      } catch (error) {
        return openFailure(options.identity.documentId, options.format, error);
      }
    },
  };
  const originalDispose = session.dispose;
  let disposal: Promise<void> | null = null;
  session.dispose = () => disposal ??= (async () => {
    await session.coordinator.cancel();
    await originalDispose();
  })();
  const capability = options.capability;
  const viewProps = {
    documentKey: options.identity.documentId,
    editor: viewEditor,
    open: open as { open(signal?: AbortSignal): Promise<TextOpenOutcome> },
    coordinator: session.coordinator,
    title: options.title,
    // The ONE preview runtime; the view mounts it, this adapter never does.
    preview: createPreviewPort(options.identity, options.format),
  };
  const editorView = options.format === "md"
    ? createElement(MarkdownEditor<TextDocumentSnapshot>, { ...viewProps, capability: { ...capability, format: "md" }, open: open as MarkdownEditorProps<TextDocumentSnapshot>["open"] })
    : createElement(HtmlEditor<TextDocumentSnapshot>, { ...viewProps, capability: { ...capability, format: "html" }, open: open as HtmlEditorProps<TextDocumentSnapshot>["open"] });
  return {
    session, editor, capability, open, editorView,
    async onRecoverSnapshot(snapshot) {
      await open.open();
      editor.restoreSnapshot(snapshot);
      session.coordinator.markDirty(editor.getDirtyGeneration());
    },
  };
}

// ── The thin web hosts (S3) ────────────────────────────────────────────────
// Each host owns its client capability row, exactly like the DOCX host: the
// browser build binds the engine, so the client row is available; the server
// rows are evidence about the service runtime only and become fidelity
// warnings, never a downgrade of the client row.

function serverWarnings(result: OfficeCapabilities | null, documentId: string, format: TextFormat): string[] {
  if (!result || result.documentId !== documentId || result.format !== format) return [];
  return result.operations.filter((row) => !row.supported && row.reason).map((row) => `${row.operation}: ${row.reason}`);
}

function TextOfficeEditorHost({ format, ...props }: OfficeEditorHostProps & { format: TextFormat }) {
  const { document, readonly } = props;
  const { user } = useSession();
  const { t } = useTranslation();
  const unavailable = t(format === "md" ? "office.markdown.capabilityUnavailable" : "office.html.capabilityUnavailable");
  const presentation = useRef({ title: document.title, unavailable });
  presentation.current = { title: document.title, unavailable };
  const [loaded, setLoaded] = useState<{ key: string; adapter?: OfficeFormatAdapter<TextDocumentSnapshot>; capability: OfficeCapabilityEntry } | null>(null);
  const accountId = user?.id;
  const versionId = document.file?.version_id;
  const identity = useMemo<OfficeIdentity | null>(() => accountId && versionId ? {
    deploymentId: "web", accountId, organizationId: document.organization_id,
    workspaceId: document.workspace_id, documentId: document.id, generation: 1,
    baseVersionId: versionId, baseRevision: document.revision,
  } : null, [accountId, document.organization_id, document.workspace_id, document.id, versionId, document.revision]);
  const key = JSON.stringify([identity, readonly, format]);

  useEffect(() => {
    let active = true;
    let adapter: OfficeFormatAdapter<TextDocumentSnapshot> | undefined;
    const load = async () => {
      if (!identity) return;
      let capability: OfficeCapabilityEntry = {
        format, operation: "serialize", host: "web",
        // The text lane runs UniWork's own text-document engine, not the
        // vendored genoffice build; name it honestly.
        engineBuild: TEXT_ENGINE_NAME, contractRevision: "office-editor-host/1",
        status: readonly ? "readonly" : "available",
        reason: readonly ? presentation.current.unavailable : null,
        fidelityWarnings: [],
      };
      try {
        const result = await getOfficeCapabilities(identity.documentId);
        if (!active) return;
        capability = { ...capability, fidelityWarnings: serverWarnings(result, identity.documentId, format) };
      } catch {
        // A capability fetch failure is not an editor failure: no warnings.
      }
      if (!active) return;
      if (readonly) {
        if (active) setLoaded({ key, capability });
        return;
      }
      try {
        adapter = createTextFormatAdapter({
          identity,
          session: { sessionId: identity.accountId, deploymentId: identity.deploymentId, accountId: identity.accountId, generation: identity.generation },
          format,
          documents: createTextDocumentsTransport(identity.documentId),
          capability,
          title: presentation.current.title,
          clipboard: typeof navigator !== "undefined" && navigator.clipboard ? {
            readText: () => navigator.clipboard.readText(),
            writeText: (text: string) => navigator.clipboard.writeText(text),
          } : undefined,
        });
        if (active) setLoaded({ key, adapter, capability });
      } catch {
        if (active) setLoaded({ key, capability: { ...capability, status: "unavailable" } });
      }
    };
    void load();
    return () => { active = false; void adapter?.session.dispose(); };
  }, [identity, key, readonly, format]);

  const current = loaded?.key === key ? loaded : null;
  return <OfficeEditorHost<TextDocumentSnapshot> document={document} wsId={props.wsId} readonly={readonly} breadcrumbs={props.breadcrumbs} className={props.className} formatAdapter={current?.adapter} capability={current?.capability} />;
}

export function MarkdownOfficeEditorHost(props: OfficeEditorHostProps) {
  return <TextOfficeEditorHost {...props} format="md" />;
}

export function HtmlOfficeEditorHost(props: OfficeEditorHostProps) {
  return <TextOfficeEditorHost {...props} format="html" />;
}

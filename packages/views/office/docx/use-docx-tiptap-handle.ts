"use client";

// The concrete DocxEditorHandle: a headless TipTap Editor instance (no DOM
// until renderSurface() mounts it — see the ordering note below) bound to
// the G2 DocxAdapter. Host-agnostic: the only `document` use is the vendored
// renderer stylesheet mount and the host theme class, both of which any DOM
// host supplies (desktop's Electron renderer is a DOM host too).
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createElement, useEffect, useState, type ReactNode } from "react";
import { installDocxRendererStyles } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import type { StableSnapshot } from "@uniwork/core/office";
import { blocksToDoc } from "./docx-doc-convert";
import { applyDocxSnapshot, encodeDocxSource, decodeDocxSource } from "./docx-save-bridge";
import { docxExtensions, type DocxBlockAttrs } from "./docx-schema";
import type { DocxEditorHandle, DocxFormatCommands, DocxFormatState, DocxOpenSuccess, DocxSelection, DocxSelectionPort } from "./types";

/**
 * G3-04c T-01 (UNI-823): the renderer sheet paints the document for a light UI
 * by default; its `.page-dark` remaps (authored colour/shading twins, dark
 * paper) switch on with the host theme. UniWork drives theming with the `dark`
 * class (next-themes) on <html>, so the surface follows it and re-renders when
 * the class flips.
 */
function useDarkSurface(): boolean {
  const read = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return undefined;
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function DocxRendererSurface({ editor }: { editor: Editor }): ReactNode {
  const dark = useDarkSurface();
  return createElement(
    "div",
    { className: "docx-surface flex min-h-0 min-w-0 flex-1", "data-testid": "docx-surface" },
    createElement(
      "div",
      { className: dark ? "workspace page-dark" : "workspace" },
      createElement(
        "div",
        { className: "editor-scroll min-h-0 min-w-0 flex-1", "data-testid": "docx-document-surface" },
        createElement(
          "div",
          { className: "doc-zoom view-print" },
          createElement("div", { className: "page-wrap" }, createElement(EditorContent, { editor })),
        ),
      ),
    ),
  );
}

function nextListId(): string {
  return "new-list-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
}

export interface DocxTiptapSnapshot {
  doc: JSONContent;
  sourceBase64: string;
}

export interface DocxOpenError extends Error {
  failureClass?: string;
  engineError?: string | null;
}

export interface DocxTiptapHandleOptions {
  adapter: DocxAdapter;
  documentId: string;
  readOnly?: boolean;
  /** Supplies the open bytes; the view never reads a document store itself. */
  readBytes(): Promise<Uint8Array>;
}

export interface DocxTiptapHandle extends DocxEditorHandle<DocxTiptapSnapshot> {
  modelRef(): string | null;
  openOutcome(): DocxOpenSuccess | null;
  serializeSnapshot(snapshot: StableSnapshot<DocxTiptapSnapshot>): Promise<{ bytes: Uint8Array; checksum: string; warnings?: unknown[] }>;
  restoreSnapshot(snapshot: StableSnapshot<DocxTiptapSnapshot>): void;
}

async function fingerprintOf(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return String(bytes.length);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createDocxTiptapHandle(options: DocxTiptapHandleOptions): DocxTiptapHandle {
  let tiptapEditor: Editor | null = null;
  let ref: string | null = null;
  let sourceBase64 = "";
  let openedOutcome: DocxOpenSuccess | null = null;
  let generation = 0;
  let disposed = false;
  const selectionListeners = new Set<(selection: DocxSelection | null) => void>();
  const dirtyListeners = new Set<(generation: number) => void>();

  const currentSelection = (): DocxSelection | null => {
    if (!tiptapEditor) return null;
    const { from, to } = tiptapEditor.state.selection;
    const resolved = tiptapEditor.state.doc.resolve(Math.min(from, tiptapEditor.state.doc.content.size));
    const attrs = resolved.parent.attrs as Partial<DocxBlockAttrs>;
    const blockId = attrs.docxIndex !== undefined && attrs.docxIndex !== null ? String(attrs.docxIndex) : null;
    return { blockId, from, to };
  };

  const emitSelection = () => {
    const next = currentSelection();
    for (const listener of selectionListeners) listener(next);
  };

  const selection: DocxSelectionPort = {
    getSelection: currentSelection,
    subscribe: (listener) => {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
  };

  const formatListeners = new Set<(state: DocxFormatState) => void>();
  const currentFormatState = (): DocxFormatState => {
    if (!tiptapEditor) return { bold: false, italic: false, underline: false, headingLevel: null, listKind: null };
    const node = tiptapEditor.state.selection.$from.parent;
    const attrs = node.attrs;
    return {
      bold: tiptapEditor.isActive("bold"),
      italic: tiptapEditor.isActive("italic"),
      underline: tiptapEditor.isActive("underline"),
      headingLevel: node.type.name === "docHeading" ? (attrs.level ?? 1) : null,
      listKind: node.type.name === "docListItem" ? (attrs.kind ?? "bullet") : null,
    };
  };
  const emitFormatState = () => {
    const next = currentFormatState();
    for (const listener of formatListeners) listener(next);
  };
  const setBlockType = (type: string, patch: Record<string, unknown>) => {
    if (!tiptapEditor) return;
    const attrs = tiptapEditor.state.selection.$from.parent.attrs;
    tiptapEditor.chain().focus().setNode(type, { ...attrs, ...patch }).run();
  };
  const commands: DocxFormatCommands = {
    getState: currentFormatState,
    subscribe: (listener) => {
      formatListeners.add(listener);
      return () => formatListeners.delete(listener);
    },
    toggleBold: () => tiptapEditor?.chain().focus().toggleMark("bold").run(),
    toggleItalic: () => tiptapEditor?.chain().focus().toggleMark("italic").run(),
    toggleUnderline: () => tiptapEditor?.chain().focus().toggleMark("underline").run(),
    setHeading: (level) => {
      if (level !== null && currentFormatState().headingLevel === level) return;
      // The OOXML writer prioritizes an explicit paragraph style over the
      // heading level. Drop the old style when changing the semantic type.
      if (level === null) setBlockType("docParagraph", { styleId: null });
      else setBlockType("docHeading", { level, styleId: null, outlineOnly: false });
    },
    toggleList: (kind) => {
      const state = currentFormatState();
      if (state.listKind === kind) setBlockType("docParagraph", {});
      else setBlockType("docListItem", { kind, numId: nextListId(), ilvl: 0 });
    },
  };

  const handle: DocxTiptapHandle = {
    format: "docx",
    selection,
    commands,
    async open() {
      if (disposed) throw new Error("docx_editor_disposed");
      if (ref) return;
      const bytes = await options.readBytes();
      if (disposed) throw new Error("docx_editor_disposed");
      const outcome = await options.adapter.open({ bytes, format: "docx", document_id: options.documentId });
      if (disposed) {
        if (outcome.outcome === "opened") options.adapter.release(outcome.document_model_ref);
        throw new Error("docx_editor_disposed");
      }
      if (outcome.outcome !== "opened") {
        const error: DocxOpenError = Object.assign(new Error(outcome.message ?? "docx_open_failed"), {
          failureClass: outcome.failure_class,
          engineError: "engine_error" in outcome ? outcome.engine_error : undefined,
        });
        throw error;
      }
      ref = outcome.document_model_ref;
      openedOutcome = outcome;
      sourceBase64 = encodeDocxSource(bytes);
      installDocxRendererStyles();
      tiptapEditor = new Editor({
        extensions: docxExtensions(options.adapter.numberingOf(ref)),
        content: blocksToDoc(options.adapter.blocksOf(ref)),
        editable: !options.readOnly,
        // Upstream's App marks the editor root `.doc-page`; the repackaged
        // vendored sheet keys the paper and its document rules on that class.
        editorProps: { attributes: { class: "doc-page" } },
        onTransaction: ({ transaction }) => {
          if (transaction.docChanged) {
            generation += 1;
            for (const listener of dirtyListeners) listener(generation);
          }
          emitSelection();
          emitFormatState();
        },
      });
      generation = 0;
    },
    getDirtyGeneration: () => generation,
    subscribeDirty(listener) {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },
    async captureSnapshot() {
      if (!tiptapEditor || !ref) throw new Error("docx_snapshot_unavailable");
      const value: DocxTiptapSnapshot = { doc: tiptapEditor.getJSON(), sourceBase64 };
      return { generation, fingerprint: await fingerprintOf(value), value };
    },
    undo() {
      tiptapEditor?.commands.undo();
    },
    redo() {
      tiptapEditor?.commands.redo();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      tiptapEditor?.destroy();
      tiptapEditor = null;
      if (ref) options.adapter.release(ref);
      ref = null;
      openedOutcome = null;
      selectionListeners.clear();
      formatListeners.clear();
      dirtyListeners.clear();
    },
    renderSurface(): ReactNode {
      if (!tiptapEditor) return null;
      return createElement(DocxRendererSurface, { editor: tiptapEditor });
    },
    modelRef: () => ref,
    openOutcome: () => openedOutcome,
    async serializeSnapshot(snapshot) {
      if (disposed || options.readOnly) throw new Error("docx_save_unavailable");
      const opened = await options.adapter.open({ bytes: decodeDocxSource(snapshot.value.sourceBase64), format: "docx", document_id: options.documentId });
      if (opened.outcome !== "opened") throw new Error(opened.message ?? "docx_snapshot_open_failed");
      const saveRef = opened.document_model_ref;
      try {
        applyDocxSnapshot(options.adapter, saveRef, snapshot.value.doc, options.adapter.blocksOf(saveRef));
        return await options.adapter.serialize({ document_model_ref: saveRef, format: "docx" });
      } finally {
        options.adapter.release(saveRef);
      }
    },
    restoreSnapshot(snapshot) {
      if (!tiptapEditor || !ref || options.readOnly) throw new Error("docx_restore_unavailable");
      if (snapshot.value.sourceBase64 !== sourceBase64) throw new Error("docx_draft_base_mismatch");
      tiptapEditor.commands.setContent(snapshot.value.doc);
      generation = Math.max(generation, snapshot.generation);
      for (const listener of dirtyListeners) listener(generation);
    },
  };
  return handle;
}

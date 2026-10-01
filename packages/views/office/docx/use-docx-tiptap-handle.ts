"use client";

// The concrete DocxEditorHandle: a headless TipTap Editor instance (no DOM
// until renderSurface() mounts it — see the ordering note below) bound to
// the G2 DocxAdapter. Host-agnostic: nothing here reaches `window`/`document`
// except what TipTap's own DOM renderer needs once mounted, same as any
// other React DOM content (desktop's Electron renderer is a DOM host too).
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import type { StableSnapshot } from "@uniwork/core/office";
import { blocksToDoc } from "./docx-doc-convert";
import { applyDocxSnapshot, encodeDocxSource, decodeDocxSource } from "./docx-save-bridge";
import { docxExtensions, type DocxBlockAttrs } from "./docx-schema";
import type { DocxEditorHandle, DocxFormatCommands, DocxFormatState, DocxSelection, DocxSelectionPort } from "./types";

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
  let generation = 0;
  let disposed = false;
  const selectionListeners = new Set<(selection: DocxSelection | null) => void>();

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
      sourceBase64 = encodeDocxSource(bytes);
      tiptapEditor = new Editor({
        extensions: docxExtensions(),
        content: blocksToDoc(options.adapter.blocksOf(ref)),
        editable: !options.readOnly,
        onTransaction: ({ transaction }) => {
          if (transaction.docChanged) generation += 1;
          emitSelection();
          emitFormatState();
        },
      });
      generation = 0;
    },
    getDirtyGeneration: () => generation,
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
      selectionListeners.clear();
      formatListeners.clear();
    },
    renderSurface(): ReactNode {
      if (!tiptapEditor) return null;
      return createElement(EditorContent, {
        editor: tiptapEditor,
        className: "docx-prose min-h-[24rem] w-full max-w-4xl focus:outline-none",
      });
    },
    modelRef: () => ref,
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
    },
  };
  return handle;
}

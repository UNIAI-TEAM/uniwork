"use client";

// The concrete DocxEditorHandle: a headless TipTap Editor instance (no DOM
// until renderSurface() mounts it — see the ordering note below) bound to
// the G2 DocxAdapter. Host-agnostic: nothing here reaches `window`/`document`
// except what TipTap's own DOM renderer needs once mounted, same as any
// other React DOM content (desktop's Electron renderer is a DOM host too).
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import { blocksToDoc, computeDesiredList } from "./docx-doc-convert";
import { reconcileDocxPlan } from "./docx-reconcile";
import { docxExtensions, type DocxBlockAttrs } from "./docx-schema";
import type { DocxEditorHandle, DocxFormatCommands, DocxFormatState, DocxSelection, DocxSelectionPort } from "./types";

function nextListId(): string {
  return "new-list-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
}

export interface DocxTiptapSnapshot {
  /** Fingerprint/draft-recovery payload only — the real save bytes come
   * from the adapter's own plan via its serialize(), not from this value. */
  doc: unknown;
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
  /** The live session ref once open() has succeeded, for a host transport to
   * call adapter.serialize({document_model_ref, format: "docx"}) with. */
  modelRef(): string | null;
  /** The host transport calls this right after a successful adapter.serialize
   * — the two-save rule rebased the model, so the live doc's docxIndex
   * attrs and the pristine baseline both need to catch up. Resets the PM
   * doc to the freshly-saved blocks (a known simplification: cursor and
   * undo history restart at a save boundary). */
  refreshAfterSave(): void;
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
  let pristineDocxIndexes: number[] = [];
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
    const attrs = tiptapEditor.state.selection.$from.parent.attrs as Partial<DocxBlockAttrs>;
    return {
      bold: tiptapEditor.isActive("bold"),
      italic: tiptapEditor.isActive("italic"),
      underline: tiptapEditor.isActive("underline"),
      headingLevel: attrs.blockKind === "heading" ? (attrs.level ?? 1) : null,
      listKind: attrs.blockKind === "listItem" ? (attrs.list?.kind ?? "bullet") : null,
    };
  };
  const emitFormatState = () => {
    const next = currentFormatState();
    for (const listener of formatListeners) listener(next);
  };
  const setBlockAttrs = (patch: Partial<DocxBlockAttrs>) => {
    tiptapEditor?.chain().focus().updateAttributes("docxBlock", patch).run();
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
      if (level === null) setBlockAttrs({ blockKind: "paragraph", level: null, list: null });
      else setBlockAttrs({ blockKind: "heading", level, list: null });
    },
    toggleList: (kind) => {
      const state = currentFormatState();
      if (state.listKind === kind) setBlockAttrs({ blockKind: "paragraph", level: null, list: null });
      else setBlockAttrs({ blockKind: "listItem", level: null, list: { kind, numId: nextListId(), ilvl: 0 } });
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
      pristineDocxIndexes = options.adapter.visibleIndexes(ref);
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
      const liveRef = ref;
      const blocks = options.adapter.blocksOf(liveRef);
      const byIndex = new Map(blocks.filter((b) => !b.hidden && b.docxIndex !== null).map((b) => [b.docxIndex as number, b]));
      const desired = computeDesiredList(tiptapEditor.state.doc, byIndex);
      reconcileDocxPlan(options.adapter, liveRef, pristineDocxIndexes, desired);
      const value: DocxTiptapSnapshot = { doc: tiptapEditor.getJSON() };
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
    refreshAfterSave() {
      if (!tiptapEditor || !ref) return;
      pristineDocxIndexes = options.adapter.visibleIndexes(ref);
      tiptapEditor.commands.setContent(blocksToDoc(options.adapter.blocksOf(ref)));
      generation = 0;
    },
  };
  return handle;
}

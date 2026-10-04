"use client";

// The concrete DocxEditorHandle: a headless TipTap Editor instance (no DOM
// until renderSurface() mounts it â€” see the ordering note below) bound to
// the G2 DocxAdapter. Host-agnostic: the only `document` use is the vendored
// renderer stylesheet mount and the host theme class, both of which any DOM
// host supplies (desktop's Electron renderer is a DOM host too).
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
// Pulls in the UndoRedo command typings (chain().undo()/redo()) for every
// consuming program; the desktop host does not resolve them otherwise.
import type {} from "@tiptap/starter-kit";
import { createElement, useEffect, useState, type ReactNode } from "react";
import { installDocxRendererStyles, pmDocOptions, setNoteNumFmts, type RendererParsed } from "@uniwork/office-upstream/docs-renderer-editor";
import type { DocxAdapter, DocxCommentInfo, DocxEdit } from "@uniwork/office-engine/docx";
import type { StableSnapshot } from "@uniwork/core/office";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "./commands";
import type { DocxNotesSnapshot } from "./commands/notes";
import type { DocxNumberingSnapshot } from "./commands/numbering";
import type { DocxPageDecorEdit } from "./commands/page-decor";
import type { DocxPageSetupEdit } from "./commands/page-setup";
import type { DocxProtectionEdit } from "./commands/protect";
import { blocksToDoc } from "./docx-doc-convert";
import { docxDocumentLang, installDocxDocumentStyles } from "./docx-doc-styles";
import { prepareDocxHeadingStyles } from "./docx-heading-styles";
import { DocxNoteAreas } from "./docx-note-areas";
import { attachDocxPagination, createDocxPaginationSpec, type DocxPaginationSpec } from "./docx-pagination";
import { applyDocxSnapshot, encodeDocxSource, decodeDocxSource } from "./docx-save-bridge";
import { docxExtensions, type DocxBlockAttrs } from "./docx-schema";
// B1 (UNI-924): the image layer rides inside the editing surface â€” the insert
// entry and the inspector for the selected picture.
import { DocxImageLayer } from "./image/docx-image-layer";
import type { DocxEditorHandle, DocxOpenSuccess, DocxSelection, DocxSelectionPort } from "./types";

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

function DocxRendererSurface({ editor, pagination, readOnly }: { editor: Editor; pagination: DocxPaginationSpec | null; readOnly: boolean }): ReactNode {
  const dark = useDarkSurface();
  // T-02: attach the pagination driver once the surface (and therefore the
  // editor DOM inside .doc-zoom) is mounted; Strict Mode replays are safe.
  useEffect(() => {
    if (!pagination) return undefined;
    const paginator = attachDocxPagination(editor, pagination);
    return () => paginator.dispose();
  }, [editor, pagination]);
  return createElement(
    "div",
    { className: "relative flex min-h-0 min-w-0 flex-1" },
    createElement(
      "div",
      { className: "docx-surface flex min-h-0 min-w-0 flex-1", "data-testid": "docx-surface" },
      createElement(
        "div",
        { className: dark ? "workspace min-w-0 page-dark" : "workspace min-w-0" },
        createElement(
          "div",
          {
            className: "editor-scroll min-h-0 min-w-0 flex-1",
            "data-testid": "docx-document-surface",
            // Keep the scrolling contents opaque so Chromium can use LCD text
            // antialiasing on the paper gutter. `--canvas` is supplied by the
            // upstream light/dark renderer theme in both modes.
            style: { backgroundColor: "var(--canvas)", backgroundAttachment: "local" },
          },
          createElement(
            "div",
            { className: "doc-zoom view-print" },
            createElement(
              "div",
              { className: "page-wrap" },
              createElement(EditorContent, { editor }),
              pagination && createElement(DocxNoteAreas, { editor, parsed: pagination.parsedDoc as RendererParsed }),
              // First page's header/footer strips land here (no page gap above
              // page 1); React owns the host, the paginator only its children.
              createElement("div", {
                className: "docx-page-hf-host",
                "data-testid": "docx-page-hf-host",
                style: { position: "absolute", inset: 0, pointerEvents: "none" },
              }),
            ),
          ),
        ),
      ),
    ),
    // B1 (UNI-924): sibling of the scope root on purpose â€” the vendored
    // renderer sheet is scoped to .docx-surface and must not restyle chrome.
    createElement(DocxImageLayer, { editor, readOnly }),
  );
}

export interface DocxTiptapSnapshot {
  doc: JSONContent;
  sourceBase64: string;
  /** The authoritative comment list at capture (B2) â€” present only when it
   * differs from the open base parse's own list (F3): serializeSnapshot then
   * applies it as a set_comments op before the block plan, while an unchanged
   * list omits the option so word/comments.xml keeps its exact bytes. */
  comments?: DocxCommentInfo[];
  /** The notes snapshot at capture (B3): footnote/endnote edits are list
   * edits, so serializeSnapshot applies a set_notes op per edited kind before
   * the block plan, and restoreSnapshot re-seeds the lists + flags. */
  notes?: DocxNotesSnapshot;
  /** The pending page-setup edits at capture (B4): section properties live
   * outside the document, so serializeSnapshot replays them as
   * set_section_properties ops after the block plan, and restoreSnapshot
   * re-seeds them. */
  pageSetup?: DocxPageSetupEdit[];
  /** The pending numbering-part edits at capture (B5): new definitions and
   * restart nums for the list items the doc plan references, replayed as
   * insert_numbering_def / restart_numbering ops; restoreSnapshot re-overlays
   * their markers (the editor storage is per-instance). */
  numbering?: DocxNumberingSnapshot;
  /** The pending page-decoration ops at capture (B6): page colour, watermark,
   * theme colours/fonts and per-section border boxes live outside the document,
   * so serializeSnapshot replays them onto the save session after the block
   * plan and restoreSnapshot re-seeds them. */
  pageDecor?: DocxPageDecorEdit[];
  /** The pending protection edit at capture (C3): w:documentProtection /
   * w:writeProtection live in word/settings.xml, so serializeSnapshot replays
   * the edit as set_protection / set_write_protection ops after the block plan
   * and restoreSnapshot re-seeds it. */
  protection?: DocxProtectionEdit;
  /** The pending header/footer edits at capture (A13): the header/footer
   * parts live outside the document body, so serializeSnapshot replays them as
   * set_header_footer / set_title_pg / set_even_odd_headers ops after the block
   * plan and restoreSnapshot re-seeds them. */
  headerFooter?: DocxEdit[];
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
  /** The composed seam (base + every wave-A area factory) so hosts reach area
   * commands and state without re-deriving the runtime type. */
  commands: DocxCommandRuntime;
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

/** F3: the comment list needs the part rewritten exactly when it differs from
 * the base parse's own list (the bytes every save replays onto). Compared over
 * the save-relevant fields, in list order â€” the regenerated part's order. */
function commentsEdited(current: DocxCommentInfo[], base: DocxCommentInfo[]): boolean {
  return JSON.stringify(current) !== JSON.stringify(base);
}

export function createDocxTiptapHandle(options: DocxTiptapHandleOptions): DocxTiptapHandle {
  let tiptapEditor: Editor | null = null;
  let ref: string | null = null;
  let sourceBase64 = "";
  let openedOutcome: DocxOpenSuccess | null = null;
  let paginationSpec: DocxPaginationSpec | null = null;
  let generation = 0;
  let lastCommentsRevision = 0;
  let lastNotesRevision = 0;
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

  // The base commands and the wave-A area factories live in ./commands; this
  // handle only mounts their runtime over the TipTap instance.
  const commandRuntime = createDocxCommandRuntime(() => tiptapEditor);

  const handle: DocxTiptapHandle = {
    format: "docx",
    selection,
    commands: commandRuntime,
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
      const parsed = options.adapter.parsedOf(ref);
      const noteProps = parsed as { footnoteProps?: { numFmt?: string }; endnoteProps?: { numFmt?: string } };
      setNoteNumFmts({ footnote: noteProps.footnoteProps, endnote: noteProps.endnoteProps });
      // T: the document's own styles.xml + theme rules (display-only).
      installDocxDocumentStyles(parsed);
      paginationSpec = createDocxPaginationSpec(parsed);
      const docLang = docxDocumentLang(parsed);
      tiptapEditor = new Editor({
        extensions: docxExtensions(options.adapter.numberingOf(ref)),
        content: blocksToDoc(options.adapter.blocksOf(ref), paginationSpec.sections, pmDocOptions(parsed as { compatibilityMode?: number })),
        editable: !options.readOnly,
        // Upstream's App marks the editor root `.doc-page`; the repackaged
        // vendored sheet keys the paper and its document rules on that class.
        editorProps: { attributes: { class: "doc-page", ...(docLang ? { lang: docLang } : {}) } },
        onTransaction: ({ transaction }) => {
          // B2 fix (F1): comment mutations are list edits. Resolve/reopen â€” and
          // a delete whose anchors are already gone â€” leave the document
          // untouched (the controller dispatches an empty transaction), so the
          // docChanged gate alone would leave them invisible to the save
          // coordinator and the save would refuse as `clean`. The comments
          // area's monotonic revision folds into the same generation, so
          // subscribeDirty reaches coordinator.markDirty for these edits too.
          const commentsRevision = commandRuntime.docxCommentsRevision();
          const commentsChanged = commentsRevision !== lastCommentsRevision;
          lastCommentsRevision = commentsRevision;
          // B3 fix (F1): the same fold for the notes lists â€” a note-text-only
          // edit or a delete whose markers are already gone is a list edit.
          const notesRevision = commandRuntime.docxNotesRevision();
          const notesChanged = notesRevision !== lastNotesRevision;
          lastNotesRevision = notesRevision;
          if (transaction.docChanged || commentsChanged || notesChanged) {
            generation += 1;
            for (const listener of dirtyListeners) listener(generation);
          }
          emitSelection();
          commandRuntime.emitState();
        },
      });
      generation = 0;
      // B2: the open parse's comment list seeds the runtime; the comments
      // panel and the snapshot read it from there, never from the adapter.
      commandRuntime.seedDocxComments(parsed.comments ?? []);
      // B3: same for the footnote/endnote parts (marker numbers follow body
      // reference order, the vendored noteNumbersOf rule).
      commandRuntime.seedDocxNotes(parsed.footnotes ?? [], parsed.endnotes ?? []);
      // B4: the page-setup dialog's section list, from the same parse.
      commandRuntime.seedDocxPageSetup(parsed);
      // B6: the page-decoration dialog's read state, from the same parse.
      commandRuntime.seedDocxPageDecor(parsed);
      // C3: the protect panel's state â€” the document's own restriction and
      // password-to-modify tags, from the same parse.
      commandRuntime.seedDocxProtection(parsed);
      // A13: the header/footer dialog's six-slot read state, from the same parse.
      commandRuntime.seedDocxHeaderFooter(parsed);
      commandRuntime.emitState();
    },
    getDirtyGeneration: () => generation,
    subscribeDirty(listener) {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },
    async captureSnapshot() {
      if (!tiptapEditor || !ref) throw new Error("docx_snapshot_unavailable");
      // F3: only an edited list may reach SaveOptions. An unchanged list (or no
      // comments at all) omits the option, so patch.ts:888 never regenerates
      // word/comments.xml and no comment-free document gains an empty part.
      const comments = commandRuntime.listDocxComments();
      const baseComments = options.adapter.parsedOf(ref).comments ?? [];
      const value: DocxTiptapSnapshot = {
        doc: tiptapEditor.getJSON(),
        sourceBase64,
        ...(commentsEdited(comments, baseComments) ? { comments } : {}),
        notes: commandRuntime.snapshotDocxNotes(),
        pageSetup: commandRuntime.listDocxPageSetupEdits(),
        numbering: commandRuntime.listDocxNumberingEdits(),
        pageDecor: commandRuntime.listDocxPageDecorEdits(),
        protection: commandRuntime.snapshotDocxProtection(),
        headerFooter: commandRuntime.listDocxHeaderFooterEdits(),
      };
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
      paginationSpec = null;
      if (ref) options.adapter.release(ref);
      ref = null;
      openedOutcome = null;
      selectionListeners.clear();
      commandRuntime.clearListeners();
      dirtyListeners.clear();
    },
    renderSurface(): ReactNode {
      if (!tiptapEditor) return null;
      return createElement(DocxRendererSurface, { editor: tiptapEditor, pagination: paginationSpec, readOnly: options.readOnly === true });
    },
    modelRef: () => ref,
    openOutcome: () => openedOutcome,
    async serializeSnapshot(snapshot) {
      if (disposed || options.readOnly) throw new Error("docx_save_unavailable");
      const opened = await options.adapter.open({ bytes: decodeDocxSource(snapshot.value.sourceBase64), format: "docx", document_id: options.documentId });
      if (opened.outcome !== "opened") throw new Error(opened.message ?? "docx_snapshot_open_failed");
      let saveRef = opened.document_model_ref;
      try {
        const styledSource = await prepareDocxHeadingStyles(options.adapter, saveRef, snapshot.value.doc);
        if (styledSource) {
          options.adapter.release(saveRef);
          const prepared = await options.adapter.open({ bytes: styledSource, format: "docx", document_id: options.documentId });
          if (prepared.outcome !== "opened") throw new Error(prepared.message ?? "docx_heading_styles_open_failed");
          saveRef = prepared.document_model_ref;
        }
        applyDocxSnapshot(options.adapter, saveRef, snapshot.value.doc, options.adapter.blocksOf(saveRef), snapshot.value.comments, snapshot.value.notes);
        // B4: page setup is not part of the doc plan; replay the pending
        // per-section edits onto the same save session after the block plan.
        commandRuntime.applyDocxPageSetupEdits(options.adapter, saveRef);
        // B5: same for the numbering part â€” the new definitions/restart nums
        // the block plan's list items point at.
        commandRuntime.applyDocxNumberingEdits(options.adapter, saveRef);
        // B6: page decoration â€” colour/watermark/theme ride SaveOptions, the
        // border boxes rewrite their sections' sectPr slices.
        commandRuntime.applyDocxPageDecorEdits(options.adapter, saveRef);
        // C3: the protection edit â€” set_protection / set_write_protection
        // rewrite word/settings.xml on the same save session.
        commandRuntime.applyDocxProtectionEdit(options.adapter, saveRef);
        // A13: header/footer - the parts live outside the body plan, so replay
        // the pending edits onto the same save session.
        commandRuntime.applyDocxHeaderFooterEdits(options.adapter, saveRef);
        return await options.adapter.serialize({ document_model_ref: saveRef, format: "docx" });
      } finally {
        options.adapter.release(saveRef);
      }
    },
    restoreSnapshot(snapshot) {
      if (!tiptapEditor || !ref || options.readOnly) throw new Error("docx_restore_unavailable");
      if (snapshot.value.sourceBase64 !== sourceBase64) throw new Error("docx_draft_base_mismatch");
      tiptapEditor.commands.setContent(snapshot.value.doc);
      // A snapshot without comments was captured clean (F3), so the draft's
      // base parse still owns the list; an edited draft restores its own.
      commandRuntime.seedDocxComments(
        snapshot.value.comments ?? options.adapter.parsedOf(ref).comments ?? [],
      );
      // A draft captured before the notes field restores the open parse's own
      // lists (its base is the same source bytes â€” asserted above).
      const notes = snapshot.value.notes;
      if (notes) commandRuntime.restoreDocxNotes(notes);
      else {
        const parsed = options.adapter.parsedOf(ref);
        commandRuntime.seedDocxNotes(parsed.footnotes ?? [], parsed.endnotes ?? []);
      }
      commandRuntime.restoreDocxPageSetupEdits(snapshot.value.pageSetup);
      commandRuntime.restoreDocxNumberingEdits(snapshot.value.numbering);
      commandRuntime.restoreDocxPageDecorEdits(snapshot.value.pageDecor);
      commandRuntime.restoreDocxProtection(snapshot.value.protection);
      commandRuntime.restoreDocxHeaderFooterEdits(snapshot.value.headerFooter);
      generation = Math.max(generation, snapshot.generation);
      for (const listener of dirtyListeners) listener(generation);
    },
  };
  return handle;
}

"use client";

/**
 * MarkdownEditorWysiwyg — the visual editor half of the Markdown surface.
 *
 * It is a controlled view over ONE text source: the `SourceTextPort` on the
 * caller's `TextEditorHandle`. Mounting parses that port's current text into
 * the editor; every edit serialises back through `setText`; and a text change
 * arriving from the source editor (or the save coordinator) is parsed back in.
 * Toggling source <-> visual therefore round-trips through the same bytes, and
 * the two views can never drift.
 *
 * The visual editor owns no document state of its own: no store, no draft, no
 * transport. Save/checkpoint goes only through the injected save coordinator,
 * never from here. No checkpoint is requested mid-IME composition (a Vietnamese
 * IME commits a word over several keystrokes; snapshotting mid-composition would
 * persist a half-typed word).
 *
 * Scope: the editor core only. The toolbar (M2), slash menu (M3), code /
 * diagram / math pickers (M4), images (M5), outline and front matter panels
 * (M6), find (M7) and print (M8) mount around it; `onEditorReady` is the hook
 * they use to reach the live TipTap instance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { mergeAttributes, type DOMOutputSpec, type JSONContent } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { createMarkdownEditorExtensions } from "./extensions";
import { createMarkdownImageExtension } from "./image-view";
import { createMarkdownImageUploadExtension, type MarkdownImageUploader } from "./image-upload";
import { MarkdownImageScopeProvider, type MarkdownImageScope } from "./image-scope";
import type { ImageAssetPort } from "./image-resolve";
import { MarkdownRibbon, type MarkdownRibbonOptions } from "./ribbon";
import { createMarkdownSourceCodec, type MarkdownSourceCodec } from "./serialize";
import { MARKDOWN_RAW_NODE_NAME, MarkdownRawExtension } from "./raw-node";
import "katex/dist/katex.min.css";
// The shared editor stylesheet (prose/page/code/media/mermaid/shell), scoped to
// `.rich-text-editor`. The Markdown canvas carries that class on its ProseMirror
// element below, so the same typography and table/code rules the DOCX/PDF surfaces
// use apply here instead of a forked copy.
import "../../../editor/styles/index.css";
import type { AssetManifestLike, AssetStatus } from "../../asset-manifest";
import type { TextEditorHandle } from "../../source-editor-types";

/**
 * A GFM table parsed out of a raw block, or null when the block is not one.
 *
 * The M1 byte-identity rule keeps a table whose source the Markdown manager
 * would re-pad (single-space padding, e.g. the kitchen-sink fixture's
 * `| a | b |` rows) as an opaque `markdownRaw` block, so its bytes survive
 * open -> save untouched. That is correct, but the opaque node rendered as a
 * `<pre>`, so an AUTHORED table looked like code. This reads the raw source
 * just far enough to draw a real table; the bytes remain the node's attribute
 * and are what serialises back, so nothing is normalised.
 */
export interface GfmTable {
  header: string[];
  rows: string[][];
}

/** One `| a | b |` line -> its cells. Escaped `\|` stays inside a cell. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** The `| --- | :--: |` delimiter row GFM requires under the header. */
function isDelimiterRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Parse a raw block as a GFM table, or return null (the caller falls back to
 * the `<pre>` render). Conservative: a header line, a delimiter line and every
 * body line must be pipe-delimited, so prose that merely contains a `|` never
 * becomes a table.
 */
export function parseGfmTable(source: string): GfmTable | null {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const [headerLine, delimiterLine, ...bodyLines] = lines;
  if (!headerLine.trim().startsWith("|") || !delimiterLine.trim().startsWith("|")) return null;
  if (!isDelimiterRow(delimiterLine)) return null;
  const header = splitTableRow(headerLine);
  const width = header.length;
  const rows = bodyLines.map((line) => {
    if (!line.trim().startsWith("|")) return null;
    const cells = splitTableRow(line);
    // Pad/trim so every row has exactly the header's column count.
    return Array.from({ length: width }, (_, index) => cells[index] ?? "");
  });
  if (rows.some((row) => row === null)) return null;
  return { header, rows: rows as string[][] };
}

/** The `<tr>` list for a parsed table: a `<th>` header row, then `<td>` rows. */
function gfmTableRows(table: GfmTable): DOMOutputSpec[] {
  const headerRow: DOMOutputSpec = ["tr", {}, ...table.header.map((cell) => ["th", {}, cell] as DOMOutputSpec)];
  const bodyRows = table.rows.map(
    (row): DOMOutputSpec => ["tr", {}, ...row.map((cell) => ["td", {}, cell] as DOMOutputSpec)],
  );
  return [headerRow, ...bodyRows];
}

/**
 * The shared raw node with ONE render-only change: a raw block that is a GFM
 * table draws as a real table inside the shared `.tableWrapper` (so the
 * `.rich-text-editor` table rules apply), instead of a `<pre>`. Parse,
 * `renderMarkdown` and the `source` attribute are inherited untouched, so the
 * byte-identity contract is unaffected — only the DOM the block draws changes.
 */
const MarkdownRawTableExtension = MarkdownRawExtension.extend({
  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.source ?? "");
    const table = parseGfmTable(source);
    if (!table) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { "data-markdown-raw": "", "data-source": source }),
        ["pre", { class: "markdown-raw-source" }, ["code", {}, source]],
      ];
    }
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "tableWrapper markdown-raw-table",
        "data-markdown-raw": "",
        "data-source": source,
      }),
      ["table", {}, ["tbody", {}, ...gfmTableRows(table)]],
    ];
  },
});

/**
 * The image wiring a host injects: the manifest + port an image node resolves
 * against, and the upload port a paste/drop goes through. Supplying it activates
 * the Markdown image pipeline - the shared image node is swapped for
 * {@link MarkdownImageView} and the upload plugin is appended. Omitted, the
 * editor renders images through the shared node exactly as before.
 */
export interface MarkdownWysiwygImageOptions {
  /** The manifest an authored relative path resolves through. */
  manifest?: AssetManifestLike | null;
  /** Host port: opaque asset id -> display URL. Absent = images do not resolve. */
  port?: ImageAssetPort;
  /** Host upload port for pasted/dropped image files. Absent = no upload. */
  uploader?: MarkdownImageUploader;
  /** Called when a paste/drop upload fails, so the doc stays unsavable. */
  onAssetFailure?: (name: string, status: AssetStatus) => void;
  /** Number of uploads in flight; the ribbon/host can disable save while > 0. */
  onPendingChange?: (pending: number) => void;
}

export interface MarkdownWysiwygEditorProps<TSnapshot = unknown> {
  /** The document this view edits. Remounts the editor when it changes. */
  documentKey: string;
  /**
   * The shared editor handle. Its `source` port is the ONE text source: the
   * visual editor reads it on mount and writes every change back to it.
   */
  editor: TextEditorHandle<TSnapshot>;
  /** Read-only when false. Defaults to true. */
  editable?: boolean;
  /**
   * Called once the TipTap instance is live, and again with `null` on
   * unmount. M2-M8 mount their UI against this instance.
   */
  onEditorReady?: (editor: Editor | null) => void;
  /** Called after each user edit that was written back to the text source. */
  onChange?: (markdown: string) => void;
  /**
   * Called when the user edits and the surface wants a draft checkpoint. The
   * caller routes it through the save coordinator; it is never invoked
   * mid-IME composition.
   */
  onCheckpoint?: () => void;
  /**
   * The ribbon is mounted over the surface by default (the lane's surface
   * assembler). These options wire it: pane toggles (M6), Find (M7), the
   * Source | Visual control and the image insert (M5). `editor` and `editable`
   * are supplied by the editor itself.
   */
  ribbon?: MarkdownRibbonOptions;
  /** Set false to render the surface without its ribbon. */
  showRibbon?: boolean;
  /** Image pipeline wiring (M5). Omitted, images render through the shared node. */
  image?: MarkdownWysiwygImageOptions;
  className?: string;
  ariaLabel?: string;
}

/** The text source shared with the source editor, or the handle's fallbacks. */
function readSourceText<TSnapshot>(editor: TextEditorHandle<TSnapshot>): string {
  if (editor.source) return editor.source.getText();
  return editor.getText?.() ?? "";
}

function writeSourceText<TSnapshot>(editor: TextEditorHandle<TSnapshot>, text: string): void {
  if (editor.source) editor.source.setText(text);
  else editor.setText?.(text);
}

export function MarkdownWysiwygEditor<TSnapshot = unknown>({
  documentKey,
  editor,
  editable = true,
  onEditorReady,
  onChange,
  onCheckpoint,
  ribbon,
  showRibbon = true,
  image,
  className,
  ariaLabel,
}: MarkdownWysiwygEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown.wysiwyg" });

  // The image scope the NodeView and the upload plugin read. Held in a ref as
  // well so the plugin's callbacks - created once, with the editor - always see
  // the latest port/handler instead of the mount-time closure.
  const imageScope = useMemo<MarkdownImageScope>(
    () => ({
      manifest: image?.manifest ?? null,
      port: image?.port,
      onAssetFailure: image?.onAssetFailure,
    }),
    [image],
  );
  const imageScopeRef = useRef(imageScope);
  imageScopeRef.current = imageScope;
  const uploaderRef = useRef(image?.uploader);
  uploaderRef.current = image?.uploader;
  const onPendingChangeRef = useRef(image?.onPendingChange);
  onPendingChangeRef.current = image?.onPendingChange;

  // Only when a host wires images: swap the shared image node for the
  // manifest-resolving one and append the paste/drop upload plugin. Without the
  // option the extension array is byte-for-byte the shared Markdown set, so the
  // M1 round-trip contract is untouched.
  const extensions = useMemo(() => {
    const base = image
      ? createMarkdownEditorExtensions({
          image: createMarkdownImageExtension(),
          extraExtensions: [
            createMarkdownImageUploadExtension({
              getUploader: () => uploaderRef.current,
              onAssetFailure: (name, status) => imageScopeRef.current.onAssetFailure?.(name, status),
              onPendingChange: (pending) => onPendingChangeRef.current?.(pending),
            }),
          ],
        })
      : createMarkdownEditorExtensions();
    // Draw an authored (raw-preserved) GFM table as a real table. The node is
    // swapped in place so parse and serialise keep the shared raw extension.
    return base.map((extension) =>
      extension.name === MARKDOWN_RAW_NODE_NAME ? MarkdownRawTableExtension : extension,
    );
  }, [image]);

  // One codec per mount: the SAME extension set and indentation the editor
  // mounts with, so parse and serialise agree on what is representable.
  const codec: MarkdownSourceCodec = useMemo(() => createMarkdownSourceCodec(extensions), [extensions]);

  // The text this component last published. A source change equal to it is our
  // own write echoing back, not an external edit, and must not be re-parsed.
  const publishedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const applyingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const onCheckpointRef = useRef(onCheckpoint);
  const onReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onCheckpointRef.current = onCheckpoint;
  onReadyRef.current = onEditorReady;

  // The document the editor mounts with. Re-read in the same render that
  // switches `documentKey`, so the recreated editor cannot mount the previous
  // document's content (an effect would be one commit too late and flash the
  // wrong text).
  const initialDocRef = useRef<JSONContent | null>(null);
  const [mountedKey, setMountedKey] = useState(documentKey);
  if (initialDocRef.current === null || mountedKey !== documentKey) {
    initialDocRef.current = codec.parse(readSourceText(editor));
    publishedRef.current = null;
    if (mountedKey !== documentKey) setMountedKey(documentKey);
  }

  /** Serialise the editor document to the shared source and notify the caller. */
  const publish = useCallback(
    (doc: JSONContent) => {
      const next = codec.serialize(doc);
      if (next === publishedRef.current) return;
      publishedRef.current = next;
      writeSourceText(editor, next);
      onChangeRef.current?.(next);
      // Mid-composition the document holds a partial word; the committed text
      // is published at `compositionend`, and only then is a checkpoint safe.
      if (!composingRef.current) onCheckpointRef.current?.();
    },
    [codec, editor],
  );

  const instance = useEditor(
    {
      extensions,
      content: initialDocRef.current,
      contentType: "json",
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "markdown-wysiwyg-content rich-text-editor text-body outline-none prose",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel ?? t("label"),
        },
        handleDOMEvents: {
          compositionstart: () => {
            composingRef.current = true;
            return false;
          },
          compositionend: () => {
            composingRef.current = false;
            const live = editorRef.current;
            if (live) publish(live.getJSON());
            return false;
          },
        },
      },
      onUpdate: ({ editor: live }) => {
        // Mid-composition the document holds a partial word; write nothing and
        // never checkpoint until `compositionend` publishes the committed text.
        if (composingRef.current) return;
        publish(live.getJSON());
      },
    },
    [documentKey],
  );

  editorRef.current = instance;

  useEffect(() => {
    onReadyRef.current?.(instance);
    return () => onReadyRef.current?.(null);
  }, [instance]);

  // Follow external edits: a change from the source editor (or the coordinator
  // restoring a draft) is parsed back into the visual editor.
  useEffect(() => {
    const port = editor.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => {
      if (next === publishedRef.current) return;
      const live = editorRef.current;
      if (!live || applyingRef.current) return;
      applyingRef.current = true;
      try {
        live.commands.setContent(codec.parse(next), { emitUpdate: false });
        publishedRef.current = next;
      } finally {
        applyingRef.current = false;
      }
    });
  }, [editor, codec, documentKey]);

  useEffect(() => {
    if (!instance || instance.isEditable === editable) return;
    // `emitUpdate: false` — flipping editability is not a document change, and
    // the default `true` would fire onUpdate and request a spurious checkpoint.
    instance.setEditable(editable, false);
  }, [editable, instance]);

  return (
    <MarkdownImageScopeProvider scope={imageScope}>
      <div
        className={cn("markdown-wysiwyg flex min-h-0 min-w-0 flex-1 flex-col", className)}
        data-testid="md-wysiwyg"
        data-document-key={documentKey}
      >
        {showRibbon ? <MarkdownRibbon editor={instance} editable={editable} {...ribbon} /> : null}
        <EditorContent
          editor={instance}
          className="min-h-64 flex-1 overflow-auto p-3"
          data-testid="md-wysiwyg-surface"
        />
      </div>
    </MarkdownImageScopeProvider>
  );
}

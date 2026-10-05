"use client";

/**
 * MarkdownFrontmatterPanel — the YAML front-matter panel of the Markdown surface.
 *
 * The engine's `findFrontmatter` locates the YAML block at the top of the raw
 * source. The panel shows that block as TEXT and writes it back by replacing
 * exactly that span — nothing else in the document is touched.
 *
 * The byte-identity rule (Plan G3-08) is the reason this panel never re-parses
 * or re-serialises YAML: a body edit elsewhere in the document leaves the
 * front-matter bytes exactly as they were, and a front-matter edit replaces
 * `text[start..end)` with the textarea's value verbatim, so the surrounding
 * body bytes (and the front-matter's own trailing newline) are preserved.
 *
 * Scope: the panel only. It owns no draft, no transport and no save state; the
 * text goes through the caller's `SourceTextPort`, the same one the WYSIWYG
 * editor and the source editor share.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { findFrontmatter } from "@uniwork/office-engine/markdown";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import type { TextEditorHandle } from "../../source-editor-types";

/** The front-matter block: its span in the source and the block's exact text. */
export interface FrontmatterSpan {
  start: number;
  end: number;
  yaml: string;
}

/**
 * Locate the front-matter span through the engine's `findFrontmatter` and slice
 * the block verbatim. Returns `null` when the document has no front matter.
 */
export function readFrontmatterSpan(text: string): FrontmatterSpan | null {
  const range = findFrontmatter(text);
  if (!range) return null;
  return { start: range.start, end: range.end, yaml: text.slice(range.start, range.end) };
}

/**
 * Replace exactly the located span with `nextYaml`. The bytes before `start`
 * and after `end` are returned untouched, so an untouched front matter cannot
 * change and a body edit cannot leak into the block.
 */
export function replaceFrontmatterSpan(text: string, span: FrontmatterSpan, nextYaml: string): string {
  return text.slice(0, span.start) + nextYaml + text.slice(span.end);
}

/**
 * A best-effort span for a HALF-WRITTEN front matter. `findFrontmatter` returns
 * null once either fence is damaged (the user deleted the opening or closing
 * `---`, or is midway through typing one). Swapping in the empty state at that
 * keystroke would unmount the field the user is typing into, so while the field
 * has focus we fall back to the leading block: from the start of the document
 * up to the first blank line (or the whole text when there is none). That keeps
 * the field mounted and the next keystroke writable. Returns null for empty text.
 */
export function readFrontmatterDraftSpan(text: string): FrontmatterSpan | null {
  if (text.length === 0) return null;
  const blank = /(\r?\n)[ \t]*\r?\n/.exec(text);
  const end = blank ? blank.index + blank[1]!.length : text.length;
  return { start: 0, end, yaml: text.slice(0, end) };
}

export interface MarkdownFrontmatterPanelProps {
  /** The shared editor handle; its `source` port is the one text source. */
  editor: TextEditorHandle;
  className?: string;
  /** Read-only when false. Defaults to true. */
  editable?: boolean;
  /** Called after a front-matter edit was written back to the text source. */
  onChange?: (nextYaml: string) => void;
}

function readText(editor: TextEditorHandle): string {
  if (editor.source) return editor.source.getText();
  return editor.getText?.() ?? "";
}

function writeText(editor: TextEditorHandle, text: string): void {
  if (editor.source) editor.source.setText(text);
  else editor.setText?.(text);
}

export function MarkdownFrontmatterPanel({
  editor,
  className,
  editable = true,
  onChange,
}: MarkdownFrontmatterPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown.frontmatter" });
  const [text, setText] = useState(() => readText(editor));
  // True while the field holds focus. It keeps a half-written front matter
  // mounted (see `active` below) instead of unmounting it on the keystroke that
  // removes the closing fence.
  const [editing, setEditing] = useState(false);

  // Follow the shared source: a body edit (or a source-editor change) arrives
  // here, and the panel re-reads the span from the new bytes.
  useEffect(() => {
    setText(readText(editor));
    const port = editor.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => setText(next));
  }, [editor]);

  const span = useMemo(() => readFrontmatterSpan(text), [text]);
  // While the user is editing, a null `span` is not "no front matter" - it is a
  // fence being repaired. Fall back to the raw leading block so the field stays
  // mounted and the next keystroke can still be written back.
  const draftSpan = useMemo(
    () => (editing && !span ? readFrontmatterDraftSpan(text) : null),
    [editing, span, text],
  );
  const active = span ?? draftSpan;

  const onEdit = useCallback(
    (nextYaml: string) => {
      const current = readText(editor);
      const live =
        readFrontmatterSpan(current) ??
        (editing ? readFrontmatterDraftSpan(current) : null);
      if (!live) return;
      writeText(editor, replaceFrontmatterSpan(current, live, nextYaml));
      setText(readText(editor));
      onChange?.(nextYaml);
    },
    [editor, editing, onChange],
  );

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col gap-2 border-t border-border p-2", className)}
      aria-label={t("title")}
      data-testid="md-frontmatter"
    >
      <h2 className="px-1 text-label font-medium">{t("title")}</h2>
      {active ? (
        <>
          <Textarea
            aria-label={t("title")}
            aria-invalid={span ? undefined : true}
            data-testid="md-frontmatter-text"
            className="min-h-24 font-mono text-caption"
            value={active.yaml}
            readOnly={!editable}
            spellCheck={false}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(event) => onEdit(event.target.value)}
          />
          {/* A damaged fence has no helper copy of its own; `aria-invalid` is
              the state, and the field stays mounted so the user can repair it. */}
          {span ? <p className="px-1 text-caption text-muted-foreground">{t("preserved")}</p> : null}
        </>
      ) : (
        <p className="px-1 text-caption text-muted-foreground" data-testid="md-frontmatter-empty">
          {t("empty")}
        </p>
      )}
    </section>
  );
}

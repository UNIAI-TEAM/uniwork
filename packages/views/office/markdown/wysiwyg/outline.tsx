"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the resize handle is the WAI-ARIA window splitter: role="separator" is focusable and owns the arrow keys */

/**
 * MarkdownOutlinePane — the document outline of the Markdown surface.
 *
 * It lists the headings the live TipTap document holds (level + text, nested by
 * level) and jumps the editor to one on click. It subscribes to the editor's
 * own `update`/`transaction` events and re-renders only when the heading
 * structure actually changed, so a plain keystroke does not rebuild the list.
 *
 * The pane owns no document state: the heading list is derived from the editor,
 * the jump goes through a TipTap command, and nothing here writes text. The
 * pane is resizable through a token-styled drag handle that also answers the
 * arrow keys, so the width is reachable without a pointer.
 *
 * Scope: the outline only. The toolbar (M2), slash menu (M3), images (M5), find
 * (M7) and print (M8) are separate; the toggle that shows this pane lives in
 * the command row (chrome layout C6-C11), not here.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { cn } from "@uniwork/ui/lib/utils";

/** One heading in the document, in document order. */
export interface MarkdownHeading {
  /** 1-6, from the heading node's `level` attribute. */
  level: number;
  /** The heading's plain text. */
  text: string;
  /** ProseMirror position just before the heading node. */
  pos: number;
}

export const OUTLINE_MIN_WIDTH = 160;
export const OUTLINE_MAX_WIDTH = 480;
export const OUTLINE_DEFAULT_WIDTH = 224;
/** Pixels one arrow-key press moves the handle. */
const OUTLINE_KEYBOARD_STEP = 16;

/**
 * Walk the document and collect its headings. Exported so the extraction can
 * be pinned without a mounted editor.
 */
export function collectHeadings(editor: Editor | null): MarkdownHeading[] {
  if (!editor) return [];
  const headings: MarkdownHeading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ level: (node.attrs.level as number | undefined) ?? 1, text: node.textContent, pos });
    }
    return true;
  });
  return headings;
}

/** Cheap identity for a heading list, so a keystroke does not re-render the pane. */
function headingSignature(headings: MarkdownHeading[]): string {
  return headings.map((heading) => `${heading.level}:${heading.pos}:${heading.text}`).join("\u0000");
}

/** Clamp a width to the pane's allowed range. */
export function clampOutlineWidth(width: number): number {
  return Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, Math.round(width)));
}

export interface MarkdownOutlinePaneProps {
  /** The live TipTap instance (M1's `onEditorReady`). */
  editor: Editor | null;
  /** Called after a jump, with the heading that was clicked. */
  onNavigate?: (heading: MarkdownHeading) => void;
  /** Initial width in px. Defaults to {@link OUTLINE_DEFAULT_WIDTH}. */
  defaultWidth?: number;
  className?: string;
}

export function MarkdownOutlinePane({
  editor,
  onNavigate,
  defaultWidth = OUTLINE_DEFAULT_WIDTH,
  className,
}: MarkdownOutlinePaneProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown.outline" });
  const [width, setWidth] = useState(() => clampOutlineWidth(defaultWidth));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [headings, setHeadings] = useState<MarkdownHeading[]>(() => collectHeadings(editor));

  // The outline follows the live document. `useEditorState` cannot be used
  // here: its snapshot is keyed on a transaction counter, and the editor prop
  // arrives as `null` from M1's `onEditorReady` and only later becomes the
  // instance, so the cached snapshot would keep reporting `editor: null`
  // until the first keystroke. Subscribing to the instance directly sees both
  // the mount and every structural change. The signature check keeps a plain
  // keystroke from re-rendering the list.
  useEffect(() => {
    const publish = () => {
      setHeadings((current) => {
        const next = collectHeadings(editor);
        return headingSignature(current) === headingSignature(next) ? current : next;
      });
    };
    publish();
    if (!editor) return undefined;
    editor.on("update", publish);
    editor.on("transaction", publish);
    return () => {
      editor.off("update", publish);
      editor.off("transaction", publish);
    };
  }, [editor]);

  const jump = useCallback(
    (heading: MarkdownHeading) => {
      editor?.chain().focus(heading.pos, { scrollIntoView: true }).run();
      onNavigate?.(heading);
    },
    [editor, onNavigate],
  );

  // Pointer drag on the handle. Listeners live on `window` so the pointer may
  // travel past the 8px handle without the drag stalling.
  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setWidth(clampOutlineWidth(drag.startWidth + (event.clientX - drag.startX)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const onHandlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      dragRef.current = { startX: event.clientX, startWidth: width };
    },
    [width],
  );

  const onHandleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") setWidth((current) => clampOutlineWidth(current - OUTLINE_KEYBOARD_STEP));
    else if (event.key === "ArrowRight") setWidth((current) => clampOutlineWidth(current + OUTLINE_KEYBOARD_STEP));
    else if (event.key === "Home") setWidth(OUTLINE_MIN_WIDTH);
    else if (event.key === "End") setWidth(OUTLINE_MAX_WIDTH);
    else return;
    event.preventDefault();
  }, []);

  const levels = headings.map((heading) => heading.level);
  const minLevel = levels.length > 0 ? Math.min(...levels) : 1;

  return (
    <div className={cn("flex min-h-0 min-w-0 shrink-0", className)} data-testid="md-outline">
      <aside
        className="flex min-h-0 min-w-0 flex-col gap-2 border-r border-border bg-muted/10 p-2"
        style={{ width }}
        aria-label={t("title")}
      >
        <h2 className="px-1 text-label font-medium">{t("title")}</h2>
        <div className="min-h-0 flex-1 overflow-auto" data-testid="md-outline-list">
          {headings.length === 0 ? (
            <p className="px-1 text-caption text-muted-foreground" data-testid="md-outline-empty">
              {t("empty")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {headings.map((heading) => (
                <li key={`${heading.pos}-${heading.level}`}>
                  <button
                    type="button"
                    className="flex w-full items-center rounded-sm px-1 py-1 text-left text-caption text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden"
                    style={{ paddingLeft: 4 + (heading.level - minLevel) * 12 }}
                    title={t("jump", { title: heading.text })}
                    aria-label={t("jump", { title: heading.text })}
                    data-level={heading.level}
                    data-pos={heading.pos}
                    onClick={() => jump(heading)}
                  >
                    <span className="min-w-0 truncate">{heading.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resize")}
        aria-valuenow={width}
        aria-valuemin={OUTLINE_MIN_WIDTH}
        aria-valuemax={OUTLINE_MAX_WIDTH}
        tabIndex={0}
        data-testid="md-outline-resize"
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-foreground/15 focus-visible:bg-foreground/15"
        onPointerDown={onHandlePointerDown}
        onKeyDown={onHandleKeyDown}
      />
    </div>
  );
}

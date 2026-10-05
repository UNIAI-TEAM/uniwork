"use client";

/**
 * In-place text editing over the rendered slide (task A1ui, UNI-927) - the core demo edit.
 *
 * Two pieces, both mounted inside the slide box in page coordinates:
 *  - `PptxTextEditLayer`: one transparent hit box per text element. A double-click opens the
 *    editor; every other pointer gesture is forwarded to the selection controller, so selecting
 *    and dragging a text element behaves exactly as it does for any other node.
 *  - `PptxTextEditorOverlay`: the contenteditable surface, positioned over the element's box.
 *
 * Commit (blur, Ctrl/Cmd+Enter, or clicking outside) reads the DOM, turns each block into one
 * plain run and calls `onCommitText`. Escape cancels without committing. An empty or
 * whitespace-only edit is refused and the overlay stays open - the caller keeps the original.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { PptxParagraphLike } from "@uniwork/office-engine/pptx";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxPoint } from "../selection/geometry";
import type { PptxSelectionController } from "../selection/use-pptx-selection";
import { guardCommitText, paragraphsFromText, type PptxTextTarget } from "./text-model";

/** One committed in-place text edit. */
export interface PptxTextCommit {
  slideIndex: number;
  elementId: string;
  paragraphs: PptxParagraphLike[];
}

export interface PptxTextEditLayerProps {
  slideIndex: number;
  targets: readonly PptxTextTarget[];
  page: { widthPx: number; heightPx: number };
  displayWidthPx: number;
  displayHeightPx: number;
  controller: PptxSelectionController;
  /** Element currently open in the editor; its hit box steps aside. */
  activeId: string | null;
  onOpen: (target: PptxTextTarget) => void;
}

const BLOCK_TAGS = new Set(["div", "p", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** Plain text of a contenteditable: block elements and <br> are paragraph breaks. */
function readPlainText(root: HTMLElement): string {
  const blocks: string[] = [];
  let buffer = "";
  const push = (): void => {
    blocks.push(buffer);
    buffer = "";
  };
  const visit = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        buffer += child.textContent ?? "";
        return;
      }
      if (child.nodeType !== 1) return;
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === "br") {
        push();
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        if (buffer !== "") push();
        visit(element);
        push();
        return;
      }
      visit(element);
    });
  };
  visit(root);
  if (buffer !== "" || blocks.length === 0) push();
  return blocks.join("\n");
}

/** A box as a percentage of the page, so drawing and pointer mapping share one frame. */
function percentBox(box: PptxTextTarget["box"], page: { widthPx: number; heightPx: number }): CSSProperties {
  const w = page.widthPx > 0 ? page.widthPx : 1;
  const h = page.heightPx > 0 ? page.heightPx : 1;
  return { left: `${(box.x / w) * 100}%`, top: `${(box.y / h) * 100}%`, width: `${(box.w / w) * 100}%`, height: `${(box.h / h) * 100}%` };
}

/** Transparent pointer targets over the rendered text, in page coordinates. */
export function PptxTextEditLayer({
  targets,
  page,
  controller,
  activeId,
  onOpen,
}: PptxTextEditLayerProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.text" });
  const rootRef = useRef<HTMLDivElement>(null);

  const toPage = useCallback((event: ReactPointerEvent<HTMLDivElement>): PptxPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * page.widthPx,
      y: ((event.clientY - rect.top) / rect.height) * page.heightPx,
    };
  }, [page.heightPx, page.widthPx]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-20" data-pptx-text-layer>
      {targets.filter((target) => target.sourceId !== activeId).map((target) => (
        <div
          key={target.sourceId}
          data-pptx-text-target={target.sourceId}
          className="pointer-events-auto absolute cursor-text"
          style={percentBox(target.box, page)}
          onDoubleClick={() => onOpen(target)}
          onPointerDown={(event) => {
            if (event.button === 2) {
              // Right-click selects the element first; the context menu must still open.
              controller.onContextPointerDown(toPage(event));
              return;
            }
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            controller.onPointerDown(toPage(event), event.shiftKey);
          }}
          onPointerMove={(event) => controller.onPointerMove(toPage(event), event.shiftKey)}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            controller.onPointerUp();
          }}
          onPointerCancel={() => controller.onPointerCancel()}
          aria-hidden="true"
          title={t("target_label")}
        />
      ))}
    </div>
  );
}

export interface PptxTextEditorOverlayProps {
  slideIndex: number;
  target: PptxTextTarget;
  page: { widthPx: number; heightPx: number };
  displayWidthPx: number;
  displayHeightPx: number;
  onCommitText: (commit: PptxTextCommit) => void;
  onCancel: () => void;
}

/** The contenteditable surface over one text element's box. */
export function PptxTextEditorOverlay({
  slideIndex,
  target,
  page,
  displayHeightPx,
  onCommitText,
  onCancel,
}: PptxTextEditorOverlayProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.text" });
  const editorRef = useRef<HTMLDivElement>(null);
  const settled = useRef(false);
  const [emptyRefused, setEmptyRefused] = useState(false);
  const scaleY = page.heightPx > 0 ? displayHeightPx / page.heightPx : 1;
  const fontSizePx = (target.fontSizePx ?? 18) * scaleY;

  // Seed the DOM once per target; React never controls a contenteditable's text.
  useEffect(() => {
    settled.current = false;
    setEmptyRefused(false);
    const element = editorRef.current;
    if (!element) return;
    element.textContent = target.text;
    element.focus();
    const range = typeof document !== "undefined" && document.createRange ? document.createRange() : null;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (range && selection && element.firstChild) {
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [target.sourceId, target.text]);

  const commit = useCallback(() => {
    if (settled.current) return;
    const element = editorRef.current;
    if (!element) return;
    const paragraphs = guardCommitText(readPlainText(element));
    if (!paragraphs) {
      setEmptyRefused(true);
      element.focus();
      return;
    }
    settled.current = true;
    onCommitText({ slideIndex, elementId: target.sourceId, paragraphs });
  }, [onCommitText, slideIndex, target.sourceId]);

  const cancel = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  }, [onCancel]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
      return;
    }
    // Everything else is native text editing (select-all, text undo, caret keys, delete);
    // the canvas shortcuts must never see it.
    event.stopPropagation();
  };

  return (
    <div
      data-pptx-text-editor-overlay
      className="absolute z-30 flex flex-col"
      style={percentBox(target.box, page)}
    >
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-label={t("editor_label")}
        data-pptx-text-editor
        className={cn(
          "h-full w-full overflow-auto whitespace-pre-wrap break-words rounded-sm border border-primary bg-background/95 px-1 py-0.5 text-foreground outline-none",
          emptyRefused && "border-destructive",
        )}
        style={{ fontSize: fontSizePx, lineHeight: 1.2, textAlign: target.align ?? "left" }}
        onKeyDown={onKeyDown}
        onInput={() => setEmptyRefused(false)}
        onBlur={commit}
      />
      <span
        className="pointer-events-none mt-1 self-start rounded-sm border border-border bg-muted px-1 text-caption text-muted-foreground"
        data-pptx-text-hint
        role={emptyRefused ? "alert" : undefined}
      >
        {t(emptyRefused ? "empty_refused" : "hint")}
      </span>
    </div>
  );
}
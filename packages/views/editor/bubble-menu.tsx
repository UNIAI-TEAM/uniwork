"use client";

/**
 * EditorBubbleMenu — floating formatting toolbar for text selection.
 *
 * Positioned with @floating-ui/dom (computePosition + autoUpdate) and
 * portaled to document.body via createPortal. This escapes ALL overflow
 * containers in the ancestor chain (Card overflow:hidden, scrollable
 * containers, etc.) while autoUpdate monitors every ancestor scroll
 * container to keep the menu anchored to the selection.
 *
 * Key design decisions:
 * - contextElement on the virtual reference tells Floating UI where to
 *   find scroll ancestors, enabling the hide middleware to detect
 *   nested scroll container clipping.
 * - visibility:hidden (not display:none) keeps the element measurable
 *   so computePosition can size it correctly on first show.
 * - onMouseDown preventDefault on the portal root prevents all clicks
 *   inside the menu from stealing focus from the editor.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  computePosition,
  offset,
  flip,
  shift,
  hide,
  autoUpdate,
} from "@floating-ui/dom";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { posToDOMRect } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { createShortcutChord, type ShortcutChord } from "@uniwork/core/shortcuts";
import { ShortcutKeycaps } from "./shortcut-keycaps";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { Separator } from "@uniwork/ui/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@uniwork/ui/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@uniwork/ui/components/ui/popover";
import { Input } from "@uniwork/ui/components/ui/input";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  ChevronDown,
  Check,
  X,
  Unlink,
  Type,
  Heading1,
  Heading2,
  Heading3,
  FilePlus,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


import {
  shouldShowBubbleMenu,
  MarkButton,
  LinkEditBar,
  HeadingDropdown,
  ListDropdown,
  CreateSubTaskButton,
  type CreateSubTaskFn,
} from "./bubble-menu-controls";

function EditorBubbleMenu({
  editor,
  currentTaskId,
  onCreateSubTask,
}: {
  editor: Editor;
  currentTaskId?: string;
  onCreateSubTask?: CreateSubTaskFn;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"toolbar" | "link-edit">("toolbar");
  const floatingRef = useRef<HTMLDivElement>(null);

  // Precise subscription to formatting state — only re-renders when these
  // values actually change, not on every transaction.
  const fmt = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      blockquote: e.isActive("blockquote"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      // The level itself, not one boolean per offered level: the schema accepts
      // h1-h6 so the cursor can sit in an H4-H6 that Markdown brought in, and
      // the dropdown has to report that honestly instead of falling through to
      // "Normal text". It still only offers H1-H3 as choices (UNI-0).
      headingLevel: e.isActive("heading")
        ? (e.getAttributes("heading").level as number | undefined)
        : undefined,
    }),
  });

  // Virtual reference that tracks the text selection.
  // contextElement tells autoUpdate/hide where to find scroll ancestors.
  const virtualRef = useMemo(
    () => ({
      getBoundingClientRect: () => {
        if (editor.isDestroyed) return new DOMRect();
        const { from, to } = editor.state.selection;
        return posToDOMRect(editor.view, from, to);
      },
      contextElement: editor.view.dom,
    }),
    [editor],
  );

  // Show/hide based on selection state
  useEffect(() => {
    const onTransaction = () => {
      if (!editor.isInitialized) return;
      setVisible(shouldShowBubbleMenu(editor));
    };
    editor.on("transaction", onTransaction);
    return () => { editor.off("transaction", onTransaction); };
  }, [editor]);

  // Hide on blur — debounced to allow focus to settle (e.g. clicking menu)
  useEffect(() => {
    const onBlur = () => {
      setTimeout(() => {
        if (editor.isDestroyed) return;
        const el = floatingRef.current;
        if (el && el.contains(document.activeElement)) return;
        if (editor.view.hasFocus()) return;
        setVisible(false);
      }, 0);
    };
    editor.on("blur", onBlur);
    return () => { editor.off("blur", onBlur); };
  }, [editor]);

  // Position the floating element with autoUpdate when visible
  useEffect(() => {
    const el = floatingRef.current;
    if (!visible || !el || !editor.isInitialized) return;

    const updatePosition = () => {
      void computePosition(virtualRef, el, {
        strategy: "fixed",
        placement: "top",
        middleware: [offset(8), flip(), shift({ padding: 8 }), hide()],
      }).then(({ x, y, middlewareData }) => {
        if (!el.isConnected) return;
        const hidden = middlewareData.hide?.referenceHidden;
        el.style.visibility = hidden ? "hidden" : "visible";
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });
    };

    // autoUpdate monitors all scroll ancestors (via contextElement),
    // resize, and animation frames — no manual scroll listener needed.
    const cleanup = autoUpdate(virtualRef, el, updatePosition);
    return cleanup;
  }, [visible, editor, virtualRef]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (editor.view.dom.contains(target)) return;
      if (floatingRef.current?.contains(target)) return;
      setVisible(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [visible, editor]);

  // Reset mode on selection change
  useEffect(() => {
    const handler = () => setMode("toolbar");
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor]);

  // Refocus editor when Popover closes
  const handleMenuOpenChange = useCallback(
    (open: boolean) => { if (!open) editor.commands.focus(); },
    [editor],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- prevent focus steal from editor
    <div
      ref={floatingRef}
      style={{
        position: "fixed",
        zIndex: 50,
        width: "max-content",
        visibility: visible ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {mode === "link-edit" ? (
        <LinkEditBar editor={editor} onClose={() => { setMode("toolbar"); editor.commands.focus(); }} />
      ) : (
        <TooltipProvider delay={300}>
          <div className="bubble-menu">
            <MarkButton editor={editor} mark="bold" icon={Bold} label={t("editor.bubble_menu.bold")} shortcut={createShortcutChord("B", { primary: true })} isActive={fmt.bold} />
            <MarkButton editor={editor} mark="italic" icon={Italic} label={t("editor.bubble_menu.italic")} shortcut={createShortcutChord("I", { primary: true })} isActive={fmt.italic} />
            <MarkButton editor={editor} mark="strike" icon={Strikethrough} label={t("editor.bubble_menu.strikethrough")} shortcut={createShortcutChord("S", { primary: true, shift: true })} isActive={fmt.strike} />
            <MarkButton editor={editor} mark="code" icon={Code} label={t("editor.bubble_menu.code")} shortcut={createShortcutChord("E", { primary: true })} isActive={fmt.code} />
            <MarkButton editor={editor} mark="highlight" icon={Highlighter} label={t("editor.bubble_menu.highlight")} shortcut={createShortcutChord("H", { primary: true, shift: true })} isActive={fmt.highlight} />
            <Separator orientation="vertical" className="mx-0.5 h-5" />
            <Tooltip>
              <TooltipTrigger render={
                <Toggle
                  size="sm"
                  aria-label={t("editor.bubble_menu.link")}
                  pressed={fmt.link}
                  onPressedChange={() => setMode("link-edit")}
                   
      onMouseDown={(e) => e.preventDefault()}
                />
              }>
                <Link2 className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>{t("editor.bubble_menu.link")}</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-0.5 h-5" />
            <HeadingDropdown editor={editor} onOpenChange={handleMenuOpenChange} activeLevel={fmt.headingLevel} />
            <ListDropdown editor={editor} onOpenChange={handleMenuOpenChange} isBullet={fmt.bulletList} isOrdered={fmt.orderedList} isTask={fmt.taskList} />
            {/* Dedicated one-click toggle for checkbox task lists — turns the
                current line(s) into a `- [ ]` task item or back to a paragraph.
                The same toggle also lives in the List dropdown, but a direct
                button keeps the common "make this a checklist" action one tap
                away instead of two. */}
            <Tooltip>
              <TooltipTrigger render={
                <Toggle
                  size="sm"
                  aria-label={t("editor.bubble_menu.task_list")}
                  pressed={fmt.taskList}
                  onPressedChange={() => editor.chain().focus().toggleTaskList().run()}
                   
      onMouseDown={(e) => e.preventDefault()}
                />
              }>
                <ListTodo className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>{t("editor.bubble_menu.task_list")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Toggle
                  size="sm"
                  aria-label={t("editor.bubble_menu.quote")}
                  pressed={fmt.blockquote}
                  onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
                   
      onMouseDown={(e) => e.preventDefault()}
                />
              }>
                <Quote className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>{t("editor.bubble_menu.quote")}</TooltipContent>
            </Tooltip>
            {currentTaskId && onCreateSubTask && (
              <>
                <Separator orientation="vertical" className="mx-0.5 h-5" />
                <CreateSubTaskButton
                  editor={editor}
                  parentTaskId={currentTaskId}
                  createFn={onCreateSubTask}
                />
              </>
            )}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

export type { CreateSubTaskFn } from "./bubble-menu-controls";
export { EditorBubbleMenu };

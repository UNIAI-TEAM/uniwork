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


export function shouldShowBubbleMenu(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  if (selection.empty) return false;
  const { from, to } = selection;
  if (!editor.state.doc.textBetween(from, to).trim().length) return false;
  if (selection instanceof NodeSelection) return false;
  const $from = editor.state.doc.resolve(from);
  if ($from.parent.type.name === "codeBlock") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mark Toggle Button
// ---------------------------------------------------------------------------

type InlineMark = "bold" | "italic" | "strike" | "code" | "highlight";

const toggleMarkActions: Record<InlineMark, (editor: Editor) => void> = {
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  code: (e) => e.chain().focus().toggleCode().run(),
  highlight: (e) => e.chain().focus().toggleHighlight().run(),
};

export function MarkButton({
  editor,
  mark,
  icon: Icon,
  label,
  shortcut,
  isActive,
}: {
  editor: Editor;
  mark: InlineMark;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: ShortcutChord;
  isActive: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={label}
            pressed={isActive}
            onPressedChange={() => toggleMarkActions[mark](editor)}
             
      onMouseDown={(e) => e.preventDefault()}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        <ShortcutKeycaps shortcut={shortcut} className="ml-1.5" />
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

/** Protocols that can execute code in the browser — the only ones we block. */
const DANGEROUS_PROTOCOL_RE = /^(javascript|data|vbscript):/i;
const HAS_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/?\/?/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise a user-entered URL: add protocol, detect mailto, block XSS.
 *
 * Uses a blocklist (not allowlist) for protocols — only `javascript:`,
 * `data:`, and `vbscript:` are blocked. All other protocols pass through
 * because they can't execute code in the browser and are legitimate
 * deep-link targets in a team tool (slack://, vscode://, figma://).
 * Tiptap's `isAllowedUri` in the `setLink` command provides a second
 * safety layer.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (DANGEROUS_PROTOCOL_RE.test(trimmed)) return "";
  if (HAS_PROTOCOL_RE.test(trimmed)) return trimmed;
  if (EMAIL_RE.test(trimmed)) return `mailto:${trimmed}`;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

// ---------------------------------------------------------------------------
// Link Edit Bar
// ---------------------------------------------------------------------------

export function LinkEditBar({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const existingHref = editor.getAttributes("link").href as string | undefined;
  const [url, setUrl] = useState(existingHref ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const apply = useCallback(() => {
    const href = normalizeUrl(url);
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  }, [editor, url, onClose]);

  const remove = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }, [editor, onClose]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- prevent focus steal from editor
    <div className="bubble-menu-link-edit" onMouseDown={(e) => e.preventDefault()}>
      <Input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
        aria-label={t("editor.bubble_menu.url_aria_label")}
        className="h-7 flex-1 text-caption"
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); apply(); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); editor.commands.focus(); }
        }}
      />
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t("editor.bubble_menu.link_edit.apply")}
        onClick={apply}
         
      onMouseDown={(e) => e.preventDefault()}
      >
        <Check className="size-3.5" />
      </Button>
      {existingHref && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t("editor.bubble_menu.link_edit.remove")}
          onClick={remove}
           
      onMouseDown={(e) => e.preventDefault()}
        >
          <Unlink className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t("editor.bubble_menu.link_edit.close")}
        onClick={() => { onClose(); editor.commands.focus(); }}
         
      onMouseDown={(e) => e.preventDefault()}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heading Dropdown
// ---------------------------------------------------------------------------

export function HeadingDropdown({ editor, onOpenChange, activeLevel }: { editor: Editor; onOpenChange: (open: boolean) => void; activeLevel: number | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = activeLevel ? `H${activeLevel}` : t("editor.bubble_menu.heading_dropdown.text");
  const items = [
    { label: t("editor.bubble_menu.heading_dropdown.normal_text"), icon: Type, active: !activeLevel, action: () => editor.chain().focus().setParagraph().run() },
    { label: t("editor.bubble_menu.heading_dropdown.heading_1"), icon: Heading1, active: activeLevel === 1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: t("editor.bubble_menu.heading_dropdown.heading_2"), icon: Heading2, active: activeLevel === 2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: t("editor.bubble_menu.heading_dropdown.heading_3"), icon: Heading3, active: activeLevel === 3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  }, [onOpenChange]);

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-caption font-medium hover:bg-muted"
         
      onMouseDown={(e) => e.preventDefault()}
      >
        {label}
        <ChevronDown className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        sideOffset={8}
        align="start"
        className="w-auto min-w-32 p-1"
        initialFocus={false}
        finalFocus={false}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.label}
            className="flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-caption outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              item.action();
              handleOpenChange(false);
            }}
          >
            <item.icon className="size-3.5" />
            {item.label}
            {item.active && <Check className="ml-auto size-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// List Dropdown
// ---------------------------------------------------------------------------

export function ListDropdown({ editor, onOpenChange, isBullet, isOrdered, isTask }: { editor: Editor; onOpenChange: (open: boolean) => void; isBullet: boolean; isOrdered: boolean; isTask: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  }, [onOpenChange]);

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger render={
          <PopoverTrigger
            className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-caption font-medium hover:bg-muted aria-pressed:bg-muted"
            aria-label={t("editor.bubble_menu.list")}
            aria-pressed={isBullet || isOrdered || isTask}
             
      onMouseDown={(e) => e.preventDefault()}
          />
        }>
          <List className="size-3.5" />
          <ChevronDown className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>{t("editor.bubble_menu.list")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        sideOffset={8}
        align="start"
        className="w-auto min-w-32 p-1"
        initialFocus={false}
        finalFocus={false}
      >
        <button
          type="button"
          className="flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-caption outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBulletList().run();
            handleOpenChange(false);
          }}
        >
          <List className="size-3.5" /> {t("editor.bubble_menu.list_dropdown.bullet_list")}
          {isBullet && <Check className="ml-auto size-3.5" />}
        </button>
        <button
          type="button"
          className="flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-caption outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleOrderedList().run();
            handleOpenChange(false);
          }}
        >
          <ListOrdered className="size-3.5" /> {t("editor.bubble_menu.list_dropdown.ordered_list")}
          {isOrdered && <Check className="ml-auto size-3.5" />}
        </button>
        <button
          type="button"
          className="flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-caption outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleTaskList().run();
            handleOpenChange(false);
          }}
        >
          <ListTodo className="size-3.5" /> {t("editor.bubble_menu.list_dropdown.task_list")}
          {isTask && <Check className="ml-auto size-3.5" />}
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Create Sub-Task Button
// ---------------------------------------------------------------------------

export type CreateSubTaskFn = (
  title: string,
  parentTaskId: string,
) => Promise<{ id: string; identifier: string } | null>;

/**
 * Turns the current selection into a sub-task of `parentTaskId` and replaces
 * the selection with a mention link to the new task. Hosts inject createFn
 * (Task detail suite); without it the control is not rendered.
 */
export function CreateSubTaskButton({
  editor,
  parentTaskId,
  createFn,
}: {
  editor: Editor;
  parentTaskId: string;
  createFn: CreateSubTaskFn;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(async () => {
    if (pending) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const rawTitle = editor.state.doc.textBetween(from, to, " ", " ").trim();
    const title = rawTitle.replace(/\s+/g, " ").slice(0, 200);
    if (!title) return;

    setPending(true);
    try {
      const newTask = await createFn(title, parentTaskId);
      if (!newTask) return;
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from, to },
          [
            {
              type: "mention",
              attrs: {
                id: newTask.id,
                label: newTask.identifier,
                type: "task",
              },
            },
            { type: "text", text: " " },
          ],
        )
        .run();
      toast.success(t("editor.bubble_menu.sub_task.created", { identifier: newTask.identifier }));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("editor.bubble_menu.sub_task.create_failed"),
      );
    } finally {
      setPending(false);
    }
  }, [editor, parentTaskId, createFn, pending, t]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={t("editor.bubble_menu.sub_task.tooltip")}
            pressed={false}
            disabled={pending}
            onPressedChange={handleClick}
             
      onMouseDown={(e) => e.preventDefault()}
          />
        }
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FilePlus className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {t("editor.bubble_menu.sub_task.tooltip")}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Main Bubble Menu — @floating-ui/dom + portal to body
// ---------------------------------------------------------------------------


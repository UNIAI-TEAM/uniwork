"use client";

import { ClipboardPaste, ClipboardType, Copy, Paintbrush, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useFormatPainter } from "../../character/format-painter";
import type { RibbonItem } from "../../../ribbon";
import { copySelection, cutSelection, insertPastePayload, readClipboardPayload, readClipboardText } from "../../context-menu/clipboard-actions";
import { insertPlainText } from "../../context-menu/paste-options";
import { type DocxDocumentScope } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";

/**
 * The Home tab's Clipboard group (R7): Paste (split, large), Cut, Copy. Word
 * renders it first on the tab, so home.tsx registers it before Font.
 *
 * The commands are the context menu's own clipboard verbs
 * (context-menu/clipboard-actions.ts + paste-options.ts), reused read-only:
 * Paste's primary action reads the rich clipboard payload and inserts it, its
 * menu entry pastes plain text, and Cut/Copy write the current selection. The
 * editor comes from this document's scope because the clipboard verbs need the
 * TipTap editor, which the toolbar context does not carry.
 */

async function runCut(scope: DocxDocumentScope): Promise<void> {
  const editor = scope.editor.get();
  if (editor) await cutSelection(editor);
}

async function runCopy(scope: DocxDocumentScope): Promise<void> {
  const editor = scope.editor.get();
  if (editor) await copySelection(editor);
}

async function runPaste(scope: DocxDocumentScope): Promise<void> {
  const editor = scope.editor.get();
  if (!editor) return;
  const payload = await readClipboardPayload();
  if (payload) insertPastePayload(editor, payload);
}

async function runPastePlain(scope: DocxDocumentScope): Promise<void> {
  const editor = scope.editor.get();
  if (!editor) return;
  const text = await readClipboardText();
  if (text.length > 0) insertPlainText(editor, text);
}

function painterBlocked(context: DocxToolbarGroupContext): boolean {
  return context.readOnly || context.saving || !context.commands || !context.format;
}

/**
 * The format painter is a hook-driven control (it tracks the armed capture and
 * the next selection), so it stays a `custom` icon item. Word keeps it in the
 * Clipboard group, under Copy.
 */
function FormatPainterItem({
  editor,
  commands,
  disabled,
}: Pick<DocxToolbarGroupContext, "editor" | "commands"> & { disabled: boolean }) {
  const { t } = useTranslation();
  const painter = useFormatPainter({ editor, commands, disabled });
  const label = painter.armed ? t("office.docx.character.formatPainterArmed") : t("office.docx.character.formatPainter");
  const blocked = disabled || !editor.selection?.subscribe;
  // A ribbon icon button (UNI-933): the Button primitive keeps the focus
  // outline and the 44px coarse target, and aria-disabled keeps it in the tab
  // order while the primitive blocks the click.
  return (
    <Button
      type="button"
      variant="ghost"
      className="size-6 p-0 aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground [&_svg:not([class*='size-'])]:size-4"
      aria-pressed={painter.armed}
      aria-disabled={blocked || undefined}
      aria-label={label}
      title={label}
      onClick={() => painter.toggle()}
      data-testid="docx-format-painter"
    >
      <Paintbrush aria-hidden />
    </Button>
  );
}

/** The typed Clipboard items the ribbon renders for this group (R7). */
export function homeClipboardRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const disabled = context.readOnly || context.saving;
  const scope = context.docScope;
  return [
    {
      kind: "split",
      id: "docx-clipboard-paste",
      labelKey: "office.docx.contextMenu.paste",
      icon: ClipboardPaste,
      size: "large",
      collapseAs: "large",
      shortcut: "Ctrl+V",
      disabled,
      onExecute: () => void runPaste(scope),
      menu: [
        {
          id: "docx-clipboard-paste-plain",
          labelKey: "office.docx.contextMenu.pastePlain",
          icon: ClipboardType,
          onSelect: () => void runPastePlain(scope),
        },
      ],
    },
    {
      kind: "button",
      id: "docx-clipboard-cut",
      labelKey: "office.docx.contextMenu.cut",
      icon: Scissors,
      size: "icon",
      collapseAs: "icon",
      shortcut: "Ctrl+X",
      disabled,
      onExecute: () => void runCut(scope),
    },
    {
      kind: "button",
      id: "docx-clipboard-copy",
      labelKey: "office.docx.contextMenu.copy",
      icon: Copy,
      size: "icon",
      collapseAs: "icon",
      rowBreak: true,
      shortcut: "Ctrl+C",
      disabled,
      onExecute: () => void runCopy(scope),
    },
    {
      kind: "custom",
      id: "docx-format-painter",
      labelKey: "office.docx.character.formatPainter",
      size: "icon",
      collapseAs: "icon",
      rowBreak: true,
      width: 34,
      disabled: painterBlocked(context),
      render: () => <FormatPainterItem editor={context.editor} commands={context.commands} disabled={painterBlocked(context)} />,
    },
  ];
}

/** Custom-item fallback for a host that has not migrated to typed items: the
 * same three commands as real buttons. */
export function HomeClipboardGroup({ readOnly, saving, docScope: scope }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const disabled = readOnly || saving;
  return (
    <div className="flex flex-nowrap items-center gap-1">
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={disabled}
        aria-label={t("office.docx.contextMenu.paste")}
        onClick={() => void runPaste(scope)}
        data-testid="docx-clipboard-paste"
      >
        <ClipboardPaste aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={disabled}
        aria-label={t("office.docx.contextMenu.cut")}
        onClick={() => void runCut(scope)}
        data-testid="docx-clipboard-cut"
      >
        <Scissors aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={disabled}
        aria-label={t("office.docx.contextMenu.copy")}
        onClick={() => void runCopy(scope)}
        data-testid="docx-clipboard-copy"
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}
"use client";

import { ClipboardPaste, ClipboardType, Copy, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { copySelection, cutSelection, insertPastePayload, readClipboardPayload, readClipboardText } from "../../context-menu/clipboard-actions";
import { insertPlainText } from "../../context-menu/paste-options";
import { getDocxLiveEditor } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";

/**
 * The Home tab's Clipboard group (R7): Paste (split, large), Cut, Copy. Word
 * renders it first on the tab, so home.tsx registers it before Font.
 *
 * The commands are the context menu's own clipboard verbs
 * (context-menu/clipboard-actions.ts + paste-options.ts), reused read-only:
 * Paste's primary action reads the rich clipboard payload and inserts it, its
 * menu entry pastes plain text, and Cut/Copy write the current selection. The
 * editor comes from the live editor store because the clipboard verbs need the
 * TipTap editor, which the toolbar context does not carry.
 */

async function runCut(): Promise<void> {
  const editor = getDocxLiveEditor();
  if (editor) await cutSelection(editor);
}

async function runCopy(): Promise<void> {
  const editor = getDocxLiveEditor();
  if (editor) await copySelection(editor);
}

async function runPaste(): Promise<void> {
  const editor = getDocxLiveEditor();
  if (!editor) return;
  const payload = await readClipboardPayload();
  if (payload) insertPastePayload(editor, payload);
}

async function runPastePlain(): Promise<void> {
  const editor = getDocxLiveEditor();
  if (!editor) return;
  const text = await readClipboardText();
  if (text.length > 0) insertPlainText(editor, text);
}

/** The typed Clipboard items the ribbon renders for this group (R7). */
export function homeClipboardRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const disabled = context.readOnly || context.saving;
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
      onExecute: () => void runPaste(),
      menu: [
        {
          id: "docx-clipboard-paste-plain",
          labelKey: "office.docx.contextMenu.pastePlain",
          icon: ClipboardType,
          onSelect: () => void runPastePlain(),
        },
      ],
    },
    {
      kind: "button",
      id: "docx-clipboard-cut",
      labelKey: "office.docx.contextMenu.cut",
      icon: Scissors,
      size: "small",
      collapseAs: "small",
      shortcut: "Ctrl+X",
      disabled,
      onExecute: () => void runCut(),
    },
    {
      kind: "button",
      id: "docx-clipboard-copy",
      labelKey: "office.docx.contextMenu.copy",
      icon: Copy,
      size: "small",
      collapseAs: "small",
      shortcut: "Ctrl+C",
      disabled,
      onExecute: () => void runCopy(),
    },
  ];
}

/** Custom-item fallback for a host that has not migrated to typed items: the
 * same three commands as real buttons. */
export function HomeClipboardGroup({ readOnly, saving }: DocxToolbarGroupContext) {
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
        onClick={() => void runPaste()}
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
        onClick={() => void runCut()}
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
        onClick={() => void runCopy()}
        data-testid="docx-clipboard-copy"
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}
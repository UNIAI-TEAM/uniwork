"use client";

import { ClipboardPaste, Copy, Scissors } from "lucide-react";
import type { RibbonItem } from "../../../ribbon";
import { XlsxFormatPainterButton } from "../clear/format-painter";
import type { XlsxToolbarGroupProps } from "../types";

/** Home > Clipboard as typed ribbon items (Excel layout): Paste is the one
 *  large split button; Cut, Copy and the format painter stack beside it as
 *  icons. The long "Paste into selected cell" text stays the tooltip. A
 *  disabled item keeps its reason as the tooltip (read-only, permission, or no
 *  selection) and the host callbacks are guarded again here, so an
 *  `aria-disabled` click can never reach them. */
export function xlsxClipboardRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const { readOnly = false, permissions = {}, selection, onCut, onCopy, onPaste } = context;
  const noSelection = selection === null;
  const pasteBlocked = readOnly || noSelection || permissions.canPaste === false;
  const cutBlocked = readOnly || noSelection || permissions.canCopy === false || !onCut;
  const copyBlocked = noSelection || permissions.canCopy === false;
  const painterBlocked = readOnly || !context.canFormat || !context.commands;
  const pasteTooltip = readOnly
    ? "office.xlsx.saveState.readonly"
    : permissions.canPaste === false
      ? "office.xlsx.clipboardUnavailable"
      : noSelection
        ? "office.xlsx.selection.none"
        : "office.xlsx.actions.paste";
  const copyTooltip = permissions.canCopy === false
    ? "office.xlsx.clipboardUnavailable"
    : noSelection
      ? "office.xlsx.selection.none"
      : "office.xlsx.actions.copy";
  const cutTooltip = readOnly
    ? "office.xlsx.saveState.readonly"
    : permissions.canCopy === false
      ? "office.xlsx.clipboardUnavailable"
      : noSelection
        ? "office.xlsx.selection.none"
        : "office.xlsx.toolbar.groups.clipboardItems.cut";
  const paste = () => {
    if (!pasteBlocked) onPaste();
  };
  return [
    {
      kind: "split",
      id: "clipboard-paste",
      labelKey: "office.xlsx.toolbar.groups.clipboardItems.paste",
      tooltipKey: pasteTooltip,
      icon: ClipboardPaste,
      size: "large",
      collapseAs: "large",
      shortcut: "Ctrl+V",
      disabled: pasteBlocked,
      onExecute: paste,
      menu: [
        {
          id: "clipboard-paste-selected",
          labelKey: "office.xlsx.actions.paste",
          icon: ClipboardPaste,
          disabled: pasteBlocked,
          onSelect: paste,
        },
      ],
    },
    {
      kind: "button",
      id: "clipboard-cut",
      labelKey: "office.xlsx.toolbar.groups.clipboardItems.cut",
      tooltipKey: cutTooltip,
      icon: Scissors,
      size: "icon",
      collapseAs: "icon",
      shortcut: "Ctrl+X",
      disabled: cutBlocked,
      onExecute: () => {
        if (!cutBlocked) onCut?.();
      },
    },
    {
      kind: "button",
      id: "clipboard-copy",
      labelKey: "office.xlsx.actions.copy",
      tooltipKey: copyTooltip,
      icon: Copy,
      size: "icon",
      collapseAs: "icon",
      rowBreak: true,
      shortcut: "Ctrl+C",
      disabled: copyBlocked,
      onExecute: () => {
        if (!copyBlocked) onCopy();
      },
    },
    {
      kind: "custom",
      id: "clipboard-painter",
      labelKey: "office.xlsx.toolbar.groups.painter.label",
      size: "icon",
      collapseAs: "icon",
      rowBreak: true,
      width: 30,
      disabled: painterBlocked,
      render: () => <XlsxFormatPainterButton {...context} />,
    },
  ];
}

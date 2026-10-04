"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  ALargeSmall,
  Bold,
  Italic,
  Paintbrush,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { CaseMenu } from "../../character/case-menu";
import { HighlightPicker, TextColorPicker } from "../../character/color-picker";
import { FontFamilyPicker } from "../../character/font-family-picker";
import { FontSizePicker } from "../../character/font-size-picker";
import type { CaseCommandMode } from "../../character/case-transform";
import { BUILTIN_FONT_FAMILIES } from "../../character/font-list";
import { FONT_SIZES } from "../../character/font-size";
import { useFormatPainter } from "../../character/format-painter";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "../../editor-store";
import type { RibbonItem } from "../../../ribbon";
import { docxFontSizeDisplay } from "../font-size-display";
import type { DocxToolbarGroupContext } from "../types";

/**
 * The Home tab's Font group, in Word's order (C8):
 *
 *   [family] [- size +] B I U S x2 x2 [colour] [highlight] [case] clear painter
 *
 * The pre-wave group split the trio into a separate "Formatting" group that
 * rendered before the font controls; folding it in here keeps Word's order and
 * one control per tab (C7). Commands live in commands/character.ts (the trio
 * in commands/base.ts); this file only renders controls.
 */
export function HomeFontGroup({ editor, format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [documentFonts, setDocumentFonts] = useState<readonly string[]>([]);
  const blocked = readOnly || saving || !commands || !format;
  const verticalAlign = format?.verticalAlign ?? null;
  const painter = useFormatPainter({ editor, commands, disabled: blocked });
  // The size box needs the live selection marks, which the composed format
  // state flattens; the lane publishes the editor for this cross-subtree read.
  const live = useSyncExternalStore(subscribeDocxLiveEditor, getDocxLiveEditor, getDocxLiveEditor);
  const sizeDisplay = docxFontSizeDisplay(live, format?.fontSizePt ?? null);

  const refreshDocumentFonts = useCallback(() => {
    setDocumentFonts(commands?.documentFonts() ?? []);
  }, [commands]);

  return (
    <div className="flex flex-nowrap items-center gap-1">
      <FontFamilyPicker
        value={format?.fontFamily ?? null}
        documentFonts={documentFonts}
        disabled={blocked}
        onPick={(family) => commands?.setFontFamily(family)}
        onOpen={refreshDocumentFonts}
      />
      <FontSizePicker
        value={sizeDisplay.value}
        mixed={sizeDisplay.mixed}
        disabled={blocked}
        onSet={(pt) => commands?.setFontSizePt(pt)}
        onStep={(direction) => commands?.stepFontSize(direction)}
      />
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={format?.bold ?? false}
        onPressedChange={() => commands?.toggleBold()}
        disabled={blocked}
        aria-label={t("office.docx.commands.bold")}
        data-testid="docx-bold"
      >
        <Bold aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={format?.italic ?? false}
        onPressedChange={() => commands?.toggleItalic()}
        disabled={blocked}
        aria-label={t("office.docx.commands.italic")}
        data-testid="docx-italic"
      >
        <Italic aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={format?.underline ?? false}
        onPressedChange={() => commands?.toggleUnderline()}
        disabled={blocked}
        aria-label={t("office.docx.commands.underline")}
        data-testid="docx-underline"
      >
        <UnderlineIcon aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={format?.strike ?? false}
        onPressedChange={() => commands?.toggleStrike()}
        disabled={blocked}
        aria-label={t("office.docx.character.strike")}
        data-testid="docx-strike"
      >
        <Strikethrough aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={verticalAlign === "superscript"}
        onPressedChange={() => commands?.setVerticalAlign(verticalAlign === "superscript" ? null : "superscript")}
        disabled={blocked}
        aria-label={t("office.docx.character.superscript")}
        data-testid="docx-superscript"
      >
        <Superscript aria-hidden />
      </Toggle>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={verticalAlign === "subscript"}
        onPressedChange={() => commands?.setVerticalAlign(verticalAlign === "subscript" ? null : "subscript")}
        disabled={blocked}
        aria-label={t("office.docx.character.subscript")}
        data-testid="docx-subscript"
      >
        <Subscript aria-hidden />
      </Toggle>
      <TextColorPicker
        value={format?.color ?? null}
        disabled={blocked}
        onPick={(color) => commands?.setTextColor(color)}
      />
      <HighlightPicker
        value={format?.highlight ?? null}
        disabled={blocked}
        onPick={(name) => commands?.setHighlight(name)}
      />
      <CaseMenu disabled={blocked} onPick={(mode) => commands?.changeCase(mode)} />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={blocked}
        aria-label={t("office.docx.character.clearFormatting")}
        onClick={() => commands?.clearCharacterFormatting()}
        data-testid="docx-clear-formatting"
      >
        <RemoveFormatting aria-hidden />
      </Button>
      <Toggle
        type="button"
        variant="toolbar"
        size="sm"
        pressed={painter.armed}
        onPressedChange={() => painter.toggle()}
        disabled={blocked || !editor.selection?.subscribe}
        aria-label={painter.armed ? t("office.docx.character.formatPainterArmed") : t("office.docx.character.formatPainter")}
        data-testid="docx-format-painter"
      >
        <Paintbrush aria-hidden />
      </Toggle>
    </div>
  );
}
/** The five Word case modes, in the same order as the case menu. */
const CASE_ENTRIES: readonly { mode: CaseCommandMode; labelKey: string }[] = [
  { mode: "sentence", labelKey: "office.docx.character.caseSentence" },
  { mode: "lower", labelKey: "office.docx.character.caseLower" },
  { mode: "upper", labelKey: "office.docx.character.caseUpper" },
  { mode: "title", labelKey: "office.docx.character.caseTitle" },
  { mode: "toggle", labelKey: "office.docx.character.caseToggle" },
];

/**
 * The painter is a hook-driven control (it tracks the armed capture and the
 * next selection), so it cannot be a plain typed item - it stays a `custom`
 * item inside the typed group and renders the same toggle as before.
 */
function FormatPainterItem({
  editor,
  commands,
  disabled,
}: Pick<DocxToolbarGroupContext, "editor" | "commands"> & { disabled: boolean }) {
  const { t } = useTranslation();
  const painter = useFormatPainter({ editor, commands, disabled });
  return (
    <Toggle
      type="button"
      variant="toolbar"
      size="sm"
      pressed={painter.armed}
      onPressedChange={() => painter.toggle()}
      disabled={disabled || !editor.selection?.subscribe}
      aria-label={painter.armed ? t("office.docx.character.formatPainterArmed") : t("office.docx.character.formatPainter")}
      data-testid="docx-format-painter"
    >
      <Paintbrush aria-hidden />
    </Toggle>
  );
}

/**
 * The typed Font-group items (R7/R8). Every command is the one the pre-typed
 * group already called, in Word's order: family combo, size combo, B/I/U/S/x2
 * toggles, colour/highlight custom pickers, case dropdown, clear, painter.
 */
export function homeFontRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { editor, format, commands, readOnly, saving } = context;
  const blocked = readOnly || saving || !commands || !format;
  const verticalAlign = format?.verticalAlign ?? null;
  const sizeDisplay = docxFontSizeDisplay(getDocxLiveEditor(), format?.fontSizePt ?? null);
  const fonts = [...BUILTIN_FONT_FAMILIES];
  for (const font of commands?.documentFonts() ?? []) {
    if (!fonts.includes(font)) fonts.push(font);
  }

  return [
    {
      kind: "combo",
      id: "docx-font-family",
      labelKey: "office.docx.character.fontFamily",
      tooltipKey: "office.docx.character.fontFamily",
      value: format?.fontFamily ?? "",
      width: 128,
      disabled: blocked,
      options: [
        { value: "", labelKey: "office.docx.character.fontFamilyDefault" },
        ...fonts.map((font) => ({ value: font, label: font })),
      ],
      onChange: (value) => commands?.setFontFamily(value === "" ? null : value),
    },
    {
      kind: "combo",
      id: "docx-font-size",
      labelKey: "office.docx.character.fontSize",
      tooltipKey: "office.docx.character.fontSize",
      // Mixed selections keep the picker's empty placeholder by passing null.
      value: sizeDisplay.mixed || sizeDisplay.value === null ? null : String(sizeDisplay.value),
      width: 72,
      disabled: blocked,
      options: FONT_SIZES.map((size) => ({ value: String(size), label: String(size) })),
      onChange: (value) => {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) commands?.setFontSizePt(parsed);
      },
    },
    {
      kind: "toggle",
      id: "docx-bold",
      labelKey: "office.docx.commands.bold",
      icon: Bold,
      size: "large",
      collapseAs: "small",
      pressed: format?.bold ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleBold(),
    },
    {
      kind: "toggle",
      id: "docx-italic",
      labelKey: "office.docx.commands.italic",
      icon: Italic,
      size: "small",
      pressed: format?.italic ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleItalic(),
    },
    {
      kind: "toggle",
      id: "docx-underline",
      labelKey: "office.docx.commands.underline",
      icon: UnderlineIcon,
      size: "small",
      pressed: format?.underline ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleUnderline(),
    },
    {
      kind: "toggle",
      id: "docx-strike",
      labelKey: "office.docx.character.strike",
      icon: Strikethrough,
      size: "small",
      pressed: format?.strike ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleStrike(),
    },
    {
      kind: "toggle",
      id: "docx-superscript",
      labelKey: "office.docx.character.superscript",
      icon: Superscript,
      size: "small",
      pressed: verticalAlign === "superscript",
      disabled: blocked,
      onExecute: () => commands?.setVerticalAlign(verticalAlign === "superscript" ? null : "superscript"),
    },
    {
      kind: "toggle",
      id: "docx-subscript",
      labelKey: "office.docx.character.subscript",
      icon: Subscript,
      size: "small",
      pressed: verticalAlign === "subscript",
      disabled: blocked,
      onExecute: () => commands?.setVerticalAlign(verticalAlign === "subscript" ? null : "subscript"),
    },
    {
      kind: "custom",
      id: "docx-text-color",
      labelKey: "office.docx.character.textColor",
      width: 34,
      disabled: blocked,
      render: () => (
        <TextColorPicker
          value={format?.color ?? null}
          disabled={blocked}
          onPick={(color) => commands?.setTextColor(color)}
        />
      ),
    },
    {
      kind: "custom",
      id: "docx-highlight",
      labelKey: "office.docx.character.highlight",
      width: 34,
      disabled: blocked,
      render: () => (
        <HighlightPicker
          value={format?.highlight ?? null}
          disabled={blocked}
          onPick={(name) => commands?.setHighlight(name)}
        />
      ),
    },
    {
      kind: "dropdown",
      id: "docx-change-case",
      labelKey: "office.docx.character.changeCase",
      icon: ALargeSmall,
      size: "small",
      disabled: blocked,
      menu: CASE_ENTRIES.map((entry) => ({
        id: entry.mode,
        labelKey: entry.labelKey,
        onSelect: () => commands?.changeCase(entry.mode),
      })),
    },
    {
      kind: "button",
      id: "docx-clear-formatting",
      labelKey: "office.docx.character.clearFormatting",
      icon: RemoveFormatting,
      size: "small",
      disabled: blocked,
      onExecute: () => commands?.clearCharacterFormatting(),
    },
    {
      kind: "custom",
      id: "docx-format-painter",
      labelKey: "office.docx.character.formatPainter",
      width: 34,
      disabled: blocked,
      render: () => <FormatPainterItem editor={editor} commands={commands} disabled={blocked} />,
    },
  ];
}

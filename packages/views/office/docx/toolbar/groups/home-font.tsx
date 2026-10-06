"use client";

import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
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
import { useFormatPainter } from "../../character/format-painter";
import { useDocxScopeValue, type DocxDocumentScope } from "../../editor-store";
import type { RibbonItem } from "../../../ribbon";
import { docxDefaultFontFamily } from "../font-family-display";
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
export function HomeFontGroup({ editor, format, commands, readOnly, saving, docScope: scope }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [documentFonts, setDocumentFonts] = useState<readonly string[]>([]);
  const blocked = readOnly || saving || !commands || !format;
  const verticalAlign = format?.verticalAlign ?? null;
  const painter = useFormatPainter({ editor, commands, disabled: blocked });
  // The size box needs the live selection marks, which the composed format
  // state flattens; the lane publishes the editor for this cross-subtree read.
  const live = useDocxScopeValue(scope.editor);
  const sizeDisplay = docxFontSizeDisplay(live, format?.fontSizePt ?? null);

  const refreshDocumentFonts = useCallback(() => {
    const live = scope.editor.get();
    setDocumentFonts(live && !live.isDestroyed ? [...documentFontsFor(live, commands)] : []);
  }, [commands, scope]);

  return (
    <div className="flex flex-nowrap items-center gap-1">
      <FontFamilyPicker
        value={format?.fontFamily ?? null}
        defaultFamily={docxDefaultFontFamily(live)}
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
 * Fonts the open document declares, cached by document identity (W-FIX-A). A
 * selection-only change keeps the same `editor.state.doc`, so the full-document
 * walk `documentFonts()` performs runs once per document edit, not once per
 * shell render. The entry is dropped when the editor is destroyed.
 */
const documentFontsCache = new WeakMap<Editor, { doc: unknown; fonts: readonly string[] }>();

function documentFontsFor(editor: Editor, commands: DocxToolbarGroupContext["commands"]): readonly string[] {
  const cached = documentFontsCache.get(editor);
  if (cached && cached.doc === editor.state.doc) return cached.fonts;
  const fonts = commands?.documentFonts() ?? [];
  documentFontsCache.set(editor, { doc: editor.state.doc, fonts });
  return fonts;
}

/** Family box width in px: Word shows ~140 and the default name must not truncate. */
const FAMILY_WIDTH = 148;

/**
 * The family control as a `custom` item: the legacy FontFamilyPicker keeps the
 * typed-name commit the closed-list combo dropped (F4). The document-font read
 * only happens when the panel opens, so building the items is allocation-free.
 */
function FontFamilyItem({
  value,
  defaultFamily,
  commands,
  disabled,
  scope,
}: Pick<DocxToolbarGroupContext, "commands"> & { value: string | null; defaultFamily: string | null; disabled: boolean; scope: DocxDocumentScope }) {
  const [documentFonts, setDocumentFonts] = useState<readonly string[]>([]);
  const refreshDocumentFonts = useCallback(() => {
    const live = scope.editor.get();
    if (live && !live.isDestroyed) setDocumentFonts([...documentFontsFor(live, commands)]);
  }, [commands, scope]);
  return (
    // The picker's trigger carries a narrow w-28; the wrapper stretches it to
    // the item width so the default font name is not truncated (F4).
    <div style={{ width: FAMILY_WIDTH }} className="[&_button]:w-full">
      <FontFamilyPicker
        value={value}
        defaultFamily={defaultFamily}
        documentFonts={documentFonts}
        disabled={disabled}
        onPick={(family) => commands?.setFontFamily(family)}
        onOpen={refreshDocumentFonts}
      />
    </div>
  );
}

/**
 * The typed Font-group items (R7/R8). Every command is the one the pre-typed
 * group already called, in Word's order: family picker, size picker, B/I/U/S/x2
 * toggles, colour/highlight custom pickers, case dropdown, clear. Row 1 is
 * family, size, case, clear; row 2 (rowBreak on Bold) is B I U S x2 x2, colour,
 * highlight - all icon-sized, like Word. The painter lives in Clipboard.
 *
 * The family and size controls are `custom` items that re-mount the legacy
 * FontFamilyPicker/FontSizePicker (W-FIX-A): the closed-list combo could not
 * reach `stepFontSize` or accept a typed family/size, both of which the
 * pre-typed group supported. The family item defers its `documentFonts` read to
 * the panel opening and caches it per document, so no shell render walks the doc.
 */
export function homeFontRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly, saving } = context;
  const blocked = readOnly || saving || !commands || !format;
  const verticalAlign = format?.verticalAlign ?? null;
  const live = context.docScope.editor.get();
  const sizeDisplay = docxFontSizeDisplay(live, format?.fontSizePt ?? null);

  return [
    {
      kind: "custom",
      id: "docx-font-family",
      labelKey: "office.docx.character.fontFamily",
      size: "icon",
      collapseAs: "icon",
      width: FAMILY_WIDTH,
      disabled: blocked,
      render: () => (
        <FontFamilyItem value={format?.fontFamily ?? null} defaultFamily={docxDefaultFontFamily(live)} commands={commands} disabled={blocked} scope={context.docScope} />
      ),
    },
    {
      kind: "custom",
      id: "docx-font-size",
      labelKey: "office.docx.character.fontSize",
      size: "icon",
      collapseAs: "icon",
      width: 112,
      disabled: blocked,
      // docxFontSizeDisplay drives the picker's displayed value/mixed state;
      // the picker renders the mixed placeholder itself.
      render: () => (
        <FontSizePicker
          value={sizeDisplay.mixed ? null : sizeDisplay.value}
          mixed={sizeDisplay.mixed}
          disabled={blocked}
          onSet={(pt) => commands?.setFontSizePt(pt)}
          onStep={(direction) => commands?.stepFontSize(direction)}
        />
      ),
    },
    {
      kind: "dropdown",
      id: "docx-change-case",
      labelKey: "office.docx.character.changeCase",
      icon: ALargeSmall,
      size: "icon",
      collapseAs: "icon",
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
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: () => commands?.clearCharacterFormatting(),
    },
    {
      kind: "toggle",
      id: "docx-bold",
      rowBreak: true,
      labelKey: "office.docx.commands.bold",
      icon: Bold,
      size: "icon",
      collapseAs: "icon",
      pressed: format?.bold ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleBold(),
    },
    {
      kind: "toggle",
      id: "docx-italic",
      labelKey: "office.docx.commands.italic",
      icon: Italic,
      size: "icon",
      collapseAs: "icon",
      pressed: format?.italic ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleItalic(),
    },
    {
      kind: "toggle",
      id: "docx-underline",
      labelKey: "office.docx.commands.underline",
      icon: UnderlineIcon,
      size: "icon",
      collapseAs: "icon",
      pressed: format?.underline ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleUnderline(),
    },
    {
      kind: "toggle",
      id: "docx-strike",
      labelKey: "office.docx.character.strike",
      icon: Strikethrough,
      size: "icon",
      collapseAs: "icon",
      pressed: format?.strike ?? false,
      disabled: blocked,
      onExecute: () => commands?.toggleStrike(),
    },
    {
      kind: "toggle",
      id: "docx-subscript",
      labelKey: "office.docx.character.subscript",
      icon: Subscript,
      size: "icon",
      collapseAs: "icon",
      pressed: verticalAlign === "subscript",
      disabled: blocked,
      onExecute: () => commands?.setVerticalAlign(verticalAlign === "subscript" ? null : "subscript"),
    },
    {
      kind: "toggle",
      id: "docx-superscript",
      labelKey: "office.docx.character.superscript",
      icon: Superscript,
      size: "icon",
      collapseAs: "icon",
      pressed: verticalAlign === "superscript",
      disabled: blocked,
      onExecute: () => commands?.setVerticalAlign(verticalAlign === "superscript" ? null : "superscript"),
    },
    {
      kind: "custom",
      id: "docx-text-color",
      labelKey: "office.docx.character.textColor",
      size: "icon",
      collapseAs: "icon",
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
      size: "icon",
      collapseAs: "icon",
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
  ];
}

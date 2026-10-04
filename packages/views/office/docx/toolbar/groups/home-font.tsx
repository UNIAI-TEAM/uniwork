"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
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
import { useFormatPainter } from "../../character/format-painter";
import { getDocxLiveEditor, subscribeDocxLiveEditor } from "../../editor-store";
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

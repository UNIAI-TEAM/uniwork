"use client";

import { useCallback, useState } from "react";
import { Paintbrush, RemoveFormatting, Strikethrough, Subscript, Superscript } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Toggle } from "@uniwork/ui/components/ui/toggle";
import { CaseMenu } from "../../character/case-menu";
import { HighlightPicker, TextColorPicker } from "../../character/color-picker";
import { FontFamilyPicker } from "../../character/font-family-picker";
import { FontSizePicker } from "../../character/font-size-picker";
import { useFormatPainter } from "../../character/format-painter";
import type { DocxToolbarGroupContext } from "../types";

/**
 * The Home tab's font group (task A2): font family and size, strike/sub/
 * superscript, text colour and highlight, change case, clear formatting and
 * the format painter. Every command lives in commands/character.ts; this file
 * only renders controls and forwards into them.
 */
export function HomeFontGroup({ editor, format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [documentFonts, setDocumentFonts] = useState<readonly string[]>([]);
  const blocked = readOnly || saving || !commands || !format;
  const verticalAlign = format?.verticalAlign ?? null;
  const painter = useFormatPainter({ editor, commands, disabled: blocked });

  const refreshDocumentFonts = useCallback(() => {
    setDocumentFonts(commands?.documentFonts() ?? []);
  }, [commands]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <FontFamilyPicker
        value={format?.fontFamily ?? null}
        documentFonts={documentFonts}
        disabled={blocked}
        onPick={(family) => commands?.setFontFamily(family)}
        onOpen={refreshDocumentFonts}
      />
      <FontSizePicker
        value={format?.fontSizePt ?? null}
        disabled={blocked}
        onSet={(pt) => commands?.setFontSizePt(pt)}
        onStep={(direction) => commands?.stepFontSize(direction)}
      />
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
    </div>
  );
}

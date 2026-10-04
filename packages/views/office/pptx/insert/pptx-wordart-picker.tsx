"use client";

/**
 * A3ui (UNI-927) - Insert > WordArt.
 *
 * A dialog with one text field and the 12-preset gallery. A preset is a
 * `add_element` text box whose run carries the preset's colour/bold/italic
 * (the vendored `ElementFontPatch` has no stroke field, so the gallery's outline
 * recipes degrade to their fill - recorded as a gap in the A3ui report rather
 * than faked). The dialog stays open on insert so the user can try several
 * presets; the chosen edit leaves through `onInsert`.
 */
import { useId, useState } from "react";
import { Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_INSERT_WORDART_PRESETS, wordArtStrokePx, type PptxInsertWordArtPreset } from "./insert-model";

/** Gallery swatch: the preset's own colours, so the grid reads like the insert. */
function WordArtSwatch({ preset, text }: { preset: PptxInsertWordArtPreset; text: string }) {
  return (
    <span
      aria-hidden="true"
      className="text-title-sm font-semibold"
      style={{
        color: preset.fill,
        fontWeight: preset.bold ? 700 : 400,
        fontStyle: preset.italic ? "italic" : "normal",
        ...(preset.outline
          ? { WebkitTextStroke: `${wordArtStrokePx(preset.outline.widthEmu)}px ${preset.outline.color}` }
          : {}),
      }}
    >
      {text}
    </span>
  );
}

export interface PptxWordArtPickerProps {
  /** No slide bound, or the host has no edit channel. */
  disabled?: boolean;
  /** An insert is in flight. */
  busy?: boolean;
  /** Default text offered in the field; the user may replace it. */
  defaultText?: string;
  onInsert: (preset: PptxInsertWordArtPreset, text: string) => void;
  className?: string;
}

export function PptxWordArtPicker({ disabled = false, busy = false, defaultText = "", onInsert, className }: PptxWordArtPickerProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(defaultText);
  const [presetId, setPresetId] = useState<string | null>(null);
  const inputId = `${useId().replace(/[^A-Za-z0-9_-]/g, "")}-wordart-text`;
  const blocked = disabled || busy;
  const label = t("insert.wordart.open");
  const canInsert = text.trim().length > 0 && presetId !== null && !blocked;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!blocked) setOpen(next); }}>
      <DialogTrigger
        disabled={blocked}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={label}
            aria-pressed={open}
            aria-disabled={blocked || undefined}
            data-pptx-insert-wordart-open
            className={cn(className)}
          >
            <Type aria-hidden="true" />
            <span className="text-label">{label}</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg" closeLabel={t("insert.close")}>
        <DialogHeader>
          <DialogTitle>{t("insert.wordart.title")}</DialogTitle>
          <DialogDescription>{t("insert.wordart.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("insert.wordart.text_label")}</Label>
          <Input
            id={inputId}
            value={text}
            placeholder={t("insert.wordart.text_placeholder")}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("insert.wordart.title")}>
          {PPTX_INSERT_WORDART_PRESETS.map((preset) => {
            const presetLabel = t(preset.nameKey);
            const selected = presetId === preset.id;
            return (
              <Button
                key={preset.id}
                type="button"
                variant={selected ? "secondary" : "ghost"}
                size="sm"
                className="h-12"
                aria-label={presetLabel}
                aria-pressed={selected}
                title={presetLabel}
                data-pptx-wordart-preset={preset.id}
                onClick={() => {
                  setPresetId(preset.id);
                  onInsert(preset, text.trim() || defaultText);
                }}
              >
                <WordArtSwatch preset={preset} text="Aa" />
              </Button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canInsert}
            data-pptx-wordart-insert
            onClick={() => {
              const preset = PPTX_INSERT_WORDART_PRESETS.find((candidate) => candidate.id === presetId);
              if (!preset || !canInsert) return;
              onInsert(preset, text.trim());
            }}
          >
            {t("insert.wordart.title")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
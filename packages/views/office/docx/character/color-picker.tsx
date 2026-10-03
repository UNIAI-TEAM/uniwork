"use client";

import { Baseline, Highlighter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

/** Word's theme + standard colour rows. Values are hex without "#"; the
 * swatch style is document data, not a theme token. */
const TEXT_COLORS: readonly string[] = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "0E2841",
  "156082",
  "E97132",
  "196B24",
  "0F9ED5",
  "A02B93",
  "4EA72E",
  "C00000",
  "FF0000",
  "FFC000",
  "FFFF00",
  "92D050",
  "00B050",
  "00B0F0",
  "0070C0",
  "002060",
  "7030A0",
];

/** Word's named highlight colours (OOXML w:highlight) with their on-screen CSS. */
const HIGHLIGHTS: readonly { name: string; css: string }[] = [
  { name: "yellow", css: "#FFFF00" },
  { name: "green", css: "#00FF00" },
  { name: "cyan", css: "#00FFFF" },
  { name: "magenta", css: "#FF00FF" },
  { name: "blue", css: "#0000FF" },
  { name: "red", css: "#FF0000" },
  { name: "darkBlue", css: "#00008B" },
  { name: "darkCyan", css: "#008B8B" },
  { name: "darkGreen", css: "#006400" },
  { name: "darkMagenta", css: "#8B008B" },
  { name: "darkRed", css: "#8B0000" },
  { name: "darkYellow", css: "#808000" },
  { name: "darkGray", css: "#808080" },
  { name: "lightGray", css: "#C0C0C0" },
  { name: "black", css: "#000000" },
];

interface SwatchGridProps {
  items: readonly { value: string; css: string; label: string }[];
  current: string | null;
  disabled: boolean;
  noneLabel: string;
  testId: string;
  onPick(value: string | null): void;
}

function SwatchGrid({ items, current, disabled, noneLabel, testId, onPick }: SwatchGridProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-5 gap-1" data-testid={`${testId}-grid`}>
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            aria-label={item.label}
            aria-pressed={current === item.value}
            onClick={() => onPick(item.value)}
            className={cn(
              "size-5 rounded-sm ring-1 ring-border ring-inset hover:scale-105",
              current === item.value && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: item.css }}
            data-testid={`${testId}-${item.value}`}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={current === null}
        onClick={() => onPick(null)}
        className={cn(
          "rounded-md px-1.5 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          current === null && "bg-surface-selected text-foreground",
        )}
        data-testid={`${testId}-none`}
      >
        {noneLabel}
      </button>
    </div>
  );
}

export interface TextColorPickerProps {
  /** Hex without "#"; null = automatic. */
  value: string | null;
  disabled?: boolean;
  onPick(color: string | null): void;
}

export function TextColorPicker({ value, disabled = false, onPick }: TextColorPickerProps) {
  const { t } = useTranslation();
  const items = TEXT_COLORS.map((hex) => ({
    value: hex,
    css: `#${hex}`,
    label: t("office.docx.character.colorSwatch", { value: `#${hex}` }),
  }));
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className="relative"
            disabled={disabled}
            aria-label={t("office.docx.character.textColor")}
            data-testid="docx-text-color"
          />
        }
      >
        <Baseline aria-hidden />
        <span
          aria-hidden
          className={cn("absolute inset-x-1 bottom-0.5 h-0.5 rounded-full", value === null && "bg-foreground")}
          style={value === null ? undefined : { backgroundColor: `#${value}` }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 gap-1.5 p-2">
        <SwatchGrid
          items={items}
          current={value}
          disabled={disabled}
          noneLabel={t("office.docx.character.textColorAuto")}
          testId="docx-text-color-swatch"
          onPick={onPick}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface HighlightPickerProps {
  /** OOXML highlight name; null = no highlight. */
  value: string | null;
  disabled?: boolean;
  onPick(name: string | null): void;
}

export function HighlightPicker({ value, disabled = false, onPick }: HighlightPickerProps) {
  const { t } = useTranslation();
  const items = HIGHLIGHTS.map((highlight) => ({
    value: highlight.name,
    css: highlight.css,
    label: t("office.docx.character.highlightSwatch", { value: highlight.name }),
  }));
  const current = value === null ? null : HIGHLIGHTS.find((highlight) => highlight.name === value);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className="relative"
            disabled={disabled}
            aria-label={t("office.docx.character.highlight")}
            data-testid="docx-highlight"
          />
        }
      >
        <Highlighter aria-hidden />
        <span
          aria-hidden
          className={cn("absolute inset-x-1 bottom-0.5 h-0.5 rounded-full", !current && "bg-foreground")}
          style={current ? { backgroundColor: current.css } : undefined}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 gap-1.5 p-2">
        <SwatchGrid
          items={items}
          current={value}
          disabled={disabled}
          noneLabel={t("office.docx.character.highlightNone")}
          testId="docx-highlight-swatch"
          onPick={onPick}
        />
      </PopoverContent>
    </Popover>
  );
}

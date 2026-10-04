"use client";

import { useRef, useState, type KeyboardEvent } from "react";
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

/** Word's named highlight colours (OOXML w:highlight) with their on-screen CSS.
 * Mirrors the vendored HIGHLIGHT_CSS map, `white` included: a run carrying
 * w:highlight="white" must show and stay re-pickable. */
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
  { name: "white", css: "#FFFFFF" },
];

interface SwatchGridProps {
  items: readonly { value: string; css: string; label: string }[];
  current: string | null;
  disabled: boolean;
  noneLabel: string;
  testId: string;
  onPick(value: string | null): void;
}

const GRID_COLUMNS = 5;

function SwatchGrid({ items, current, disabled, noneLabel, testId, onPick }: SwatchGridProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  /** Word's palette is one tab stop and the arrows walk it. */
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = items.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = Math.max(index - 1, 0);
        break;
      case "ArrowRight":
        next = Math.min(index + 1, last);
        break;
      case "ArrowUp":
        next = Math.max(index - GRID_COLUMNS, 0);
        break;
      case "ArrowDown":
        next = Math.min(index + GRID_COLUMNS, last);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    setFocusIndex(next);
    Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={gridRef} className="grid grid-cols-5 gap-1" data-testid={`${testId}-grid`}>
        {items.map((item, index) => (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-label={item.label}
            aria-pressed={current === item.value}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => moveFocus(event, index)}
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
  const [open, setOpen] = useState(false);
  const items = TEXT_COLORS.map((hex) => ({
    value: hex,
    css: `#${hex}`,
    label: t("office.docx.character.colorSwatch", { value: `#${hex}` }),
  }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          onPick={(color) => {
            onPick(color);
            setOpen(false);
          }}
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
  const [open, setOpen] = useState(false);
  const items = HIGHLIGHTS.map((highlight) => ({
    value: highlight.name,
    css: highlight.css,
    label: t("office.docx.character.highlightSwatch", { value: highlight.name }),
  }));
  const current = value === null ? null : HIGHLIGHTS.find((highlight) => highlight.name === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          onPick={(name) => {
            onPick(name);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

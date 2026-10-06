"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { BUILTIN_FONT_FAMILIES } from "./font-list";

export interface FontFamilyPickerProps {
  /** The face shown for the caret/selection; null = no explicit run font. */
  value: string | null;
  /** Fonts the open document declares, appended after the built-in list. */
  documentFonts: readonly string[];
  /** The document's effective family, shown when the run has no explicit font. */
  defaultFamily?: string | null;
  disabled?: boolean;
  onPick(family: string | null): void;
  /** Fired when the panel opens, so the host can re-read the document fonts. */
  onOpen?(): void;
}

const OPTION_CLASS =
  "flex w-full items-center justify-between gap-1.5 rounded-md px-1.5 py-1 text-start text-body outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";

export function FontFamilyPicker({ value, documentFonts, defaultFamily = null, disabled = false, onPick, onOpen }: FontFamilyPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const merged = [...BUILTIN_FONT_FAMILIES];
    for (const font of documentFonts) {
      if (!merged.includes(font)) merged.push(font);
    }
    const needle = query.trim().toLowerCase();
    return needle ? merged.filter((font) => font.toLowerCase().includes(needle)) : merged;
  }, [documentFonts, query]);

  const pick = (family: string | null): void => {
    onPick(family);
    setQuery("");
    setOpen(false);
  };

  // Word's font list is one tab stop; the arrows walk it (index 0 is "Default").
  const optionCount = options.length + 1;
  const activeIndex = Math.min(focusIndex, optionCount - 1);

  const focusOption = (index: number): void => {
    setFocusIndex(index);
    listRef.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  };

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number;
    switch (event.key) {
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "ArrowDown":
        next = Math.min(index + 1, optionCount - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = optionCount - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusOption(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setFocusIndex(0);
          onOpen?.();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className="w-36 min-w-36 justify-between"
            disabled={disabled}
            aria-label={t("office.docx.character.fontFamily")}
            data-testid="docx-font-family"
          />
        }
      >
        <span className="min-w-0 truncate text-label">{value ?? defaultFamily ?? t("office.docx.character.fontFamilyDefault")}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5 p-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocusIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusOption(0);
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            const typed = query.trim();
            if (typed) pick(typed);
          }}
          placeholder={t("office.docx.character.fontFamilySearch")}
          aria-label={t("office.docx.character.fontFamilySearch")}
          data-testid="docx-font-family-search"
          className="h-8"
        />
        <div ref={listRef} className="max-h-64 overflow-y-auto" data-testid="docx-font-family-list">
          <button
            type="button"
            className={cn(OPTION_CLASS, "text-muted-foreground")}
            tabIndex={activeIndex === 0 ? 0 : -1}
            aria-pressed={value === null}
            onFocus={() => setFocusIndex(0)}
            onKeyDown={(event) => moveFocus(event, 0)}
            onClick={() => pick(null)}
            data-testid="docx-font-family-default"
          >
            <span className="min-w-0 truncate">{t("office.docx.character.fontFamilyDefault")}</span>
            {value === null ? <Check aria-hidden /> : null}
          </button>
          {options.map((font, index) => (
            <button
              key={font}
              type="button"
              className={OPTION_CLASS}
              style={{ fontFamily: font }}
              tabIndex={activeIndex === index + 1 ? 0 : -1}
              aria-pressed={font === value}
              onFocus={() => setFocusIndex(index + 1)}
              onKeyDown={(event) => moveFocus(event, index + 1)}
              onClick={() => pick(font)}
              data-testid="docx-font-family-option"
            >
              <span className="min-w-0 truncate">{font}</span>
              {font === value ? <Check aria-hidden /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

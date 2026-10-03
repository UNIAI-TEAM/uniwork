"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { FONT_SIZES } from "./font-size";

export interface FontSizePickerProps {
  /** Explicit run size in points; null = inherit the style/doc default. */
  value: number | null;
  disabled?: boolean;
  onSet(pt: number): void;
  onStep(direction: 1 | -1): void;
}

function draftOf(value: number | null): string {
  return value === null ? "" : String(value);
}

export function FontSizePicker({ value, disabled = false, onSet, onStep }: FontSizePickerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => draftOf(value));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(draftOf(value));
  }, [value]);

  const commit = (raw: string): void => {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(draftOf(value));
      return;
    }
    const clamped = Math.min(1638, Math.max(1, parsed));
    if (value !== null && Math.round(value * 2) === Math.round(clamped * 2)) {
      setDraft(draftOf(value));
      return;
    }
    onSet(clamped);
  };

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("office.docx.character.fontSizeDecrease")}
        onClick={() => onStep(-1)}
        data-testid="docx-font-size-decrease"
      >
        <Minus aria-hidden />
      </Button>
      <Input
        value={draft}
        inputMode="decimal"
        disabled={disabled}
        aria-label={t("office.docx.character.fontSize")}
        placeholder={t("office.docx.character.fontSizeAuto")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        data-testid="docx-font-size"
        className="h-7 w-14 px-1.5 text-center text-label"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              disabled={disabled}
              aria-label={t("office.docx.character.fontSizePresets")}
              data-testid="docx-font-size-presets"
            />
          }
        >
          <ChevronDown aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-32 gap-0.5 p-1.5">
          <div className="grid grid-cols-3 gap-0.5" data-testid="docx-font-size-list">
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={cn(
                  "rounded-md px-1 py-1 text-label hover:bg-accent hover:text-accent-foreground",
                  value !== null && Math.round(value * 2) === Math.round(size * 2) && "bg-surface-selected",
                )}
                aria-pressed={value !== null && Math.round(value * 2) === Math.round(size * 2)}
                onClick={() => {
                  onSet(size);
                  setOpen(false);
                }}
                data-testid="docx-font-size-option"
              >
                {size}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("office.docx.character.fontSizeIncrease")}
        onClick={() => onStep(1)}
        data-testid="docx-font-size-increase"
      >
        <Plus aria-hidden />
      </Button>
    </>
  );
}

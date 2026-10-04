"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export interface FontSizePickerProps {
  /** Explicit run size in points; null = inherit the style/doc default. */
  value: number | null;
  /** The selection carries more than one size (C8): the box stays empty. */
  mixed?: boolean;
  disabled?: boolean;
  onSet(pt: number): void;
  onStep(direction: 1 | -1): void;
}

// The empty-field placeholder for a mixed selection (C8: "-", not "Auto").
const MIXED_PLACEHOLDER = "-";

function draftOf(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Word's size box (C8): `- size +` with no extra chevron. The +/- pair walks
 * the preset ladder; typing a size commits on Enter or blur.
 */
export function FontSizePicker({ value, mixed = false, disabled = false, onSet, onStep }: FontSizePickerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => draftOf(value));

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
    <div className="flex shrink-0 items-center" data-testid="docx-font-size-box">
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
        placeholder={MIXED_PLACEHOLDER}
        aria-placeholder={mixed ? MIXED_PLACEHOLDER : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        data-testid="docx-font-size"
        className="h-7 w-12 rounded-none border-x-0 px-1 text-center text-label"
      />
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
    </div>
  );
}

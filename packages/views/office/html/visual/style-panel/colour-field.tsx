"use client";

/**
 * BackgroundColourField — the H7 colour field.
 *
 * It is presentational: the value is a string the caller owns (or null for "no
 * background") and every pick is reported through `onPick`. The field never
 * writes a document, never builds CSS and never injects anything.
 *
 * The swatches below are DOCUMENT values - what a person paints onto an
 * element - so they are fixed hexes rather than theme tokens, exactly like the
 * DOCX colour picker's palette. The hex input is a draft: a partial value like
 * "#ff0" is not yet a colour, so it stays in the field until it parses (or the
 * field is cleared), and only then does the field report it. That is why the
 * component holds one piece of local state and nothing else.
 */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban } from "lucide-react";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { normalizeHexColour } from "./model";

/** Document-value swatches; the empty id is the "no background" row. */
const SWATCHES: readonly string[] = ["#000000", "#ffffff", "#dc2626", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#e4e4e7"];

export interface BackgroundColourFieldProps {
  /** `#rrggbb`, or null for "no background". */
  value: string | null;
  disabled?: boolean;
  onPick(value: string | null): void;
  /** Stable hook for tests and the host's own wiring. */
  testId?: string;
}

export function BackgroundColourField({ value, disabled = false, onPick, testId = "html-style-background" }: BackgroundColourFieldProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.style" });
  const inputId = useId();
  const [draft, setDraft] = useState(value ?? "");

  // The caller can replace the value (a new selection); the field follows it
  // unless the person is mid-edit with the same text.
  useEffect(() => {
    setDraft((current) => (normalizeHexColour(current) === value ? current : (value ?? "")));
  }, [value]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "") {
      onPick(null);
      return;
    }
    const hex = normalizeHexColour(trimmed);
    if (hex !== null) onPick(hex);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId} className="text-caption text-muted-foreground">
          {t("background")}
        </Label>
        <Input
          id={inputId}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("colourPlaceholder")}
          className="w-24 font-mono"
          data-testid={`${testId}-hex`}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            // A complete value commits as it is typed; a partial one waits.
            const hex = normalizeHexColour(next);
            if (hex !== null) onPick(hex);
            else if (next.trim() === "") onPick(null);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit(draft);
          }}
        />
        <span
          aria-hidden
          className="size-5 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: value ?? "transparent" }}
          data-testid={`${testId}-preview`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            disabled={disabled}
            aria-label={t("colourSwatch", { value: hex })}
            aria-pressed={value === hex}
            data-bg-swatch={hex}
            className={cn(
              "size-5 cursor-pointer rounded-sm border border-border outline-offset-2 hover:scale-105",
              value === hex && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: hex }}
            onClick={() => {
              setDraft(hex);
              onPick(hex);
            }}
          />
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-label={t("backgroundNone")}
          aria-pressed={value === null}
          data-testid={`${testId}-none`}
          className={cn(
            "inline-flex size-5 cursor-pointer items-center justify-center rounded-sm border border-border text-muted-foreground outline-offset-2 hover:bg-muted",
            value === null && "bg-surface-selected text-foreground",
          )}
          onClick={() => {
            setDraft("");
            onPick(null);
          }}
        >
          <Ban aria-hidden className="size-3" />
        </button>
      </div>
    </div>
  );
}

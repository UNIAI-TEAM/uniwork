"use client";

import { useEffect, useState } from "react";
import { AlignVerticalSpaceAround } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { LINE_SPACING_PRESETS, MAX_SPACING_PT, formatLineSpacing } from "./paragraph-format";

export interface ParagraphSpacingPickerProps {
  /** w:spacing w:line multiple; null = inherit. */
  lineSpacing: number | null;
  /** Space before/after in points; null = inherit. */
  spaceBeforePt: number | null;
  spaceAfterPt: number | null;
  disabled?: boolean;
  onLineSpacing(multiple: number | null): void;
  onSpaceBefore(pt: number | null): void;
  onSpaceAfter(pt: number | null): void;
}

function draftOf(value: number | null): string {
  return value === null ? "" : String(value);
}

/** A field reading: a number, null for blank ("inherit") or undefined for an
 * entry that is not a usable number. */
function parsePt(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(MAX_SPACING_PT, parsed);
}

function parseMultiple(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/** The Home tab's line + paragraph spacing popover (task A3): Word's line
 * spacing presets, a custom multiple and the before/after spacing boxes. */
export function ParagraphSpacingPicker({
  lineSpacing,
  spaceBeforePt,
  spaceAfterPt,
  disabled = false,
  onLineSpacing,
  onSpaceBefore,
  onSpaceAfter,
}: ParagraphSpacingPickerProps) {
  const { t } = useTranslation();
  const [lineDraft, setLineDraft] = useState(() => draftOf(lineSpacing));
  const [beforeDraft, setBeforeDraft] = useState(() => draftOf(spaceBeforePt));
  const [afterDraft, setAfterDraft] = useState(() => draftOf(spaceAfterPt));

  useEffect(() => {
    setLineDraft(draftOf(lineSpacing));
  }, [lineSpacing]);
  useEffect(() => {
    setBeforeDraft(draftOf(spaceBeforePt));
  }, [spaceBeforePt]);
  useEffect(() => {
    setAfterDraft(draftOf(spaceAfterPt));
  }, [spaceAfterPt]);

  const commitLine = (raw: string): void => {
    const parsed = parseMultiple(raw);
    if (parsed === undefined) {
      setLineDraft(draftOf(lineSpacing));
      return;
    }
    // Blank or 0 clears the multiple back to inherit, matching the command
    // layer's null handling.
    if (parsed === null || parsed === 0) {
      if (lineSpacing === null) {
        setLineDraft(draftOf(lineSpacing));
        return;
      }
      onLineSpacing(null);
      return;
    }
    if (lineSpacing !== null && Math.round(parsed * 100) === Math.round(lineSpacing * 100)) {
      setLineDraft(draftOf(lineSpacing));
      return;
    }
    onLineSpacing(parsed);
  };

  const commitSpace = (raw: string, value: number | null, onSet: (pt: number | null) => void, restore: (draft: string) => void): void => {
    const parsed = parsePt(raw);
    if (parsed === undefined) {
      restore(draftOf(value));
      return;
    }
    // Blank or 0 clears the spacing back to inherit; the OOXML writer only
    // emits positive w:before/w:after, so an explicit 0 is not representable.
    if (parsed === null || parsed === 0) {
      if (value === null) {
        restore(draftOf(value));
        return;
      }
      onSet(null);
      return;
    }
    if (value !== null && Math.round(parsed * 2) === Math.round(value * 2)) {
      restore(draftOf(value));
      return;
    }
    onSet(parsed);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("office.docx.toolbar.paragraph.spacing")}
            data-testid="docx-paragraph-spacing"
          />
        }
      >
        <AlignVerticalSpaceAround aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-2 p-2">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">{t("office.docx.toolbar.paragraph.lineSpacing")}</span>
          <div role="group" aria-label={t("office.docx.toolbar.paragraph.lineSpacing")} className="grid grid-cols-4 gap-0.5">
            {LINE_SPACING_PRESETS.map((preset) => {
              const active = lineSpacing !== null && Math.round(lineSpacing * 100) === Math.round(preset * 100);
              return (
                <Button
                  key={preset}
                  type="button"
                  variant="toolbar"
                  size="sm"
                  aria-pressed={active}
                  className={cn("h-7 px-0 text-label", active && "bg-surface-selected")}
                  onClick={() => onLineSpacing(preset)}
                  data-testid="docx-line-spacing-option"
                >
                  {formatLineSpacing(preset)}
                </Button>
              );
            })}
          </div>
          <Input
            value={lineDraft}
            inputMode="decimal"
            disabled={disabled}
            aria-label={t("office.docx.toolbar.paragraph.lineSpacingCustom")}
            placeholder={t("office.docx.toolbar.paragraph.lineSpacingCustomHint")}
            onChange={(event) => setLineDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commitLine(event.currentTarget.value);
            }}
            onBlur={(event) => commitLine(event.currentTarget.value)}
            data-testid="docx-line-spacing-custom"
            className="h-7 w-full px-1.5 text-label"
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-muted-foreground">{t("office.docx.toolbar.paragraph.spaceBefore")}</span>
            <Input
              value={beforeDraft}
              inputMode="decimal"
              disabled={disabled}
              onChange={(event) => setBeforeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitSpace(event.currentTarget.value, spaceBeforePt, onSpaceBefore, setBeforeDraft);
              }}
              onBlur={(event) => commitSpace(event.currentTarget.value, spaceBeforePt, onSpaceBefore, setBeforeDraft)}
              data-testid="docx-space-before"
              className="h-7 w-full px-1.5 text-label"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-muted-foreground">{t("office.docx.toolbar.paragraph.spaceAfter")}</span>
            <Input
              value={afterDraft}
              inputMode="decimal"
              disabled={disabled}
              onChange={(event) => setAfterDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitSpace(event.currentTarget.value, spaceAfterPt, onSpaceAfter, setAfterDraft);
              }}
              onBlur={(event) => commitSpace(event.currentTarget.value, spaceAfterPt, onSpaceAfter, setAfterDraft)}
              data-testid="docx-space-after"
              className="h-7 w-full px-1.5 text-label"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

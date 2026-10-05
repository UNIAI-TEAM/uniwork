"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { parsePageRanges } from "../page-ops";
import { pdfPageBoxErrorMessage } from "./provider";
import type { PdfPageBoxKind, PdfPageBoxRect, PdfPageSizeDialogProps } from "./types";

/** A4 in PDF points: the sheet the presets fall back to when the host has no
    measured page size for the selection. */
const A4_POINTS = { width: 595.28, height: 841.89 };

const BOXES: readonly PdfPageBoxKind[] = ["media", "crop"];

const PRESETS = ["full", "inset", "left", "top"] as const;
type RectPreset = (typeof PRESETS)[number];

/** Which displayed pages the dialog acts on: every page, or a typed list. */
export function resolvePageSelection(
  pages: readonly number[],
  allPages: boolean,
  ranges: string,
): number[] | null {
  if (pages.length === 0) return null;
  if (allPages) return [...pages];
  const parsed = parsePageRanges(ranges, Math.max(...pages));
  if (!parsed) return null;
  const allowed = new Set(pages);
  const selected = parsed.filter((page) => allowed.has(page));
  return selected.length === parsed.length && selected.length > 0 ? selected : null;
}

/** The rectangle a preset fills the four fields with, in PDF points. */
function presetRect(preset: RectPreset, size: { width: number; height: number }): PdfPageBoxRect {
  const { width, height } = size;
  switch (preset) {
    case "inset":
      return [width * 0.1, height * 0.1, width * 0.9, height * 0.9];
    case "left":
      return [0, 0, width / 2, height];
    case "top":
      return [0, height / 2, width, height];
    case "full":
    default:
      return [0, 0, width, height];
  }
}

/** Two decimals is more precision than a page box needs and keeps the field
    readable instead of showing 535.7519999999999. */
function display(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function parseRect(fields: readonly string[]): PdfPageBoxRect | null {
  if (fields.length !== 4) return null;
  const numbers = fields.map((value) => (value.trim() === "" ? Number.NaN : Number(value)));
  if (!numbers.every(Number.isFinite)) return null;
  const [left, bottom, right, top] = numbers as PdfPageBoxRect;
  if (right <= left || top <= bottom) return null;
  return [left, bottom, right, top];
}

export interface PdfPageScopeFieldProps {
  /** 1-based displayed page numbers the document currently offers. */
  pages: readonly number[];
  allPages: boolean;
  onAllPagesChange: (next: boolean) => void;
  ranges: string;
  onRangesChange: (next: string) => void;
  /** Prefix for the field ids, so two dialogs on one page never collide. */
  idPrefix: string;
  disabled?: boolean;
}

/** Shared "all pages or a typed list" control. Both page-box dialogs target
    pages the same way, so the parsing and its labels live in one place. */
export function PdfPageScopeField({
  pages,
  allPages,
  onAllPagesChange,
  ranges,
  onRangesChange,
  idPrefix,
  disabled = false,
}: PdfPageScopeFieldProps) {
  const { t } = useTranslation();
  const allId = `${idPrefix}-all`;
  const rangesId = `${idPrefix}-ranges`;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={allId}
          aria-label={t("office.pdf.pageBox.pages.all", { count: pages.length })}
          checked={allPages}
          disabled={disabled}
          onCheckedChange={(next) => onAllPagesChange(next === true)}
        />
        <Label htmlFor={allId} className="font-normal">
          {t("office.pdf.pageBox.pages.all", { count: pages.length })}
        </Label>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={rangesId}>{t("office.pdf.pageBox.pages.ranges")}</Label>
        <Input
          id={rangesId}
          value={ranges}
          placeholder={t("office.pdf.pageBox.pages.rangesPlaceholder")}
          disabled={disabled || allPages}
          onChange={(event) => onRangesChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * Page size dialog: pick the media or crop box of the target pages and either
 * choose a rectangle preset or type one. The dialog never serializes — the
 * provider validates and submits one `setPageBox` envelope.
 */
export function PdfPageSizeDialog({
  open,
  pages,
  provider,
  disabled = false,
  pageSize,
  onOpenChange,
  onApplied,
}: PdfPageSizeDialogProps) {
  const { t } = useTranslation();
  const [box, setBox] = useState<PdfPageBoxKind>("crop");
  const [allPages, setAllPages] = useState(true);
  const [ranges, setRanges] = useState("");
  const [preset, setPreset] = useState<RectPreset>("full");
  const [rectFields, setRectFields] = useState<readonly string[]>(() => presetRect("full", A4_POINTS).map(display));

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  // Primitive dependencies: a `pageSize` object literal from the host would
  // otherwise be a new reference each render and re-run the reset effect.
  const width = pageSize?.width ?? A4_POINTS.width;
  const height = pageSize?.height ?? A4_POINTS.height;

  useEffect(() => {
    if (open && !wasOpen.current) {
      setBox("crop");
      setAllPages(true);
      setRanges("");
      setPreset("full");
      setRectFields(presetRect("full", { width, height }).map(display));
      setPending(false);
      setError(null);
    }
    wasOpen.current = open;
  }, [open, width, height]);

  const boxItems = useMemo(
    () => BOXES.map((value) => ({ value, label: t(`office.pdf.pageBox.box.${value}`) })),
    [t],
  );

  const applyPreset = (next: RectPreset) => {
    setPreset(next);
    setRectFields(presetRect(next, { width, height }).map(display));
    setError(null);
  };

  const updateRect = (index: number, value: string) => {
    setRectFields((current) => current.map((field, at) => (at === index ? value : field)));
    setError(null);
  };

  const submit = () => {
    if (disabled || pending) return;
    const targets = resolvePageSelection(pages, allPages, ranges);
    if (!targets) {
      setError(t("office.pdf.pageBox.errors.pages"));
      return;
    }
    const rect = parseRect(rectFields);
    if (!rect) {
      setError(t("office.pdf.pageBox.errors.rect"));
      return;
    }
    setPending(true);
    setError(null);
    void (async () => {
      try {
        await provider.setPageBox({ pages: targets, box, rect });
        onApplied?.();
        onOpenChange(false);
      } catch (reason) {
        setError(pdfPageBoxErrorMessage(reason, t));
      } finally {
        setPending(false);
      }
    })();
  };

  const locked = disabled || pending;
  const rectIds = ["left", "bottom", "right", "top"] as const;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!pending}
        closeLabel={t("office.pdf.pageBox.close")}
        data-testid="pdf-page-size-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("office.pdf.pageBox.pageSize.title")}</DialogTitle>
          <DialogDescription>{t("office.pdf.pageBox.pageSize.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <PdfPageScopeField
            pages={pages}
            allPages={allPages}
            onAllPagesChange={setAllPages}
            ranges={ranges}
            onRangesChange={(next) => { setRanges(next); setError(null); }}
            idPrefix="pdf-page-box-size"
            disabled={locked}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="pdf-page-box-size-box">{t("office.pdf.pageBox.box.label")}</Label>
            <Select
              id="pdf-page-box-size-box"
              aria-label={t("office.pdf.pageBox.box.label")}
              value={box}
              items={boxItems}
              disabled={locked}
              onValueChange={(value) => {
                const next = typeof value === "string" ? value : "";
                if (next === "media" || next === "crop") setBox(next);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-body font-medium">{t("office.pdf.pageBox.rect.preset.label")}</span>
            <div role="group" aria-label={t("office.pdf.pageBox.rect.preset.label")} className="flex flex-wrap gap-1">
              {PRESETS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={preset === value ? "secondary" : "outline"}
                  aria-pressed={preset === value}
                  disabled={locked}
                  onClick={() => applyPreset(value)}
                >
                  {t(`office.pdf.pageBox.rect.preset.${value}`)}
                </Button>
              ))}
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-body font-medium">{t("office.pdf.pageBox.rect.legend")}</legend>
            <p className="text-caption text-muted-foreground">
              {t("office.pdf.pageBox.rect.unit", { width: display(width), height: display(height) })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {rectIds.map((side, index) => {
                const id = `pdf-page-box-size-rect-${side}`;
                return (
                  <div key={side} className="grid gap-1">
                    <Label htmlFor={id} className="text-caption">{t(`office.pdf.pageBox.rect.${side}`)}</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={id}
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        value={rectFields[index] ?? ""}
                        disabled={locked}
                        onChange={(event) => updateRect(index, event.target.value)}
                      />
                      <span aria-hidden className="text-caption text-muted-foreground">
                        {t("office.pdf.pageBox.rect.points")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>

        {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("office.pdf.pageBox.cancel")}
          </Button>
          <Button type="button" disabled={locked || pages.length === 0} onClick={submit}>
            {pending ? t("office.pdf.pageBox.applying") : t("office.pdf.pageBox.pageSize.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

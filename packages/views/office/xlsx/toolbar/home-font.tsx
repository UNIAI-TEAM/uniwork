"use client";

import { Bold, Highlighter, Italic, Minus, PaintBucket, Plus, Strikethrough, Underline, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Select } from "@uniwork/ui/components/ui/select";
import { clampFontSize, stepFontSize, XLSX_DEFAULT_FONT_FAMILY, XLSX_DEFAULT_FONT_SIZE, XLSX_FONT_FAMILIES, XLSX_PALETTE_COLORS } from "./home-format";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";

const SIZE_DECREASE = -1;
const SIZE_INCREASE = 1;

/** The shared swatch grid: workbook colour data, the active swatch mirrored
 *  with `aria-pressed`; chrome stays on semantic tokens. */
function ColorPicker({
  label,
  currentColor,
  onPick,
  resetLabel,
  onReset,
}: {
  label: string;
  currentColor: string | null;
  onPick: (color: string) => void;
  resetLabel: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div role="group" aria-label={label} className="grid grid-cols-5 gap-1">
        {XLSX_PALETTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("office.xlsx.toolbar.groups.font.colorValue", { color })}
            aria-pressed={color.toLowerCase() === currentColor?.toLowerCase()}
            className="size-5 rounded-sm border border-border"
            style={{ backgroundColor: color }}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
      <Button type="button" variant="toolbar" size="sm" onClick={onReset}>
        {resetLabel}
      </Button>
    </>
  );
}

/** Home > font: family, size, the four toggles and the two colour pickers. */
export function XlsxFontGroup({ readOnly = false, canFormat, commands, formatState }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const size = formatState?.fontSize ?? null;
  const [sizeDraft, setSizeDraft] = useState(String(size ?? XLSX_DEFAULT_FONT_SIZE));
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [fillColorOpen, setFillColorOpen] = useState(false);

  useEffect(() => {
    setSizeDraft(String(formatState?.fontSize ?? XLSX_DEFAULT_FONT_SIZE));
  }, [formatState?.fontSize]);

  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(commands, id, params);
  };
  const commitSize = () => {
    if (!/^\d+$/.test(sizeDraft)) {
      setSizeDraft(String(size ?? XLSX_DEFAULT_FONT_SIZE));
      return;
    }
    const next = clampFontSize(Number.parseInt(sizeDraft, 10));
    setSizeDraft(String(next));
    run("sheet.command.set-font-size", { value: next });
  };
  const toggle = (id: string, active: boolean, label: string, Icon: LucideIcon) => (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      className={XLSX_ICON_BUTTON_CLASS}
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-disabled={blocked || undefined}
      onClick={() => run(id)}
    >
      <Icon aria-hidden />
    </Button>
  );

  return (
    <XlsxGroupBody>
    <XlsxGroupRows>
    <XlsxGroupRow>
      <div className="w-36 min-w-35 shrink-0">
      <Select
        aria-label={t("office.xlsx.toolbar.groups.font.family")}
        triggerVariant="subtle"
        disabled={blocked}
        value={formatState?.fontFamily ?? XLSX_DEFAULT_FONT_FAMILY}
        onValueChange={(value) => run("sheet.command.set-font-family", { value })}
        items={XLSX_FONT_FAMILIES.map((family) => ({ value: family, label: family }))}
      />
      </div>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        className={XLSX_ICON_BUTTON_CLASS}
        aria-label={t("office.xlsx.toolbar.groups.font.sizeDecrease")}
        title={t("office.xlsx.toolbar.groups.font.sizeDecrease")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-font-size", { value: stepFontSize(size, SIZE_DECREASE) })}
      >
        <Minus aria-hidden />
      </Button>
      <Input
        className="h-6 w-12 min-w-12 px-1 text-center text-caption"
        inputMode="numeric"
        aria-label={t("office.xlsx.toolbar.groups.font.size")}
        disabled={blocked}
        value={sizeDraft}
        onChange={(event) => setSizeDraft(event.target.value)}
        onBlur={commitSize}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitSize();
        }}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        className={XLSX_ICON_BUTTON_CLASS}
        aria-label={t("office.xlsx.toolbar.groups.font.sizeIncrease")}
        title={t("office.xlsx.toolbar.groups.font.sizeIncrease")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-font-size", { value: stepFontSize(size, SIZE_INCREASE) })}
      >
        <Plus aria-hidden />
      </Button>
    </XlsxGroupRow>
    <XlsxGroupRow>
      {toggle("sheet.command.set-bold", formatState?.bold === true, t("office.xlsx.toolbar.groups.font.bold"), Bold)}
      {toggle("sheet.command.set-italic", formatState?.italic === true, t("office.xlsx.toolbar.groups.font.italic"), Italic)}
      {toggle("sheet.command.set-underline", formatState?.underline === true, t("office.xlsx.toolbar.groups.font.underline"), Underline)}
      {toggle("sheet.command.set-stroke", formatState?.strike === true, t("office.xlsx.toolbar.groups.font.strike"), Strikethrough)}
      <Popover open={textColorOpen} onOpenChange={(next) => setTextColorOpen(blocked ? false : next)}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              className={XLSX_ICON_BUTTON_CLASS}
              aria-label={t("office.xlsx.toolbar.groups.font.textColor")}
              title={t("office.xlsx.toolbar.groups.font.textColor")}
              aria-disabled={blocked || undefined}
            />
          }
        >
          <span className="flex flex-col items-center gap-px">
            <Highlighter aria-hidden />
            {formatState?.textColor ? (
              <span aria-hidden className="h-0.5 w-3.5 rounded-sm" style={{ backgroundColor: formatState.textColor }} />
            ) : null}
          </span>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label={t("office.xlsx.toolbar.groups.font.textColor")} align="start" className="w-auto max-w-56 flex-col gap-2 p-2">
          <ColorPicker
            label={t("office.xlsx.toolbar.groups.font.textColor")}
            currentColor={formatState?.textColor ?? null}
            onPick={(color) => run("sheet.command.set-text-color", { value: color })}
            resetLabel={t("office.xlsx.toolbar.groups.font.textColorAutomatic")}
            onReset={() => run("sheet.command.reset-text-color")}
          />
        </PopoverContent>
      </Popover>
      <Popover open={fillColorOpen} onOpenChange={(next) => setFillColorOpen(blocked ? false : next)}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              className={XLSX_ICON_BUTTON_CLASS}
              aria-label={t("office.xlsx.toolbar.groups.font.fillColor")}
              title={t("office.xlsx.toolbar.groups.font.fillColor")}
              aria-disabled={blocked || undefined}
            />
          }
        >
          <span className="flex flex-col items-center gap-px">
            <PaintBucket aria-hidden />
            {formatState?.fillColor ? (
              <span aria-hidden className="h-0.5 w-3.5 rounded-sm" style={{ backgroundColor: formatState.fillColor }} />
            ) : null}
          </span>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label={t("office.xlsx.toolbar.groups.font.fillColor")} align="start" className="w-auto max-w-56 flex-col gap-2 p-2">
          <ColorPicker
            label={t("office.xlsx.toolbar.groups.font.fillColor")}
            currentColor={formatState?.fillColor ?? null}
            onPick={(color) => run("sheet.command.set-background-color", { value: color })}
            resetLabel={t("office.xlsx.toolbar.groups.font.fillColorNone")}
            onReset={() => run("sheet.command.reset-background-color")}
          />
        </PopoverContent>
      </Popover>
    </XlsxGroupRow>
    </XlsxGroupRows>
    </XlsxGroupBody>
  );
}

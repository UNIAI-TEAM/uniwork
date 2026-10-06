"use client";

import { ChevronDown, DollarSign, DecimalsArrowLeft, DecimalsArrowRight, Percent } from "lucide-react";
import { useCallback, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonIcon, RibbonItem } from "../../ribbon";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import {
  numberFormatCommandParams,
  patternNameKey,
  presetPattern,
  selectionFormatCells,
  validateCustomFormat,
  XLSX_NUMBER_FORMAT_CATEGORIES,
  XLSX_NUMBER_FORMAT_COMMANDS,
  type XlsxCustomFormatError,
} from "./catalog";
import { appliedFormatKey, readAppliedPattern, recordAppliedFormat, useAppliedPattern } from "./applied-format";
import { autoFitColumnsAfterFormat, moreDecimals } from "./auto-fit-width";
import { useFileNumberFormat } from "./file-format";
import { fireCommand } from "../fire-command";
import { useCloseOnOutsidePointerDown } from "../toolbar/use-close-on-outside-pointerdown";

const CUSTOM_ERROR_KEYS: Record<XlsxCustomFormatError, string> = {
  empty: "office.xlsx.toolbar.groups.numberFormat.customError.empty",
  tooLong: "office.xlsx.toolbar.groups.numberFormat.customError.tooLong",
  controlChar: "office.xlsx.toolbar.groups.numberFormat.customError.controlChar",
};

const CATEGORY_LABEL_DOM_ID = "xlsx-number-format-category";
const CUSTOM_LABEL_DOM_ID = "xlsx-number-format-custom-label";
const THOUSANDS_GLYPH = "000";

/** A thousands-separator glyph (Excel's Comma Style); lucide has none. */
const ThousandsIcon: RibbonIcon = ({ className }) => (
  <span aria-hidden className={`${className ?? ""} text-caption font-bold leading-none`}>{THOUSANDS_GLYPH}</span>
);

function isBlocked({ readOnly = false, canFormat, commands, selection }: XlsxToolbarGroupProps): boolean {
  return readOnly || !canFormat || !commands || selectionFormatCells(selection) === null;
}

/** Applies one pattern to the selection and remembers it for the format box. */
function applyPatternTo(context: XlsxToolbarGroupProps, pattern: string): void {
  const cells = selectionFormatCells(context.selection);
  if (isBlocked(context) || !cells) return;
  fireCommand(context.commands, XLSX_NUMBER_FORMAT_COMMANDS.set, numberFormatCommandParams(cells, pattern));
  recordAppliedFormat(appliedFormatKey(context.unitId, context.selection), pattern);
  void autoFitColumnsAfterFormat(context, pattern);
}

/** Home > Number as typed ribbon items. Row 1 is the format box (a custom icon
 *  item so it packs in the strip); row 2 is Currency, Percent, Comma and the
 *  two decimal steppers. Every pattern comes from the catalog presets. Controls
 *  stay rendered and switch to `aria-disabled` for read-only, no-selection,
 *  oversized-selection or missing-port states; each handler re-checks. */
export function xlsxNumberRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const blocked = isBlocked(context);
  const preset = (id: string, itemId: string, labelKey: string, icon: RibbonIcon, rowBreak = false): RibbonItem => ({
    kind: "button",
    id: itemId,
    labelKey,
    icon,
    size: "icon",
    collapseAs: "icon",
    rowBreak,
    disabled: blocked,
    onExecute: () => applyPatternTo(context, presetPattern(id)),
  });
  const step = (command: string, widen = false) => () => {
    if (blocked) return;
    fireCommand(context.commands, command);
    if (!widen) return;
    // The port cannot read the format back: widen from the last applied one.
    const base = readAppliedPattern(appliedFormatKey(context.unitId, context.selection)) ?? "0";
    void autoFitColumnsAfterFormat(context, moreDecimals(base));
  };
  return [
    {
      kind: "custom",
      id: "number-format-picker",
      labelKey: "office.xlsx.commands.numberFormat",
      size: "icon",
      collapseAs: "icon",
      width: 120,
      disabled: blocked,
      render: () => <XlsxNumberFormatPicker {...context} />,
    },
    preset("currency-usd", "number-currency", "office.xlsx.toolbar.groups.numberFormat.categories.currency", DollarSign, true),
    preset("percent-integer", "number-percent", "office.xlsx.toolbar.groups.numberFormat.categories.percent", Percent),
    preset("number-thousands-decimal2", "number-comma", "office.xlsx.toolbar.groups.numberFormat.comma", ThousandsIcon),
    {
      kind: "button",
      id: "number-increase-decimals",
      labelKey: "office.xlsx.toolbar.groups.numberFormat.increaseDecimals",
      icon: DecimalsArrowRight,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: step(XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals, true),
    },
    {
      kind: "button",
      id: "number-decrease-decimals",
      labelKey: "office.xlsx.toolbar.groups.numberFormat.decreaseDecimals",
      icon: DecimalsArrowLeft,
      size: "icon",
      collapseAs: "icon",
      disabled: blocked,
      onExecute: step(XLSX_NUMBER_FORMAT_COMMANDS.decreaseDecimals),
    },
  ];
}

/** The format box: shows the format last applied to the selection (General
 *  when unknown - the port cannot read it back) and opens the preset gallery
 *  plus the custom-code entry. The gallery is stateless about the selection's
 *  real format, so no preset is marked active. */
function XlsxNumberFormatPicker(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<XlsxCustomFormatError | null>(null);
  const { selection, unitId } = context;
  const blocked = isBlocked(context);
  const sessionPattern = useAppliedPattern(appliedFormatKey(unitId, selection));
  const filePattern = useFileNumberFormat(context);
  const applied = sessionPattern ?? filePattern;
  const closePopover = useCallback(() => setOpen(false), []);
  const finalFocus = useCloseOnOutsidePointerDown(open, closePopover);

  const applyPattern = (pattern: string) => {
    if (blocked) return;
    applyPatternTo(context, pattern);
  };

  const applyPreset = (pattern: string) => {
    if (blocked) return;
    applyPattern(pattern);
    setOpen(false);
  };

  const applyCustom = () => {
    if (blocked) return;
    const result = validateCustomFormat(customDraft);
    if ("error" in result) {
      setCustomError(result.error);
      return;
    }
    setCustomError(null);
    applyPattern(result.pattern);
    setOpen(false);
  };

  const submitCustomOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyCustom();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(blocked ? false : next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            // w-29 is the spacing-scale spelling of the 116px picker width
            // (29 * 0.25rem = 7.25rem), so the rendered width is unchanged.
            className="h-6 w-29 justify-between rounded-sm border border-input bg-background px-1.5 font-normal pointer-coarse:h-11"
            title={t("office.xlsx.commands.numberFormat")}
            aria-label={t("office.xlsx.commands.numberFormat")}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-number-format-trigger"
          />
        }
      >
        <span className="flex w-full items-center justify-between gap-1">
          <span className="truncate text-caption">{t(patternNameKey(applied))}</span>
          <ChevronDown aria-hidden className="shrink-0" />
        </span>
      </PopoverTrigger>
      <PopoverContent finalFocus={finalFocus}
        role="dialog"
        aria-label={t("office.xlsx.toolbar.groups.numberFormat.gallery")}
        align="start"
        data-testid="xlsx-number-format-gallery"
        className="max-h-[60vh] w-56 gap-3 overflow-y-auto"
      >
        {XLSX_NUMBER_FORMAT_CATEGORIES.map((category) => {
          const labelId = `${CATEGORY_LABEL_DOM_ID}-${category.id}`;
          return (
            <div key={category.id} role="group" aria-labelledby={labelId} data-testid={`xlsx-number-format-category-${category.id}`}>
              <p id={labelId} className="px-1 pb-1 text-caption font-medium text-muted-foreground">
                {t(category.labelKey)}
              </p>
              <div className="flex flex-col gap-0.5">
                {category.presets.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start font-mono"
                    data-testid={`xlsx-number-format-preset-${preset.id}`}
                    onClick={() => applyPreset(preset.pattern)}
                  >
                    {t(preset.labelKey)}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
        <div role="group" aria-labelledby={CUSTOM_LABEL_DOM_ID} className="flex flex-col gap-1 border-t border-border pt-2">
          <p id={CUSTOM_LABEL_DOM_ID} className="px-1 text-caption font-medium text-muted-foreground">
            {t("office.xlsx.toolbar.groups.numberFormat.custom")}
          </p>
          <div className="flex items-center gap-1">
            <Input
              className="h-7 min-w-0 flex-1 px-2 font-mono text-caption"
              aria-label={t("office.xlsx.toolbar.groups.numberFormat.customInput")}
              aria-invalid={customError !== null || undefined}
              placeholder={t("office.xlsx.toolbar.groups.numberFormat.customPlaceholder")}
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={submitCustomOnEnter}
              data-testid="xlsx-number-format-custom-input"
            />
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              onClick={applyCustom}
              data-testid="xlsx-number-format-custom-apply"
            >
              {t("office.xlsx.toolbar.groups.numberFormat.customApply")}
            </Button>
          </div>
          {customError ? (
            <p role="alert" className="px-1 text-caption text-destructive" data-testid="xlsx-number-format-custom-error">
              {t(CUSTOM_ERROR_KEYS[customError])}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

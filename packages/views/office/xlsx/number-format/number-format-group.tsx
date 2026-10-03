"use client";

import { ChevronDown, Minus, Plus } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import {
  numberFormatCommandParams,
  selectionFormatCells,
  validateCustomFormat,
  XLSX_NUMBER_FORMAT_CATEGORIES,
  XLSX_NUMBER_FORMAT_COMMANDS,
  type XlsxCustomFormatError,
} from "./catalog";
import { runNumberFormatCommand } from "./command-runner";

const CUSTOM_ERROR_KEYS: Record<XlsxCustomFormatError, string> = {
  empty: "office.xlsx.toolbar.groups.numberFormat.customError.empty",
  tooLong: "office.xlsx.toolbar.groups.numberFormat.customError.tooLong",
  controlChar: "office.xlsx.toolbar.groups.numberFormat.customError.controlChar",
};

const CATEGORY_LABEL_DOM_ID = "xlsx-number-format-category";
const CUSTOM_LABEL_DOM_ID = "xlsx-number-format-custom-label";

/** Home > number format: the preset gallery (popover) plus the pinned
 *  increase/decrease-decimal commands. The gallery is stateless: the renderer
 *  port cannot read the selection's current number format, so no preset is
 *  marked active. Every control stays rendered and switches to
 *  `aria-disabled` for read-only, no-selection, oversized-selection or
 *  missing-port states. */
export function XlsxNumberFormatGroup({ readOnly = false, canFormat, commands, selection }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<XlsxCustomFormatError | null>(null);
  const cells = useMemo(() => selectionFormatCells(selection), [selection]);
  const blocked = readOnly || !canFormat || !commands || cells === null;

  const applyPattern = (pattern: string) => {
    if (blocked || !cells) return;
    runNumberFormatCommand(commands, XLSX_NUMBER_FORMAT_COMMANDS.set, numberFormatCommandParams(cells, pattern));
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

  const stepDecimals = (id: string) => {
    if (blocked) return;
    runNumberFormatCommand(commands, id);
  };

  const submitCustomOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyCustom();
  };

  return (
    <>
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
              aria-label={t("office.xlsx.commands.numberFormat")}
              aria-disabled={blocked || undefined}
              data-testid="xlsx-number-format-trigger"
            />
          }
        >
          <span className="flex items-center gap-1">
            <span aria-hidden className="text-caption font-semibold">123</span>
            <ChevronDown aria-hidden />
          </span>
        </PopoverTrigger>
        <PopoverContent
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
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.toolbar.groups.numberFormat.decreaseDecimals")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-number-format-decrease-decimals"
        onClick={() => stepDecimals(XLSX_NUMBER_FORMAT_COMMANDS.decreaseDecimals)}
      >
        <Minus aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.toolbar.groups.numberFormat.increaseDecimals")}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-number-format-increase-decimals"
        onClick={() => stepDecimals(XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals)}
      >
        <Plus aria-hidden />
      </Button>
    </>
  );
}

"use client";

// Conditional Formatting preset dialog (Highlight Cells Rules): one mode per
// preset, a "with" style choice and inline validation. OK builds the rule via
// cf-commands.ts and fires the pinned add-rule command through the toolbar's
// command port; the group owns open/close state.

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { runRuleCommand } from "../data-validation/run-rule-command";
import type { XlsxCfEditable } from "./cf-live-rule";
import type { XlsxToolbarCommands } from "../toolbar/types";
import {
  addRuleParams,
  buildCfInnerRule,
  cfStyleOf,
  setRuleParams,
  XLSX_CF_ADD_COMMAND,
  XLSX_CF_SET_COMMAND,
  XLSX_CF_STYLE_IDS,
  type XlsxCfPreset,
  type XlsxCfRange,
  type XlsxCfStyleId,
} from "./cf-commands";

interface XlsxConditionalFormatDialogProps {
  preset: XlsxCfPreset;
  unitId: string;
  subUnitId: string;
  range: XlsxCfRange;
  commands: XlsxToolbarCommands;
  readOnly?: boolean;
  /** Edit mode (rule manager): the dialog opens with the rule's values and OK
   *  replaces rule `cfId` in place, keeping its areas and stop-if-true. */
  edit?: {
    cfId: string;
    ranges: readonly XlsxCfRange[];
    stopIfTrue: boolean;
    initial: XlsxCfEditable;
  };
  onClose: () => void;
}

/** The "keep the rule's current format" option of an edited rule whose format
 *  is not one of the presets. */
const CURRENT_STYLE = "current";

const BASE = "office.xlsx.conditionalFormat";

export function XlsxConditionalFormatDialog({
  preset,
  unitId,
  subUnitId,
  range,
  commands,
  readOnly = false,
  edit,
  onClose,
}: XlsxConditionalFormatDialogProps) {
  const { t } = useTranslation();
  const ids = useId();
  const firstId = `${ids}-first`;
  const secondId = `${ids}-second`;
  const styleFieldId = `${ids}-style`;
  const errorId = `${ids}-error`;
  const [first, setFirst] = useState(edit?.initial.first ?? "");
  const [second, setSecond] = useState(edit?.initial.second ?? "");
  const keepsStyle = edit !== undefined && edit.initial.styleId === null;
  const [styleId, setStyleId] = useState<XlsxCfStyleId | typeof CURRENT_STYLE>(
    edit ? (edit.initial.styleId ?? CURRENT_STYLE) : "lightRedDarkRed",
  );
  const [error, setError] = useState<string | null>(null);
  const numeric = preset === "greaterThan" || preset === "lessThan" || preset === "between";
  const previewStyle = styleId === CURRENT_STYLE ? (edit?.initial.style as ReturnType<typeof cfStyleOf> | undefined) ?? {} : cfStyleOf(styleId);

  const [refused, setRefused] = useState(false);
  const [pending, setPending] = useState(false);

  const apply = async () => {
    setError(null);
    setRefused(false);
    if (readOnly || pending) return;
    const built = buildCfInnerRule(preset, { first, second }, styleId === CURRENT_STYLE ? "lightRedDarkRed" : styleId);
    if (!built.ok) {
      setError(t(`${BASE}.errors.${built.error}`));
      return;
    }
    const inner = styleId === CURRENT_STYLE ? { ...built.inner, style: edit?.initial.style } : built.inner;
    setPending(true);
    const accepted = edit
      ? await runRuleCommand(
          commands,
          XLSX_CF_SET_COMMAND,
          setRuleParams(unitId, subUnitId, edit.cfId, edit.ranges, edit.stopIfTrue, inner),
        )
      : await runRuleCommand(commands, XLSX_CF_ADD_COMMAND, addRuleParams(unitId, subUnitId, range, inner));
    setPending(false);
    if (accepted) onClose();
    else setRefused(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void apply();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="xlsx-cf-dialog" closeLabel={t(`${BASE}.dialog.close`)}>
        <DialogHeader>
          <DialogTitle>{t(`${BASE}.titles.${preset}`)}</DialogTitle>
          <DialogDescription>{t(`${BASE}.descriptions.${preset}`)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {numeric ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-1">
                <Label htmlFor={firstId} className="text-caption font-medium">
                  {t(`${BASE}.dialog.${preset === "between" ? "minimum" : "value"}`)}
                </Label>
                <Input
                  id={firstId}
                  inputMode="decimal"
                  value={first}
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  data-testid="xlsx-cf-first"
                  onChange={(event) => { setFirst(event.target.value); setRefused(false); }}
                  onKeyDown={onKeyDown}
                />
              </div>
              {preset === "between" ? (
                <>
                  <span className="pb-2 text-caption text-muted-foreground">{t(`${BASE}.dialog.and`)}</span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <Label htmlFor={secondId} className="text-caption font-medium">
                      {t(`${BASE}.dialog.maximum`)}
                    </Label>
                    <Input
                      id={secondId}
                      inputMode="decimal"
                      value={second}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      data-testid="xlsx-cf-second"
                      onChange={(event) => { setSecond(event.target.value); setRefused(false); }}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {preset === "containsText" ? (
            <div className="grid gap-1">
              <Label htmlFor={firstId} className="text-caption font-medium">
                {t(`${BASE}.dialog.text`)}
              </Label>
              <Input
                id={firstId}
                value={first}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                data-testid="xlsx-cf-first"
                onChange={(event) => { setFirst(event.target.value); setRefused(false); }}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : null}
          {preset === "duplicateValues" || preset === "uniqueValues" ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-cf-duplicate-kind">
              {t(`${BASE}.dialog.${preset === "uniqueValues" ? "uniqueHint" : "duplicateHint"}`)}
            </p>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor={styleFieldId} className="text-caption font-medium">
              {t(`${BASE}.dialog.with`)}
            </Label>
            <div className="flex items-center gap-2">
              <Select
                id={styleFieldId}
                aria-label={t(`${BASE}.dialog.with`)}
                triggerVariant="subtle"
                value={styleId}
                onValueChange={(value) => {
                  setRefused(false);
                  if (value === CURRENT_STYLE && keepsStyle) setStyleId(CURRENT_STYLE);
                  else if (XLSX_CF_STYLE_IDS.some((id) => id === value)) setStyleId(value as XlsxCfStyleId);
                }}
                items={[
                  ...(keepsStyle ? [{ value: CURRENT_STYLE, label: t(`${BASE}.styles.current`) }] : []),
                  ...XLSX_CF_STYLE_IDS.map((id) => ({ value: id, label: t(`${BASE}.styles.${id}`) })),
                ]}
              />
              {/* Previews the cell format that is written into the file, not a theme colour. */}
              <span
                aria-hidden
                data-testid="xlsx-cf-preview"
                className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-caption text-foreground"
                style={{ backgroundColor: previewStyle.bg?.rgb, color: previewStyle.cl?.rgb }}
              >
                {t(`${BASE}.dialog.sample`)}
              </span>
            </div>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-caption text-destructive" data-testid="xlsx-cf-error">
              {error}
            </p>
          ) : null}
          {refused ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-cf-refused">
              {t(`${BASE}.errors.refused`)}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-cf-cancel" onClick={onClose}>
            {t(`${BASE}.dialog.cancel`)}
          </Button>
          <Button type="button" size="sm" aria-disabled={readOnly || pending || undefined} data-testid="xlsx-cf-ok" onClick={apply}>
            {t(`${BASE}.dialog.ok`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

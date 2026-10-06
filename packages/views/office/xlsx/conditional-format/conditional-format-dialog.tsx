"use client";

// Conditional Formatting preset dialog (Highlight Cells Rules): one mode per
// preset, a "with" style choice and inline validation. OK builds the rule via
// cf-commands.ts and fires the pinned add-rule command through the toolbar's
// command port; the group owns open/close state.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { fireCommand } from "../fire-command";
import type { XlsxToolbarCommands } from "../toolbar/types";
import {
  addRuleParams,
  buildCfInnerRule,
  cfStyleOf,
  XLSX_CF_ADD_COMMAND,
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
  onClose: () => void;
}

const BASE = "office.xlsx.conditionalFormat";

export function XlsxConditionalFormatDialog({
  preset,
  unitId,
  subUnitId,
  range,
  commands,
  readOnly = false,
  onClose,
}: XlsxConditionalFormatDialogProps) {
  const { t } = useTranslation();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [styleId, setStyleId] = useState<XlsxCfStyleId>("lightRedDarkRed");
  const [error, setError] = useState<string | null>(null);
  const numeric = preset === "greaterThan" || preset === "lessThan" || preset === "between";
  const previewStyle = cfStyleOf(styleId);

  const apply = () => {
    setError(null);
    if (readOnly) return;
    const built = buildCfInnerRule(preset, { first, second }, styleId);
    if (!built.ok) {
      setError(t(`${BASE}.errors.${built.error}`));
      return;
    }
    fireCommand(commands, XLSX_CF_ADD_COMMAND, addRuleParams(unitId, subUnitId, range, built.inner));
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  };

  const errorId = "xlsx-cf-error";

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
                <Label htmlFor="xlsx-cf-first" className="text-caption font-medium">
                  {t(`${BASE}.dialog.${preset === "between" ? "minimum" : "value"}`)}
                </Label>
                <Input
                  id="xlsx-cf-first"
                  inputMode="decimal"
                  value={first}
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  data-testid="xlsx-cf-first"
                  onChange={(event) => setFirst(event.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>
              {preset === "between" ? (
                <>
                  <span className="pb-2 text-caption text-muted-foreground">{t(`${BASE}.dialog.and`)}</span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <Label htmlFor="xlsx-cf-second" className="text-caption font-medium">
                      {t(`${BASE}.dialog.maximum`)}
                    </Label>
                    <Input
                      id="xlsx-cf-second"
                      inputMode="decimal"
                      value={second}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      data-testid="xlsx-cf-second"
                      onChange={(event) => setSecond(event.target.value)}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {preset === "containsText" ? (
            <div className="grid gap-1">
              <Label htmlFor="xlsx-cf-first" className="text-caption font-medium">
                {t(`${BASE}.dialog.text`)}
              </Label>
              <Input
                id="xlsx-cf-first"
                value={first}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                data-testid="xlsx-cf-first"
                onChange={(event) => setFirst(event.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : null}
          {preset === "duplicateValues" ? (
            <p className="text-caption font-medium" data-testid="xlsx-cf-duplicate-kind">
              {t(`${BASE}.dialog.duplicate`)}
            </p>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="xlsx-cf-style" className="text-caption font-medium">
              {t(`${BASE}.dialog.with`)}
            </Label>
            <div className="flex items-center gap-2">
              <Select
                id="xlsx-cf-style"
                aria-label={t(`${BASE}.dialog.with`)}
                triggerVariant="subtle"
                value={styleId}
                onValueChange={(value) => {
                  if (XLSX_CF_STYLE_IDS.some((id) => id === value)) setStyleId(value as XlsxCfStyleId);
                }}
                items={XLSX_CF_STYLE_IDS.map((id) => ({ value: id, label: t(`${BASE}.styles.${id}`) }))}
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
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-cf-cancel" onClick={onClose}>
            {t(`${BASE}.dialog.cancel`)}
          </Button>
          <Button type="button" size="sm" aria-disabled={readOnly || undefined} data-testid="xlsx-cf-ok" onClick={apply}>
            {t(`${BASE}.dialog.ok`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

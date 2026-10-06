"use client";

// Data > Data Tools > Remove Duplicates (design review X3, Run decision): the
// Excel dialog - "My data has headers", one checkbox per column of the
// selection, Select All / Unselect All - then Excel's result message. The
// rewrite is planned in ./remove-duplicates.ts and runs as one undo step.

import { useId, useState } from "react";
import { CopyMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { toA1Address } from "../../xlsx-render-model-bridge";
import { XlsxLargeButton, XlsxLargeLabel } from "../group-layout";
import { selectionSpan, type XlsxSelectionSpan } from "../structure-insert";
import type { XlsxToolbarGroupProps } from "../types";
import { readSpanCells, runDataToolSteps, writeValuesStep, XLSX_DATA_TOOLS_MAX_CELLS } from "./range-values";
import { headerLabel, planRemoveDuplicates } from "./remove-duplicates";

const BASE = "office.xlsx.dataTools";

type Outcome = { kind: "result"; removed: number; kept: number } | { kind: "failed" } | null;

function columnLetter(column: number): string {
  return toA1Address(0, column).replace(/[0-9]+$/, "");
}

interface DialogBodyProps {
  readonly cells: readonly (readonly (XlsxCellState | null)[])[];
  readonly span: XlsxSelectionSpan;
  readonly onRun: (hasHeader: boolean, columns: readonly number[]) => Promise<Outcome>;
  readonly onClose: () => void;
}

function RemoveDuplicatesBody({ cells, span, onRun, onClose }: DialogBodyProps) {
  const { t } = useTranslation();
  const headerId = useId();
  const width = span.columns;
  const [hasHeader, setHasHeader] = useState(false);
  const [columns, setColumns] = useState<readonly number[]>(() => Array.from({ length: width }, (_, index) => index));
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [running, setRunning] = useState(false);
  const plan = planRemoveDuplicates(cells, { hasHeader, columns });
  const tooBig = span.rows * span.columns > XLSX_DATA_TOOLS_MAX_CELLS;
  const refusal = tooBig
    ? t(`${BASE}.common.limitExceeded`, { limit: XLSX_DATA_TOOLS_MAX_CELLS })
    : typeof plan === "string" ? t(`${BASE}.removeDuplicatesDialog.${plan}`) : null;

  if (outcome !== null) {
    return (
      <>
        <p role="status" className="text-body" data-testid="xlsx-remove-duplicates-result">
          {outcome.kind === "failed"
            ? t(`${BASE}.common.failed`)
            : outcome.removed === 0
              ? t(`${BASE}.removeDuplicatesDialog.resultNone`)
              : t(`${BASE}.removeDuplicatesDialog.result`, { count: outcome.removed, removed: outcome.removed, kept: outcome.kept })}
        </p>
        <DialogFooter>
          <Button type="button" onClick={onClose} data-testid="xlsx-remove-duplicates-done">{t(`${BASE}.common.ok`)}</Button>
        </DialogFooter>
      </>
    );
  }

  const toggle = (column: number, checked: boolean) =>
    setColumns((current) => (checked ? [...current, column].sort((a, b) => a - b) : current.filter((entry) => entry !== column)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setColumns(Array.from({ length: width }, (_, index) => index))}>
          {t(`${BASE}.removeDuplicatesDialog.selectAll`)}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setColumns([])}>
          {t(`${BASE}.removeDuplicatesDialog.unselectAll`)}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Checkbox id={headerId} checked={hasHeader} onCheckedChange={(next) => setHasHeader(next === true)} data-testid="xlsx-remove-duplicates-header" />
          <Label htmlFor={headerId}>{t(`${BASE}.common.hasHeader`)}</Label>
        </div>
      </div>
      <fieldset className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
        <legend className="px-1 text-caption text-muted-foreground">{t(`${BASE}.removeDuplicatesDialog.columns`)}</legend>
        {Array.from({ length: width }, (_, index) => {
          const id = `${headerId}-col-${index}`;
          const fallback = t(`${BASE}.common.column`, { column: columnLetter(span.startColumn + index) });
          return (
            <div key={index} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={columns.includes(index)}
                onCheckedChange={(next) => toggle(index, next === true)}
                data-testid={`xlsx-remove-duplicates-col-${index}`}
              />
              <Label htmlFor={id}>{headerLabel(cells, index, hasHeader) ?? fallback}</Label>
            </div>
          );
        })}
      </fieldset>
      <p className="text-caption text-muted-foreground">{t(`${BASE}.removeDuplicatesDialog.formatNote`)}</p>
      {refusal !== null ? (
        <p role="alert" className="text-caption text-destructive" data-testid="xlsx-remove-duplicates-error">{refusal}</p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t(`${BASE}.common.cancel`)}</Button>
        <Button
          type="button"
          aria-disabled={refusal !== null || running || undefined}
          data-testid="xlsx-remove-duplicates-apply"
          onClick={() => {
            if (refusal !== null || running || typeof plan === "string") return;
            setRunning(true);
            void onRun(hasHeader, columns).then((result) => {
              setRunning(false);
              setOutcome(result);
            });
          }}
        >
          {t(`${BASE}.common.ok`)}
        </Button>
      </DialogFooter>
    </>
  );
}

export function XlsxRemoveDuplicatesButton({ readOnly = false, selection, snapshot, commands, unitId, sheetName, resolveSheetId }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const span = selectionSpan(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || !snapshot || !span || !selection || sheetId === undefined || unitId == null;
  const label = t(`${BASE}.removeDuplicates`);
  const cells = open && !blocked ? readSpanCells(snapshot, selection.sheet, span) : null;

  const run = async (hasHeader: boolean, columns: readonly number[]): Promise<Outcome> => {
    if (blocked || cells === null) return { kind: "failed" };
    const plan = planRemoveDuplicates(cells, { hasHeader, columns });
    if (typeof plan === "string") return { kind: "failed" };
    if (plan.removed === 0) return { kind: "result", removed: 0, kept: plan.kept };
    const ran = await runDataToolSteps(commands, [writeValuesStep(unitId, sheetId, span.startRow, span.startColumn, plan.values)]);
    return ran ? { kind: "result", removed: plan.removed, kept: plan.kept } : { kind: "failed" };
  };

  return (
    <>
      <XlsxLargeButton
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-disabled={blocked || undefined}
        data-testid="xlsx-remove-duplicates"
        onClick={() => { if (!blocked) setOpen(true); }}
      >
        <CopyMinus aria-hidden />
        <XlsxLargeLabel>{label}</XlsxLargeLabel>
      </XlsxLargeButton>
      <Dialog open={open && cells !== null} onOpenChange={setOpen}>
        <DialogContent data-testid="xlsx-remove-duplicates-dialog">
          <DialogHeader>
            <DialogTitle>{t(`${BASE}.removeDuplicatesDialog.title`)}</DialogTitle>
            <DialogDescription>{t(`${BASE}.removeDuplicatesDialog.description`)}</DialogDescription>
          </DialogHeader>
          {cells !== null && span !== null ? (
            <RemoveDuplicatesBody cells={cells} span={span} onRun={run} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

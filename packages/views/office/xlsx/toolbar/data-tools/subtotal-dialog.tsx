"use client";

// Data > Outline > Subtotal: Excel's dialog - "At each change in" (a column of
// the selected list), "Use function", "Add subtotal to" (one checkbox per
// column, the last one checked by default). The inserts, the labels and
// SUBTOTAL formulas and the outline levels are planned in ./subtotal.ts and
// run as one undo step. "Replace current subtotals" and page breaks between
// groups are not offered.

import { useId, useState } from "react";
import { TableRowsSplit } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { toA1Address } from "../../xlsx-render-model-bridge";
import { XlsxLargeButton, XlsxLargeLabel } from "../group-layout";
import { selectionSpan, type XlsxSelectionSpan } from "../structure-insert";
import type { XlsxToolbarGroupProps } from "../types";
import { headerLabel } from "./remove-duplicates";
import { readSpanCells, runDataToolSteps, XLSX_DATA_TOOLS_MAX_CELLS } from "./range-values";
import { planSubtotal, SUBTOTAL_FUNCTIONS, type XlsxSubtotalFunction } from "./subtotal";

const BASE = "office.xlsx.dataTools";
const FUNCTIONS = Object.keys(SUBTOTAL_FUNCTIONS) as XlsxSubtotalFunction[];

interface SubtotalChoice {
  readonly changeColumn: number;
  readonly fn: XlsxSubtotalFunction;
  readonly columns: readonly number[];
}

function columnLetter(column: number): string {
  return toA1Address(0, column).replace(/[0-9]+$/, "");
}

interface DialogBodyProps {
  readonly cells: readonly (readonly (XlsxCellState | null)[])[];
  readonly span: XlsxSelectionSpan;
  readonly plan: (choice: SubtotalChoice) => ReturnType<typeof planSubtotal>;
  readonly onRun: (choice: SubtotalChoice) => Promise<boolean>;
  readonly onClose: () => void;
}

function SubtotalBody({ cells, span, plan, onRun, onClose }: DialogBodyProps) {
  const { t } = useTranslation();
  const id = useId();
  const width = span.columns;
  const [changeColumn, setChangeColumn] = useState(0);
  const [fn, setFn] = useState<XlsxSubtotalFunction>("sum");
  const [columns, setColumns] = useState<readonly number[]>(() => [width - 1]);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const choice = { changeColumn, fn, columns };
  const planned = plan(choice);
  const refusal = planned === "limitExceeded"
    ? t(`${BASE}.common.limitExceeded`, { limit: XLSX_DATA_TOOLS_MAX_CELLS })
    : typeof planned === "string" ? t(`${BASE}.subtotalDialog.${planned}`) : failed ? t(`${BASE}.common.failed`) : null;
  const columnName = (index: number) =>
    headerLabel(cells, index, true) ?? t(`${BASE}.common.column`, { column: columnLetter(span.startColumn + index) });
  const toggle = (column: number, checked: boolean) =>
    setColumns((current) => (checked ? [...current, column].sort((a, b) => a - b) : current.filter((entry) => entry !== column)));
  const blocked = typeof planned === "string" || running;

  return (
    <>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-change`} className="text-caption font-medium">{t(`${BASE}.subtotalDialog.atEachChange`)}</Label>
        <Select
          id={`${id}-change`}
          aria-label={t(`${BASE}.subtotalDialog.atEachChange`)}
          triggerVariant="subtle"
          value={String(changeColumn)}
          onValueChange={(value) => { if (value !== null) setChangeColumn(Number(value)); }}
          items={Array.from({ length: width }, (_, index) => ({ value: String(index), label: columnName(index) }))}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-fn`} className="text-caption font-medium">{t(`${BASE}.subtotalDialog.useFunction`)}</Label>
        <Select
          id={`${id}-fn`}
          aria-label={t(`${BASE}.subtotalDialog.useFunction`)}
          triggerVariant="subtle"
          value={fn}
          onValueChange={(value) => { if (value !== null) setFn(value as XlsxSubtotalFunction); }}
          items={FUNCTIONS.map((name) => ({ value: name, label: t(`${BASE}.subtotalDialog.functions.${name}`) }))}
        />
      </div>
      <fieldset className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
        <legend className="px-1 text-caption text-muted-foreground">{t(`${BASE}.subtotalDialog.addTo`)}</legend>
        {Array.from({ length: width }, (_, index) => {
          const checkboxId = `${id}-col-${index}`;
          return (
            <div key={index} className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={columns.includes(index)}
                onCheckedChange={(next) => toggle(index, next === true)}
                data-testid={`xlsx-subtotal-col-${index}`}
              />
              <Label htmlFor={checkboxId}>{columnName(index)}</Label>
            </div>
          );
        })}
      </fieldset>
      <p className="text-caption text-muted-foreground">{t(`${BASE}.subtotalDialog.note`)}</p>
      {refusal !== null ? (
        <p role="alert" className="text-caption text-destructive" data-testid="xlsx-subtotal-error">{refusal}</p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t(`${BASE}.common.cancel`)}</Button>
        <Button
          type="button"
          aria-disabled={blocked || undefined}
          data-testid="xlsx-subtotal-apply"
          onClick={() => {
            if (blocked) return;
            setRunning(true);
            setFailed(false);
            void onRun(choice).then((ran) => {
              setRunning(false);
              if (ran) onClose();
              else setFailed(true);
            });
          }}
        >
          {t(`${BASE}.common.ok`)}
        </Button>
      </DialogFooter>
    </>
  );
}

export function XlsxSubtotalButton({ readOnly = false, selection, snapshot, commands, unitId, sheetName, resolveSheetId }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const span = selectionSpan(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || !snapshot || !span || !selection || sheetId === undefined || unitId == null;
  const label = t(`${BASE}.subtotal`);
  // A list taller than one save's edit budget is refused before its cells are read.
  const tooTall = span !== null && span.rows > XLSX_DATA_TOOLS_MAX_CELLS;
  const cells = open && !blocked && !tooTall ? readSpanCells(snapshot, selection.sheet, span) : null;

  const plan = (choice: SubtotalChoice): ReturnType<typeof planSubtotal> => {
    if (blocked || cells === null) return "needRows";
    const fnLabel = t(`${BASE}.subtotalDialog.functions.${choice.fn}`);
    return planSubtotal(cells, choice, span, { unitId, sheetId }, {
      group: (value) => t(`${BASE}.subtotalDialog.groupLabel`, { value, function: fnLabel }),
      grand: t(`${BASE}.subtotalDialog.grandLabel`, { function: fnLabel }),
    });
  };
  const run = async (choice: SubtotalChoice): Promise<boolean> => {
    const planned = plan(choice);
    if (blocked || typeof planned === "string") return false;
    return runDataToolSteps(commands, planned.steps);
  };

  return (
    <>
      <XlsxLargeButton
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-disabled={blocked || undefined}
        data-testid="xlsx-subtotal"
        onClick={() => { if (!blocked) setOpen(true); }}
      >
        <TableRowsSplit aria-hidden />
        <XlsxLargeLabel>{label}</XlsxLargeLabel>
      </XlsxLargeButton>
      <Dialog open={open && (cells !== null || tooTall)} onOpenChange={setOpen}>
        <DialogContent data-testid="xlsx-subtotal-dialog">
          <DialogHeader>
            <DialogTitle>{t(`${BASE}.subtotalDialog.title`)}</DialogTitle>
            <DialogDescription>{t(`${BASE}.subtotalDialog.description`)}</DialogDescription>
          </DialogHeader>
          {cells !== null && span !== null ? (
            <SubtotalBody cells={cells} span={span} plan={plan} onRun={run} onClose={() => setOpen(false)} />
          ) : (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-subtotal-error">
              {t(`${BASE}.common.limitExceeded`, { limit: XLSX_DATA_TOOLS_MAX_CELLS })}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

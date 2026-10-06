"use client";

// Data > Text to Columns (delimited mode). The button snapshots the selected
// column from the editor's LIVE snapshot when the dialog opens; OK writes the
// pieces as one set-range-values inside one undo step.

import { useState } from "react";
import { Columns3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { XlsxLargeButton, XlsxLargeLabel } from "../group-layout";
import { selectionSpan, type XlsxSelectionSpan } from "../structure-insert";
import type { XlsxToolbarGroupProps } from "../types";
import { XLSX_DATA_TOOLS_MAX_CELLS, readSpanCells, runDataToolSteps } from "./range-values";
import { hasDelimiter, planTextToColumns, textToColumnsStep, type TextToColumnsOptions } from "./text-to-columns";

const PREVIEW_ROWS = 5;
/** Widest destination the overwrite check reads (columns right of the source). */
const MAX_RIGHT_COLUMNS = 256;

interface Session {
  readonly span: XlsxSelectionSpan;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly unitId: string;
  readonly source: (XlsxCellState | null)[][];
}

const DEFAULT_OPTIONS: TextToColumnsOptions = { tab: true, semicolon: false, comma: false, space: false, other: "", consecutive: false };

type FlagKey = "tab" | "semicolon" | "comma" | "space" | "consecutive";
const DELIMITER_FLAGS = ["tab", "semicolon", "comma", "space"] as const;

export function XlsxTextToColumnsButton({ readOnly = false, commands, selection, snapshot, unitId, sheetName, resolveSheetId }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [options, setOptions] = useState<TextToColumnsOptions>(DEFAULT_OPTIONS);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const span = selectionSpan(selection);
  const liveSheet = selection?.sheet ?? sheetName ?? null;
  const sheetId = liveSheet ? resolveSheetId?.(liveSheet) : undefined;
  const blocked = readOnly || !commands || !snapshot || !unitId || !sheetId || !span || !liveSheet;

  const open = () => {
    if (blocked || !span || !liveSheet || !unitId || !sheetId) return;
    const source = readSpanCells(snapshot, liveSheet, span);
    if (!source) return;
    setOptions(DEFAULT_OPTIONS);
    setFailed(false);
    setSession({ span, sheetId, sheetName: liveSheet, unitId, source });
  };

  const close = () => setSession(null);

  const singleColumn = session !== null && session.span.columns === 1;
  const firstPass = singleColumn && session ? planTextToColumns(session.source, options) : null;
  const right =
    firstPass && session && firstPass.width > 1
      ? readSpanCells(snapshot, session.sheetName, {
          startRow: session.span.startRow,
          endRow: session.span.startRow + firstPass.rows.length - 1,
          startColumn: session.span.startColumn + 1,
          endColumn: session.span.startColumn + Math.min(firstPass.width - 1, MAX_RIGHT_COLUMNS),
        })
      : null;
  const plan = singleColumn && session ? planTextToColumns(session.source, options, right ?? undefined) : null;
  const noDelimiter = !hasDelimiter(options);
  const overLimit = plan !== null && plan.rows.length * plan.width > XLSX_DATA_TOOLS_MAX_CELLS;
  const canApply = !!plan && !!commands && !busy && !noDelimiter && !overLimit && plan.rows.length > 0 && plan.width > 0;

  const apply = async () => {
    if (!canApply || !plan || !session || !commands) return;
    setBusy(true);
    setFailed(false);
    const step = textToColumnsStep(session.unitId, session.sheetId, session.span, plan.rows, plan.width);
    const done = await runDataToolSteps(commands, [step]);
    setBusy(false);
    if (done) close();
    else setFailed(true);
  };

  const flag = (key: FlagKey, checked: boolean) => setOptions((current) => ({ ...current, [key]: checked }));
  const previewRows = plan ? plan.rows.slice(0, PREVIEW_ROWS) : [];

  return (
    <>
      <XlsxLargeButton
        aria-label={t("office.xlsx.dataTools.textToColumns")}
        title={t("office.xlsx.dataTools.textToColumns")}
        aria-haspopup="dialog"
        aria-disabled={blocked || undefined}
        data-testid="xlsx-text-to-columns"
        onClick={open}
      >
        <Columns3 aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.dataTools.textToColumns")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <Dialog open={session !== null} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("office.xlsx.dataTools.textToColumnsDialog.title")}</DialogTitle>
            <DialogDescription>{t("office.xlsx.dataTools.textToColumnsDialog.description")}</DialogDescription>
          </DialogHeader>
          {session && !singleColumn ? (
            <p role="alert" className="text-caption text-destructive">{t("office.xlsx.dataTools.textToColumnsDialog.singleColumn")}</p>
          ) : (
            <div className="grid gap-3">
              <fieldset className="grid gap-2 rounded-md border border-border p-2">
                <legend className="px-1 text-caption text-muted-foreground">{t("office.xlsx.dataTools.textToColumnsDialog.delimiters")}</legend>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {DELIMITER_FLAGS.map((key) => (
                    <Label key={key} className="text-body">
                      <Checkbox checked={options[key]} onCheckedChange={(value) => flag(key, value === true)} />
                      <span>{t(`office.xlsx.dataTools.textToColumnsDialog.${key}`)}</span>
                    </Label>
                  ))}
                  <Label className="text-body">
                    <Checkbox
                      checked={options.other !== ""}
                      onCheckedChange={(value) => setOptions((current) => ({ ...current, other: value === true ? current.other || "|" : "" }))}
                    />
                    <span>{t("office.xlsx.dataTools.textToColumnsDialog.other")}</span>
                  </Label>
                  <Input
                    aria-label={t("office.xlsx.dataTools.textToColumnsDialog.otherInput")}
                    className="w-16"
                    maxLength={1}
                    value={options.other}
                    onChange={(event) => setOptions((current) => ({ ...current, other: Array.from(event.target.value)[0] ?? "" }))}
                  />
                </div>
              </fieldset>
              <Label className="text-body">
                <Checkbox checked={options.consecutive} onCheckedChange={(value) => flag("consecutive", value === true)} />
                <span>{t("office.xlsx.dataTools.textToColumnsDialog.consecutive")}</span>
              </Label>
              <div className="grid gap-1">
                <span className="text-caption text-muted-foreground">{t("office.xlsx.dataTools.textToColumnsDialog.preview")}</span>
                <div className="max-h-40 overflow-auto rounded-md border border-border">
                  <table aria-label={t("office.xlsx.dataTools.textToColumnsDialog.preview")} className="w-full text-caption">
                    <tbody>
                      {previewRows.map((pieces, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border last:border-b-0">
                          {Array.from({ length: Math.max(plan?.width ?? 0, 1) }, (_, column) => (
                            <td key={column} className="whitespace-nowrap border-r border-border px-2 py-1 last:border-r-0">{pieces[column] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {noDelimiter ? <p role="alert" className="text-caption text-destructive">{t("office.xlsx.dataTools.textToColumnsDialog.noDelimiter")}</p> : null}
              {plan?.overwrite ? <p role="alert" className="text-caption text-destructive">{t("office.xlsx.dataTools.textToColumnsDialog.overwrite")}</p> : null}
              {overLimit ? (
                <p role="alert" className="text-caption text-destructive">{t("office.xlsx.dataTools.common.limitExceeded", { limit: XLSX_DATA_TOOLS_MAX_CELLS })}</p>
              ) : null}
              {failed ? <p role="alert" className="text-caption text-destructive">{t("office.xlsx.dataTools.common.failed")}</p> : null}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>{t("office.xlsx.dataTools.common.cancel")}</Button>
            <Button type="button" disabled={!canApply} onClick={() => void apply()}>{t("office.xlsx.dataTools.common.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

/**
 * Tables tab body (B2ui, UNI-927). The self-contained panel the serialized
 * UI-wire round mounts in the Tables context: Insert, Cell, Rows/Columns,
 * Merge and Style - every control calls ONE async port with exactly the
 * committed B2e `TableEdit` union member:
 *
 *   onApplyEdit?(edit: TableEdit): Promise<unknown>   // the engine edit channel
 *   onError?(error: unknown): void                    // host reporting seam
 *
 * The wire round binding is one line: `(edit) => handle.edit([edit])` (or
 * `model.applyEdit(edit)`). With no port bound, no selected table, or no
 * selected cell, the affected controls are disabled and the panel says why - it
 * never fakes a capability (the lane's honesty rule).
 *
 * States: loading (a probe is in flight), empty (no deck), ready, busy (an edit
 * is applying), error (the last edit was refused; the message is shown and the
 * document is unchanged). The document is only ever mutated by `onApplyEdit`.
 * `merge`/`structure` edits reparse the slide and mint a new element id: the
 * host must keep selection from the record's `after.elementId`, never from the
 * id the edit named.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { TableCellAnchor, TableEdit, TableStylePresetName } from "@uniwork/office-engine/pptx";
import {
  PPTX_TABLE_ANCHORS,
  PPTX_TABLE_DEFAULT_BOX,
  PPTX_TABLE_MERGE_KINDS,
  PPTX_TABLE_SIZE_MAX,
  PPTX_TABLE_STYLE_PRESETS,
  PPTX_TABLE_STRUCTURE_KINDS,
  buildCellAnchorEdit,
  buildCellTextEdit,
  buildColWidthEdit,
  buildInsertTableEdit,
  buildMergeEdit,
  buildRowHeightEdit,
  buildStructureEdit,
  buildStylePresetEdit,
  missingTargetRefusal,
  validateTableSize,
  type PptxTableRefusal,
  type PptxTableTarget,
  type PptxTableValidation,
} from "./table-model";

export interface PptxTablesPanelProps {
  /** The engine edit channel (one committed `TableEdit` per call). Absent ->
   *  every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: TableEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** Deck slide count; 0 means "no deck" and the panel shows its empty state. */
  slideCount?: number;
  /** 0-based selected slide; null when nothing is selected. */
  slideIndex?: number | null;
  /** The selected table element id; null when no table is selected. */
  tableElementId?: string | null;
  /** The table's current row/column count, for the target readout. */
  tableSize?: { rows: number; cols: number } | null;
  /** The selected cell; null when no cell is selected. */
  cell?: { row: number; col: number } | null;
  /** The table's current style preset, when the host can report one. */
  activeStyleName?: TableStylePresetName | null;
  /** The selected cell's current vertical alignment. */
  cellAnchor?: TableCellAnchor | null;
  /** The selected cell's current text, for the cell field. */
  cellText?: string | null;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

/** Run a validated build through the port; a refusal is shown, never sent. */
function useApply(onApplyEdit: PptxTablesPanelProps["onApplyEdit"], onError: PptxTablesPanelProps["onError"]) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (result: PptxTableValidation<TableEdit>): Promise<boolean> => {
      if (!result.ok) {
        setErrorMessage(result.message);
        return false;
      }
      if (!onApplyEdit || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        await onApplyEdit(result.value);
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        onError?.(error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onApplyEdit, onError],
  );

  return { busy, errorMessage, run };
}

export function PptxTablesPanel({
  onApplyEdit,
  onError,
  slideCount = 0,
  slideIndex = null,
  tableElementId = null,
  tableSize = null,
  cell = null,
  activeStyleName = null,
  cellAnchor = null,
  cellText = null,
  loading = false,
  disabled = false,
  className,
}: PptxTablesPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const { t: tRoot } = useTranslation();
  const { busy, errorMessage, run } = useApply(onApplyEdit, onError);
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");
  const [text, setText] = useState(cellText ?? "");

  // F1: the cell-text field must follow the SELECTED cell. Re-seed it whenever
  // the cell identity or its bound text changes, so a stale value can never be
  // applied to a different cell.
  const cellKey = cell ? cell.row + ":" + cell.col : "";
  useEffect(() => {
    setText(cellText ?? "");
  }, [cellKey, cellText]);
  const [rowHeight, setRowHeight] = useState("40");
  const [colWidth, setColWidth] = useState("120");

  const bound = typeof onApplyEdit === "function";
  const hasDeck = slideCount > 0;
  const blocked = disabled || !bound || !hasDeck || busy;
  const target: PptxTableTarget | null =
    slideIndex === null || !tableElementId ? null : { slideIndex, elementId: tableElementId };
  const targetRefusal: PptxTableRefusal | null = blocked ? null : missingTargetRefusal(Boolean(target), Boolean(cell));
  const sizeRefusal = validateTableSize(Number(rows), Number(cols));

  const applyInsert = () => {
    if (slideIndex === null) return;
    void run(buildInsertTableEdit(slideIndex, Number(rows), Number(cols), PPTX_TABLE_DEFAULT_BOX));
  };
  const applyText = () => {
    if (!target || !cell) return;
    void run(buildCellTextEdit(target, cell.row, cell.col, text));
  };
  const applyAnchor = (anchor: TableCellAnchor) => {
    if (!target || !cell) return;
    void run(buildCellAnchorEdit(target, cell.row, cell.col, anchor));
  };
  const applyStructure = (kind: (typeof PPTX_TABLE_STRUCTURE_KINDS)[number]) => {
    if (!target || !cell) return;
    // F5: `before` belongs to the INSERT kinds only; a delete carries no
    // insertion anchor (passing it could delete the wrong row/column).
    const insert = kind === "insert-row" || kind === "insert-col";
    void run(buildStructureEdit(target, kind, kind === "insert-row" || kind === "delete-row" ? cell.row : cell.col, insert));
  };
  const applyRowHeight = () => {
    if (!target || !cell) return;
    void run(buildRowHeightEdit(target, cell.row, Number(rowHeight)));
  };
  const applyColWidth = () => {
    if (!target || !cell) return;
    void run(buildColWidthEdit(target, cell.col, Number(colWidth)));
  };
  const applyMerge = (kind: (typeof PPTX_TABLE_MERGE_KINDS)[number]) => {
    if (!target || !cell) return;
    void run(buildMergeEdit(target, kind, cell.row, cell.col));
  };
  const applyStyle = (styleName: TableStylePresetName) => {
    if (!target) return;
    void run(buildStylePresetEdit(target, styleName));
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("tables.loading")}
        data-pptx-tables-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div data-pptx-tables-panel data-state="empty" className={cn("p-3 text-caption text-muted-foreground", className)}>
        {t("tables.empty")}
      </div>
    );
  }

  const blockedReason = disabled ? t("tables.readonly") : !bound ? t("tables.unbound") : null;
  const needsTable = blocked || !target;

  return (
    <section
      aria-label={t("tables.title")}
      data-pptx-tables-panel
      data-state={busy ? "busy" : "ready"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3", className)}
    >
      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-tables-error">
          <AlertTitle>{t("tables.error_title")}</AlertTitle>
          <AlertDescription>{t("tables.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-tables-busy">
          {t("tables.busy")}
        </p>
      ) : null}

      {target && tableSize ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-tables-target">
          {t("tables.target", { rows: tableSize.rows, cols: tableSize.cols })}
        </p>
      ) : null}

      {/* Insert */}
      <div className="flex flex-col gap-2" data-pptx-tables-insert>
        <span className="text-caption font-medium text-muted-foreground">{t("tables.insert.label")}</span>
        <div className="flex flex-wrap items-end gap-2">
          <span className="flex flex-col gap-1">
            <Label htmlFor="pptx-tables-rows" className="text-caption text-muted-foreground">
              {t("tables.insert.rows")}
            </Label>
            <Input
              id="pptx-tables-rows"
              type="number"
              min={1}
              max={PPTX_TABLE_SIZE_MAX}
              value={rows}
              disabled={blocked || slideIndex === null}
              aria-invalid={sizeRefusal.ok ? undefined : true}
              className="w-20"
              onChange={(event) => setRows(event.target.value)}
            />
          </span>
          <span className="flex flex-col gap-1">
            <Label htmlFor="pptx-tables-cols" className="text-caption text-muted-foreground">
              {t("tables.insert.cols")}
            </Label>
            <Input
              id="pptx-tables-cols"
              type="number"
              min={1}
              max={PPTX_TABLE_SIZE_MAX}
              value={cols}
              disabled={blocked || slideIndex === null}
              aria-invalid={sizeRefusal.ok ? undefined : true}
              className="w-20"
              onChange={(event) => setCols(event.target.value)}
            />
          </span>
          <Button
            type="button"
            size="sm"
            disabled={blocked || slideIndex === null || !sizeRefusal.ok}
            data-pptx-tables-insert-apply
            onClick={applyInsert}
          >
            {t("tables.insert.apply")}
          </Button>
        </div>
        {sizeRefusal.ok ? null : <p className="text-caption text-destructive">{t("tables.insert.invalid")}</p>}
      </div>

      {/* Cell */}
      <div className="flex flex-col gap-2" data-pptx-tables-cell>
        <span className="text-caption font-medium text-muted-foreground">{t("tables.cell.label")}</span>
        <Label htmlFor="pptx-tables-cell-text" className="text-caption text-muted-foreground">
          {t("tables.cell.text")}
        </Label>
        <Input
          id="pptx-tables-cell-text"
          value={text}
          disabled={needsTable || !cell}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={needsTable || !cell} data-pptx-tables-cell-apply onClick={applyText}>
            {t("tables.cell.apply")}
          </Button>
          <span className="text-caption text-muted-foreground">{t("tables.cell.anchor_label")}</span>
          {PPTX_TABLE_ANCHORS.map((anchor) => (
            <Button
              key={anchor}
              type="button"
              size="sm"
              variant={cellAnchor === anchor ? "default" : "outline"}
              aria-pressed={cellAnchor === anchor}
              disabled={needsTable || !cell}
              data-pptx-tables-anchor={anchor}
              onClick={() => applyAnchor(anchor)}
            >
              {t("tables.cell.anchor." + anchor)}
            </Button>
          ))}
        </div>
      </div>

      {/* Rows and columns */}
      <div className="flex flex-col gap-2" data-pptx-tables-structure>
        <span className="text-caption font-medium text-muted-foreground">{t("tables.structure.label")}</span>
        <div className="flex flex-wrap gap-2">
          {PPTX_TABLE_STRUCTURE_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              disabled={needsTable || !cell}
              data-pptx-tables-structure-kind={kind}
              onClick={() => applyStructure(kind)}
            >
              {t("tables.structure." + kind.replace("-", "_"))}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <span className="flex flex-col gap-1">
            <Label htmlFor="pptx-tables-row-height" className="text-caption text-muted-foreground">
              {t("tables.structure.row_height")}
            </Label>
            <Input
              id="pptx-tables-row-height"
              type="number"
              min={1}
              value={rowHeight}
              disabled={needsTable || !cell}
              className="w-24"
              onChange={(event) => setRowHeight(event.target.value)}
            />
          </span>
          <Button
            type="button"
            size="sm"
            disabled={needsTable || !cell}
            data-pptx-tables-row-height-apply
            onClick={applyRowHeight}
          >
            {t("tables.structure.apply_size")}
          </Button>
          <span className="flex flex-col gap-1">
            <Label htmlFor="pptx-tables-col-width" className="text-caption text-muted-foreground">
              {t("tables.structure.col_width")}
            </Label>
            <Input
              id="pptx-tables-col-width"
              type="number"
              min={1}
              value={colWidth}
              disabled={needsTable || !cell}
              className="w-24"
              onChange={(event) => setColWidth(event.target.value)}
            />
          </span>
          <Button
            type="button"
            size="sm"
            disabled={needsTable || !cell}
            data-pptx-tables-col-width-apply
            onClick={applyColWidth}
          >
            {t("tables.structure.apply_size")}
          </Button>
        </div>
      </div>

      {/* Merge */}
      <div className="flex flex-col gap-2" data-pptx-tables-merge>
        <span className="text-caption font-medium text-muted-foreground">{t("tables.merge.label")}</span>
        <div className="flex flex-wrap gap-2">
          {PPTX_TABLE_MERGE_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              disabled={needsTable || !cell}
              data-pptx-tables-merge-kind={kind}
              onClick={() => applyMerge(kind)}
            >
              {t("tables.merge." + (kind === "merge-right" ? "right" : kind === "merge-down" ? "down" : "split"))}
            </Button>
          ))}
        </div>
      </div>

      {/* Style */}
      <div className="flex flex-col gap-2" data-pptx-tables-style>
        <span className="text-caption font-medium text-muted-foreground">{t("tables.style.label")}</span>
        <div
          role="radiogroup"
          aria-label={t("tables.style.group_label")}
          aria-busy={busy || undefined}
          className="flex flex-wrap gap-2"
        >
          {PPTX_TABLE_STYLE_PRESETS.map((preset) => {
            const active = preset.id === activeStyleName;
            const name = tRoot(preset.nameKey);
            return (
              <Button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={active ? t("tables.style.active", { name }) : t("tables.style.apply", { name })}
                variant={active ? "default" : "outline"}
                size="sm"
                disabled={needsTable}
                data-pptx-tables-style-preset={preset.id}
                data-active={active}
                onClick={() => applyStyle(preset.id)}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </div>

      {targetRefusal ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-tables-target-refusal">
          {targetRefusal.code === "no_element" ? t("tables.no_table") : t("tables.no_cell")}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-tables-unbound">
          {blockedReason}
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./table-insert";

export interface TableGridPickerProps {
  disabled: boolean;
  /** True when the caret is already in a table: the command refuses there, so
   * the panel explains instead of offering a grid that cannot apply. */
  inTable: boolean;
  onInsert(rows: number, cols: number): void;
}

const ROW_NUMBERS = Array.from({ length: MAX_TABLE_ROWS }, (_, index) => index + 1);
const COL_NUMBERS = Array.from({ length: MAX_TABLE_COLS }, (_, index) => index + 1);

/** Word's Insert Table hover grid: move over the cells to pick rows x columns,
 * click to insert. Keyboard: the grid is a roving-tabindex grid; arrows move
 * the focused size and Enter/Space inserts it. */
export function TableGridPicker({ disabled, inTable, onInsert }: TableGridPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ rows: number; cols: number } | null>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());

  if (disabled) {
    return (
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled
        aria-label={t("office.docx.table.insert")}
        data-testid="docx-table-insert"
      >
        <Table2 aria-hidden />
        <ChevronDown aria-hidden />
      </Button>
    );
  }

  const focusCell = (rows: number, cols: number) => {
    setPicked({ rows, cols });
    cells.current.get(`${rows}-${cols}`)?.focus();
  };

  const onCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rows: number, cols: number) => {
    const move = (rowDelta: number, colDelta: number) => {
      event.preventDefault();
      focusCell(
        Math.min(MAX_TABLE_ROWS, Math.max(1, rows + rowDelta)),
        Math.min(MAX_TABLE_COLS, Math.max(1, cols + colDelta)),
      );
    };
    if (event.key === "ArrowUp") move(-1, 0);
    else if (event.key === "ArrowDown") move(1, 0);
    else if (event.key === "ArrowLeft") move(0, -1);
    else if (event.key === "ArrowRight") move(0, 1);
  };

  const insert = (rows: number, cols: number) => {
    onInsert(rows, cols);
    setPicked(null);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={t("office.docx.table.insert")}
            data-testid="docx-table-insert"
          />
        }
      >
        <Table2 aria-hidden />
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-1.5 p-2" data-testid="docx-table-insert-panel">
        <span aria-live="polite" className="text-caption text-muted-foreground" data-testid="docx-table-insert-size">
          {picked
            ? t("office.docx.table.pickerSize", { rows: picked.rows, cols: picked.cols })
            : t("office.docx.table.pickerHint")}
        </span>
        {inTable ? (
          <p className="max-w-52 text-caption text-muted-foreground">{t("office.docx.table.insertInTableHint")}</p>
        ) : (
          <div
            role="grid"
            tabIndex={-1}
            aria-label={t("office.docx.table.insert")}
            className="grid grid-cols-10 gap-0.5"
            onMouseLeave={() => setPicked(null)}
          >
            {ROW_NUMBERS.map((rows) => (
              <div key={rows} role="row" className="contents">
                {COL_NUMBERS.map((cols) => {
                  const hot = picked !== null && rows <= picked.rows && cols <= picked.cols;
                  const current = picked !== null && rows === picked.rows && cols === picked.cols;
                  return (
                    <button
                      key={cols}
                      ref={(node) => {
                        if (node) cells.current.set(`${rows}-${cols}`, node);
                        else cells.current.delete(`${rows}-${cols}`);
                      }}
                      type="button"
                      role="gridcell"
                      tabIndex={picked === null ? (rows === 1 && cols === 1 ? 0 : -1) : current ? 0 : -1}
                      aria-label={t("office.docx.table.pickerCell", { rows, cols })}
                      aria-selected={hot}
                      className={cn(
                        "size-4 rounded-[3px] border border-surface-border bg-surface-raised hover:bg-accent",
                        hot && "border-ring bg-accent",
                      )}
                      data-testid={`docx-table-insert-${rows}x${cols}`}
                      onMouseEnter={() => setPicked({ rows, cols })}
                      onFocus={() => setPicked({ rows, cols })}
                      onKeyDown={(event) => onCellKeyDown(event, rows, cols)}
                      onClick={() => insert(rows, cols)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

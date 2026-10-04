"use client";

// Wave A / A8 (UNI-926): the Function Library dialog. Opened from the Formulas
// tab; it browses the curated catalog (search + category filter) and inserts
// `=NAME(` into the active cell through the toolbar's one command port
// (`sheet.command.set-range-values`, the allowlisted cell-edit command whose
// mutation journals through the existing save path). The inserted payload is
// the pinned matrix shape `{ [row]: { [col]: { f: "=NAME(" } } }` - the same
// `f` convention AutoSum and the cell editor use, so the live engine, the
// formula-cost guard and the journal all agree.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { addressParts } from "../xlsx-editor-model";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import {
  functionInsertionText,
  matchFunctions,
  XLSX_FUNCTION_CATEGORIES,
  type XlsxFunctionCategory,
  type XlsxFunctionSpec,
} from "./function-catalog";

/** The one command the library inserts through (already allowlisted). */
export const XLSX_FUNCTION_INSERT_COMMAND = "sheet.command.set-range-values";

export interface XlsxFunctionLibraryDialogProps {
  selection: XlsxSelection | null;
  /** `file-<sha256>`; null without a mounted renderer. */
  unitId: string | null;
  /** The active sheet's live id; null without a mounted renderer. */
  sheetId: string | null;
  commands?: XlsxToolbarCommands;
  readOnly?: boolean;
  onClose: () => void;
}

/** The `set-range-values` params that put `=NAME(` in the active cell. */
export function functionInsertParams(
  unitId: string,
  sheetId: string,
  row: number,
  column: number,
  name: string,
): { unitId: string; subUnitId: string; value: Record<string, Record<string, { f: string }>> } {
  return {
    unitId,
    subUnitId: sheetId,
    value: { [String(row)]: { [String(column)]: { f: functionInsertionText(name) } } },
  };
}

export function XlsxFunctionLibraryDialog({
  selection,
  unitId,
  sheetId,
  commands,
  readOnly = false,
  onClose,
}: XlsxFunctionLibraryDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<XlsxFunctionCategory | "all">("all");
  const [picked, setPicked] = useState<XlsxFunctionSpec | null>(null);
  const [failed, setFailed] = useState(false);
  const items = useMemo(() => matchFunctions(query, category), [category, query]);
  const position = selection ? addressParts(selection.address) : null;
  const insertable = !readOnly && commands !== undefined && unitId !== null && sheetId !== null && position !== null;
  const blocked = !insertable;

  const insert = (spec: XlsxFunctionSpec) => {
    setPicked(spec);
    setFailed(false);
    if (!insertable || !commands || !unitId || !sheetId || !position) return;
    // The port resolves a real boolean; a rejection (unregistered id, handler
    // error) resolves false too, so the failure surface is always reachable.
    void (async () => {
      let applied = false;
      try {
        applied = await commands.execute(XLSX_FUNCTION_INSERT_COMMAND, functionInsertParams(unitId, sheetId, position.row, position.column, spec.name));
      } catch {
        applied = false;
      }
      if (applied) onClose();
      else setFailed(true);
    })();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="xlsx-function-library" closeLabel={t("office.xlsx.formulas.library.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.formulas.library.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-40 flex-1 gap-1">
              <Label htmlFor="xlsx-function-search" className="text-caption font-medium">
                {t("office.xlsx.formulas.library.search")}
              </Label>
              <Input
                id="xlsx-function-search"
                data-testid="xlsx-function-search"
                className="h-8"
                autoFocus
                value={query}
                placeholder={t("office.xlsx.formulas.library.searchPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="grid min-w-36 gap-1">
              <Label htmlFor="xlsx-function-category" className="text-caption font-medium">
                {t("office.xlsx.formulas.library.category")}
              </Label>
              <Select
                id="xlsx-function-category"
                aria-label={t("office.xlsx.formulas.library.category")}
                triggerVariant="subtle"
                value={category}
                onValueChange={(value) => {
                  if (value !== null) setCategory(value);
                }}
                items={[
                  { value: "all", label: t("office.xlsx.formulas.categories.all") },
                  ...XLSX_FUNCTION_CATEGORIES.map((name) => ({
                    value: name,
                    label: t(`office.xlsx.formulas.categories.${name}`),
                  })),
                ]}
              />
            </div>
          </div>
          <div
            role="listbox"
            aria-label={t("office.xlsx.formulas.library.list")}
            data-testid="xlsx-function-list"
            className="max-h-64 overflow-y-auto rounded-control border border-border"
          >
            {items.map((spec) => (
              <button
                key={spec.name}
                type="button"
                role="option"
                aria-selected={picked?.name === spec.name}
                aria-disabled={blocked || undefined}
                data-testid={`xlsx-function-${spec.name}`}
                className="block w-full border-b border-border/60 px-2 py-1.5 text-left last:border-b-0 hover:bg-accent"
                onClick={() => insert(spec)}
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-caption font-semibold">{spec.name}</span>
                  <span className="min-w-0 truncate text-caption text-muted-foreground">{spec.signature}</span>
                </span>
                <span className="block truncate text-caption text-muted-foreground">{t(spec.descriptionKey)}</span>
              </button>
            ))}
            {items.length === 0 ? (
              <p className="px-2 py-3 text-caption text-muted-foreground" data-testid="xlsx-function-no-match">
                {t("office.xlsx.formulas.library.noMatch")}
              </p>
            ) : null}
          </div>
          {picked && blocked ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-function-blocked">
              {t("office.xlsx.formulas.library.noTarget")}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-function-error">
              {t("office.xlsx.formulas.library.insertFailed")}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-function-cancel" onClick={onClose}>
            {t("office.xlsx.formulas.library.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The editor-side mount: it derives the workbook/unit ids from the renderer
 *  host so the editor diff stays one element. Renders nothing when closed. */
export function XlsxFunctionLibraryMount({
  open,
  host,
  commands,
  selection,
  resolveSheetId,
  readOnly = false,
  onClose,
}: {
  open: boolean;
  host?: XlsxGridHostPort;
  commands?: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  resolveSheetId?: (liveName: string) => string | undefined;
  readOnly?: boolean;
  onClose: () => void;
}) {
  if (!open || !host) return null;
  const sheetId = selection ? (resolveSheetId?.(selection.sheet) ?? host.file.sheets.find((sheet) => sheet.name === selection.sheet)?.id ?? null) : null;
  return (
    <XlsxFunctionLibraryDialog
      selection={selection}
      unitId={`file-${host.file.sha256}`}
      sheetId={sheetId}
      commands={commands}
      readOnly={readOnly}
      onClose={onClose}
    />
  );
}

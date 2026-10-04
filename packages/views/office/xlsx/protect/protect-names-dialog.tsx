"use client";

// B7 (UNI-926): the Protect sheet + Name manager dialog. Protect toggles the
// active sheet's protection through set_sheet_protection; the name manager
// edits the workbook defined names through set_defined_names. Both ride the
// editor's one edit port (the session model folds them and the gateway writes
// them on save).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import type { XlsxDefinedNameEntry } from "@uniwork/office-engine/xlsx";
import type { RendererWorkbookDefinedName } from "../xlsx-render-model-bridge";
import { buildDefinedNames, emptyNameRow, seedDefinedNames, type XlsxNameRow } from "./protect-names-form";

export interface XlsxProtectNamesDialogProps {
  readOnly?: boolean;
  /** B7 F1: the workbook's own names; the dialog seeds its rows from them. */
  definedNames?: readonly RendererWorkbookDefinedName[] | undefined;
  /** The live sheet names in tab order, for the scope dropdown (F5). */
  sheetNames?: readonly string[] | undefined;
  onSetProtection: (protectedFlag: boolean) => void;
  onApplyNames: (names: readonly XlsxDefinedNameEntry[], preserveNames: readonly string[]) => void;
  onClose: () => void;
}

/** The scope dropdown's workbook-scope sentinel. */
const WORKBOOK_SCOPE = "";

export function XlsxProtectNamesDialog({
  readOnly = false,
  definedNames = [],
  sheetNames = [],
  onSetProtection,
  onApplyNames,
  onClose,
}: XlsxProtectNamesDialogProps) {
  const { t } = useTranslation();
  // F1: seed the rows from the file's own names once, on first render. The
  // unmodelable ones ride preserveNames so Apply cannot delete them.
  const [seed] = useState(() => seedDefinedNames(definedNames, sheetNames.length));
  const [rows, setRows] = useState<XlsxNameRow[]>(() => (seed.rows.length > 0 ? seed.rows.map((row) => ({ ...row })) : [emptyNameRow()]));
  const [error, setError] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<XlsxNameRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setError(null);
  };
  const addRow = () => setRows((current) => [...current, emptyNameRow()]);
  const removeRow = (index: number) => {
    setRows((current) => current.length > 1 ? current.filter((_, i) => i !== index) : [emptyNameRow()]);
    setError(null);
  };
  const applyNames = () => {
    if (readOnly) return;
    const built = buildDefinedNames(rows, sheetNames.length);
    if (!built.ok) {
      setError(t(`office.xlsx.protect.dialog.invalid.${built.error}`));
      return;
    }
    onApplyNames(built.names, seed.preserveNames);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="xlsx-protect-names" closeLabel={t("office.xlsx.protect.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.protect.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-caption font-medium">{t("office.xlsx.protect.dialog.protectSheet")}</Label>
            <div className="flex gap-2">
              <Button
                type="button" variant="outline" size="sm"
                aria-disabled={readOnly || undefined}
                data-testid="xlsx-protect-on"
                onClick={() => { if (!readOnly) { onSetProtection(true); onClose(); } }}
              >
                {t("office.xlsx.protect.dialog.on")}
              </Button>
              <Button
                type="button" variant="outline" size="sm"
                aria-disabled={readOnly || undefined}
                data-testid="xlsx-protect-off"
                onClick={() => { if (!readOnly) { onSetProtection(false); onClose(); } }}
              >
                {t("office.xlsx.protect.dialog.off")}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">{t("office.xlsx.protect.dialog.protectNote")}</p>
          </div>
          <div className="grid gap-1">
            <Label className="text-caption font-medium">{t("office.xlsx.protect.dialog.names")}</Label>
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
                <Input
                  className="h-8"
                  aria-label={t("office.xlsx.protect.dialog.name")}
                  placeholder={t("office.xlsx.protect.dialog.namePlaceholder")}
                  value={row.name}
                  onChange={(event) => updateRow(index, { name: event.target.value })}
                />
                <Input
                  className="h-8"
                  aria-label={t("office.xlsx.protect.dialog.formula")}
                  placeholder={t("office.xlsx.protect.dialog.formulaPlaceholder")}
                  value={row.formula}
                  onChange={(event) => updateRow(index, { formula: event.target.value })}
                />
                {sheetNames.length > 0 ? (
                  <Select
                    aria-label={t("office.xlsx.protect.dialog.sheetIndex")}
                    triggerVariant="subtle"
                    value={row.sheetIndex === "" ? WORKBOOK_SCOPE : row.sheetIndex}
                    onValueChange={(value) => { if (value !== null) updateRow(index, { sheetIndex: value }); }}
                    items={[
                      { value: WORKBOOK_SCOPE, label: t("office.xlsx.protect.dialog.workbookScope") },
                      ...sheetNames.map((name, position) => ({ value: String(position), label: name })),
                    ]}
                  />
                ) : (
                  <Input
                    className="h-8 w-16"
                    inputMode="numeric"
                    aria-label={t("office.xlsx.protect.dialog.sheetIndex")}
                    value={row.sheetIndex}
                    onChange={(event) => updateRow(index, { sheetIndex: event.target.value })}
                  />
                )}
                <Button
                  type="button" variant="outline" size="sm"
                  aria-label={t("office.xlsx.protect.dialog.remove")}
                  onClick={() => removeRow(index)}
                >
                  {t("office.xlsx.protect.dialog.remove")}
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" data-testid="xlsx-name-add" onClick={addRow}>
                {t("office.xlsx.protect.dialog.add")}
              </Button>
            </div>
          </div>
          {error ? <p role="alert" className="text-caption text-destructive" data-testid="xlsx-protect-error">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-protect-cancel" onClick={onClose}>
            {t("office.xlsx.protect.dialog.cancel")}
          </Button>
          <Button type="button" size="sm" aria-disabled={readOnly || undefined} data-testid="xlsx-name-apply" onClick={applyNames}>
            {t("office.xlsx.protect.dialog.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

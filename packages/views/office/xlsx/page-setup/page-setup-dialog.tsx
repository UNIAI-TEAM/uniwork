"use client";

// C2 (UNI-926): the Page Setup dialog. It edits the active sheet's print
// settings; Apply maps the form to the engine's set_page_setup op and rides
// the editor's one edit port (the session model folds it and the gateway
// merges each present field into the worksheet). Fields left on "Keep" stay
// verbatim in the file, so a partial edit never clobbers untouched settings.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import type { XlsxPageSetupFields } from "@uniwork/office-engine/xlsx";
import type { XlsxSelection } from "../types";
import {
  buildPageSetupFields,
  initialPageSetupForm,
  selectionPrintArea,
  XLSX_PAPER_SIZES,
  type XlsxBooleanState,
  type XlsxPageSetupFormState,
} from "./page-setup-form";

export interface XlsxPageSetupDialogProps {
  selection: XlsxSelection | null;
  readOnly?: boolean;
  onApply: (fields: XlsxPageSetupFields) => void;
  onClose: () => void;
}

const KEEP = "keep";

export function XlsxPageSetupDialog({ selection, readOnly = false, onApply, onClose }: XlsxPageSetupDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<XlsxPageSetupFormState>(() => initialPageSetupForm());
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<XlsxPageSetupFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const booleanItems = [
    { value: KEEP, label: t("office.xlsx.pageSetup.dialog.keep") },
    { value: "on", label: t("office.xlsx.pageSetup.dialog.on") },
    { value: "off", label: t("office.xlsx.pageSetup.dialog.off") },
  ];
  const apply = () => {
    if (readOnly) return;
    const built = buildPageSetupFields(form, selection);
    if (!built.ok) {
      const key = built.error === "printTitles" ? "invalidTitles"
        : built.error === "printArea" ? "invalidPrintArea"
        : built.error === "frozenPair" ? "invalidFrozenPair"
        : built.error === "empty" ? "empty"
        : "invalidNumber";
      setError(t(`office.xlsx.pageSetup.dialog.${key}`));
      return;
    }
    onApply(built.fields);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="xlsx-page-setup" closeLabel={t("office.xlsx.pageSetup.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.pageSetup.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-orientation" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.orientation")}</Label>
              <Select
                id="xlsx-page-orientation"
                aria-label={t("office.xlsx.pageSetup.dialog.orientation")}
                triggerVariant="subtle"
                value={form.orientation}
                onValueChange={(value) => { if (value !== null) update({ orientation: value as XlsxPageSetupFormState["orientation"] }); }}
                items={[
                  { value: KEEP, label: t("office.xlsx.pageSetup.dialog.keep") },
                  { value: "portrait", label: t("office.xlsx.pageSetup.dialog.portrait") },
                  { value: "landscape", label: t("office.xlsx.pageSetup.dialog.landscape") },
                ]}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-paper" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.paperSize")}</Label>
              <Select
                id="xlsx-page-paper"
                aria-label={t("office.xlsx.pageSetup.dialog.paperSize")}
                triggerVariant="subtle"
                value={form.paperSize === "keep" ? KEEP : String(form.paperSize)}
                onValueChange={(value) => { if (value !== null) update({ paperSize: value === KEEP ? KEEP : Number(value) }); }}
                items={[
                  { value: KEEP, label: t("office.xlsx.pageSetup.dialog.keep") },
                  ...XLSX_PAPER_SIZES.map((paper) => ({ value: String(paper.value), label: t(`office.xlsx.pageSetup.paper.${paper.key}`) })),
                ]}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-margins" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.margins")}</Label>
              <Select
                id="xlsx-page-margins"
                aria-label={t("office.xlsx.pageSetup.dialog.margins")}
                triggerVariant="subtle"
                value={form.margins}
                onValueChange={(value) => { if (value !== null) update({ margins: value as XlsxPageSetupFormState["margins"] }); }}
                items={[
                  { value: KEEP, label: t("office.xlsx.pageSetup.dialog.keep") },
                  { value: "normal", label: t("office.xlsx.pageSetup.dialog.marginNormal") },
                  { value: "wide", label: t("office.xlsx.pageSetup.dialog.marginWide") },
                  { value: "narrow", label: t("office.xlsx.pageSetup.dialog.marginNarrow") },
                ]}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-scale" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.scale")}</Label>
              <Input id="xlsx-page-scale" data-testid="xlsx-page-scale" className="h-8" inputMode="numeric" value={form.scale} onChange={(event) => update({ scale: event.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-fit" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.fitToPage")}</Label>
              <Select
                id="xlsx-page-fit"
                aria-label={t("office.xlsx.pageSetup.dialog.fitToPage")}
                triggerVariant="subtle"
                value={form.fitToPage}
                onValueChange={(value) => { if (value !== null) update({ fitToPage: value as XlsxBooleanState }); }}
                items={booleanItems}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-fitw" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.fitToWidth")}</Label>
              <Input id="xlsx-page-fitw" className="h-8" inputMode="numeric" value={form.fitToWidth} onChange={(event) => update({ fitToWidth: event.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-fith" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.fitToHeight")}</Label>
              <Input id="xlsx-page-fith" className="h-8" inputMode="numeric" value={form.fitToHeight} onChange={(event) => update({ fitToHeight: event.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-gridlines" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.printGridlines")}</Label>
              <Select
                id="xlsx-page-gridlines"
                aria-label={t("office.xlsx.pageSetup.dialog.printGridlines")}
                triggerVariant="subtle"
                value={form.printGridlines}
                onValueChange={(value) => { if (value !== null) update({ printGridlines: value as XlsxBooleanState }); }}
                items={booleanItems}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-headings" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.printHeadings")}</Label>
              <Select
                id="xlsx-page-headings"
                aria-label={t("office.xlsx.pageSetup.dialog.printHeadings")}
                triggerVariant="subtle"
                value={form.printHeadings}
                onValueChange={(value) => { if (value !== null) update({ printHeadings: value as XlsxBooleanState }); }}
                items={booleanItems}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-frozen-rows" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.frozenRows")}</Label>
              <Input id="xlsx-page-frozen-rows" className="h-8" inputMode="numeric" value={form.frozenRows} onChange={(event) => update({ frozenRows: event.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-frozen-cols" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.frozenColumns")}</Label>
              <Input id="xlsx-page-frozen-cols" className="h-8" inputMode="numeric" value={form.frozenColumns} onChange={(event) => update({ frozenColumns: event.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-print-area" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.printArea")}</Label>
              <Select
                id="xlsx-page-print-area"
                aria-label={t("office.xlsx.pageSetup.dialog.printArea")}
                triggerVariant="subtle"
                value={form.printArea}
                onValueChange={(value) => { if (value !== null) update({ printArea: value as XlsxPageSetupFormState["printArea"] }); }}
                items={[
                  { value: KEEP, label: t("office.xlsx.pageSetup.dialog.keep") },
                  { value: "selection", label: t("office.xlsx.pageSetup.dialog.printAreaSelection", { range: selectionPrintArea(selection) ?? "" }) },
                  { value: "clear", label: t("office.xlsx.pageSetup.dialog.printAreaClear") },
                ]}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="xlsx-page-print-titles" className="text-caption font-medium">{t("office.xlsx.pageSetup.dialog.printTitles")}</Label>
              <Input
                id="xlsx-page-print-titles"
                data-testid="xlsx-page-print-titles"
                className="h-8"
                placeholder={t("office.xlsx.pageSetup.dialog.printTitlesPlaceholder")}
                value={form.printTitles}
                disabled={form.printTitlesClear}
                onChange={(event) => update({ printTitles: event.target.value })}
              />
              <label className="flex items-center gap-2 text-caption text-muted-foreground">
                <input
                  type="checkbox"
                  data-testid="xlsx-page-print-titles-clear"
                  checked={form.printTitlesClear}
                  onChange={(event) => update({ printTitlesClear: event.target.checked })}
                />
                {t("office.xlsx.pageSetup.dialog.printTitlesClear")}
              </label>
            </div>
          </div>

          <p className="text-caption text-muted-foreground">{t("office.xlsx.pageSetup.dialog.note")}</p>
          {error ? <p role="alert" className="text-caption text-destructive" data-testid="xlsx-page-setup-error">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xlsx-page-setup-cancel" onClick={onClose}>
            {t("office.xlsx.pageSetup.dialog.cancel")}
          </Button>
          <Button type="button" size="sm" aria-disabled={readOnly || undefined} data-testid="xlsx-page-setup-apply" onClick={apply}>
            {t("office.xlsx.pageSetup.dialog.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

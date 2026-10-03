"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { PdfPageScopeField, resolvePageSelection } from "./page-size-dialog";
import { MAX_NUP_PAGES_PER_SHEET, MIN_NUP_PAGES_PER_SHEET, pdfPageBoxErrorMessage } from "./provider";
import type { PdfNUpDialogProps, PdfPageBoxPaper } from "./types";

/** The Select primitive treats "" as nothing selected, so "keep the sheet
    size" needs a sentinel of its own and is translated back at the boundary. */
const KEEP_PAPER = "__keep__";

const PAPERS: readonly PdfPageBoxPaper[] = ["a4", "letter"];

function wholeNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * N-up dialog: place several pages of the selection on one sheet as a rows ×
 * columns grid, optionally on a fixed paper size. The provider validates the
 * grid and submits one `setNUp` envelope.
 */
export function PdfNUpDialog({
  open,
  pages,
  provider,
  disabled = false,
  onOpenChange,
  onApplied,
}: PdfNUpDialogProps) {
  const { t } = useTranslation();
  const [allPages, setAllPages] = useState(true);
  const [ranges, setRanges] = useState("");
  const [rows, setRows] = useState("1");
  const [cols, setCols] = useState("2");
  const [paper, setPaper] = useState<string>(KEEP_PAPER);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAllPages(true);
      setRanges("");
      setRows("1");
      setCols("2");
      setPaper(KEEP_PAPER);
      setPending(false);
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  const paperItems = useMemo(
    () => [
      { value: KEEP_PAPER, label: t("office.pdf.pageBox.nUp.paperKeep") },
      ...PAPERS.map((value) => ({ value, label: t(`office.pdf.pageBox.paper.${value}`) })),
    ],
    [t],
  );

  const rowCount = wholeNumber(rows);
  const colCount = wholeNumber(cols);
  const perSheet = rowCount !== null && colCount !== null ? rowCount * colCount : null;

  const submit = () => {
    if (disabled || pending) return;
    const targets = resolvePageSelection(pages, allPages, ranges);
    if (!targets) {
      setError(t("office.pdf.pageBox.errors.pages"));
      return;
    }
    if (
      rowCount === null ||
      colCount === null ||
      perSheet === null ||
      perSheet < MIN_NUP_PAGES_PER_SHEET ||
      perSheet > MAX_NUP_PAGES_PER_SHEET
    ) {
      setError(t("office.pdf.pageBox.errors.layout"));
      return;
    }
    const chosen = paper === KEEP_PAPER ? undefined : (paper as PdfPageBoxPaper);
    setPending(true);
    setError(null);
    void (async () => {
      try {
        await provider.setNUp({ pages: targets, layout: { rows: rowCount, cols: colCount }, ...(chosen ? { paper: chosen } : {}) });
        onApplied?.();
        onOpenChange(false);
      } catch (reason) {
        setError(pdfPageBoxErrorMessage(reason, t));
      } finally {
        setPending(false);
      }
    })();
  };

  const locked = disabled || pending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!pending}
        closeLabel={t("office.pdf.pageBox.close")}
        data-testid="pdf-n-up-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("office.pdf.pageBox.nUp.title")}</DialogTitle>
          <DialogDescription>{t("office.pdf.pageBox.nUp.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <PdfPageScopeField
            pages={pages}
            allPages={allPages}
            onAllPagesChange={setAllPages}
            ranges={ranges}
            onRangesChange={setRanges}
            idPrefix="pdf-page-box-nup"
            disabled={locked}
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="pdf-page-box-nup-rows">{t("office.pdf.pageBox.nUp.rows")}</Label>
              <Input
                id="pdf-page-box-nup-rows"
                type="number"
                min={1}
                max={MAX_NUP_PAGES_PER_SHEET}
                inputMode="numeric"
                value={rows}
                disabled={locked}
                onChange={(event) => setRows(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pdf-page-box-nup-cols">{t("office.pdf.pageBox.nUp.cols")}</Label>
              <Input
                id="pdf-page-box-nup-cols"
                type="number"
                min={1}
                max={MAX_NUP_PAGES_PER_SHEET}
                inputMode="numeric"
                value={cols}
                disabled={locked}
                onChange={(event) => setCols(event.target.value)}
              />
            </div>
          </div>

          <p className="text-caption text-muted-foreground" aria-live="polite">
            {perSheet === null
              ? t("office.pdf.pageBox.nUp.perSheetInvalid")
              : t("office.pdf.pageBox.nUp.perSheet", { count: perSheet })}
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="pdf-page-box-nup-paper">{t("office.pdf.pageBox.nUp.paper")}</Label>
            <Select
              id="pdf-page-box-nup-paper"
              aria-label={t("office.pdf.pageBox.nUp.paper")}
              value={paper}
              items={paperItems}
              disabled={locked}
              onValueChange={(value) => {
                if (typeof value === "string") setPaper(value);
              }}
            />
          </div>
        </div>

        {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("office.pdf.pageBox.cancel")}
          </Button>
          <Button type="button" disabled={locked || pages.length === 0} onClick={submit}>
            {pending ? t("office.pdf.pageBox.applying") : t("office.pdf.pageBox.nUp.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { buildPrintOptions, buildSavePdfOptions, initialPrintForm, paperPageSize, parseCopies, resolveDestination, resolveRange, type PrintForm } from "./print-settings";
import { PreviewPane } from "./preview-pane";
import { SettingsPanel } from "./settings-panel";
import { usePreviewDocument, usePrinters } from "./use-print-data";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewJob } from "./types";

/**
 * The in-app print dialog (UNI-961): settings on the left, the laid-out pages
 * on the right. It resolves once through `onChoice`: Print with the options,
 * Save as PDF, the system dialog, or cancel (Esc, the close button, Cancel).
 * Backdrop clicks do nothing, so a stray click never throws a print setup away.
 *
 * Settings that change the page (orientation, paper) re-lay out the preview;
 * copies, page range, colour and duplex only change what is sent. The
 * destination decides the primary button: Print for a printer, Save for the
 * in-app PDF destination, Continue for a printer whose port prompts, which
 * hands the job to the system dialog and with it every setting (the preview
 * then shows the document's own sheet).
 */
export function PrintPreviewDialog({ bridge, job, onChoice }: {
  bridge: PrintPreviewBridge;
  job: PrintPreviewJob;
  onChoice(choice: PrintPreviewChoice): void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.print" });
  const [form, setForm] = useState<PrintForm>(() => initialPrintForm(job.geometry));
  const [page, setPage] = useState(0);
  const printers = usePrinters(bridge);

  const printerList = printers.phase === "ready" ? printers.printers : [];
  const destination = resolveDestination(form.deviceName, printerList);
  const decidedBySystem = destination.kind === "system-dialog";

  const geometry = useMemo(() => (decidedBySystem ? job.geometry : { landscape: form.landscape, pageSize: paperPageSize(form.paper, job.geometry.pageSize) }), [decidedBySystem, form.landscape, form.paper, job.geometry]);
  const { state, busy } = usePreviewDocument(bridge, job, geometry);

  // Pages can be counted and chosen only from a settled layout; a failed one
  // (too large, busy, timed out) leaves "all pages", which needs no count.
  const pageCount = state.phase === "ready" && !busy ? state.document.pageCount : null;
  const rangeLocked = state.phase === "failed" && !busy;
  const current = Math.min(page, Math.max(0, (state.phase === "ready" ? state.document.pageCount : 1) - 1));

  const copies = parseCopies(form.copies);
  const range = resolveRange(rangeLocked || decidedBySystem ? "all" : form.rangeMode, form.customRange, current, pageCount);
  // Copies only matter to a printer, and the system dialog takes every setting itself.
  const canContinue = decidedBySystem || (range.kind !== "invalid" && (destination.kind === "save-pdf" || copies !== null));

  const proceed = (): void => {
    if (!canContinue) return;
    if (destination.kind === "system-dialog") onChoice({ kind: "system" });
    else if (destination.kind === "save-pdf") onChoice({ kind: "save-pdf", options: buildSavePdfOptions({ landscape: geometry.landscape, pageSize: geometry.pageSize, range }) });
    else if (copies !== null) onChoice({ kind: "print", options: buildPrintOptions({ landscape: geometry.landscape, pageSize: geometry.pageSize, deviceName: destination.name, copies, range, color: form.color, duplex: form.duplex }) });
  };
  const proceedLabel = destination.kind === "save-pdf" ? t("save") : decidedBySystem ? t("continueInSystemDialog") : t("print");

  return <Dialog open onOpenChange={(open) => { if (!open) onChoice({ kind: "cancel" }); }} disablePointerDismissal>
    <DialogContent closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="p-4 pr-12">
        <DialogTitle>{t("title", { title: job.title })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-4 overflow-y-auto px-4 pb-4 md:grid-cols-[18rem_minmax(0,1fr)] md:overflow-hidden">
        <div className="min-h-0 md:overflow-y-auto md:pr-1">
          <SettingsPanel form={form} onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))} printers={printers} destination={destination} range={range} pageCount={pageCount} rangeLocked={rangeLocked} />
        </div>
        <div className="flex h-96 min-h-0 flex-col md:h-auto">
          <PreviewPane state={state} busy={busy} geometry={geometry} current={current} onCurrentChange={setPage} />
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <Button type="button" variant="link" onClick={() => onChoice({ kind: "system" })}>{t("systemDialog")}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onChoice({ kind: "cancel" })}>{t("cancel")}</Button>
          {printers.phase !== "loading" ? <Button type="button" aria-disabled={!canContinue || undefined} onClick={proceed}>{proceedLabel}</Button> : null}
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

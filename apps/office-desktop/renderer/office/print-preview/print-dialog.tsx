import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { buildPrintOptions, initialPrintForm, paperPageSize, parseCopies, resolveRange, type PrintForm } from "./print-settings";
import { PreviewPane } from "./preview-pane";
import { SettingsPanel } from "./settings-panel";
import { usePreviewDocument, usePrinters } from "./use-print-data";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewJob } from "./types";

/**
 * The in-app print dialog (UNI-961): settings on the left, the laid-out pages
 * on the right. It resolves once through `onChoice`: Print with the options,
 * the system dialog, or cancel (Esc, the close button, Cancel). Backdrop
 * clicks do nothing, so a stray click never throws a print setup away.
 *
 * Settings that change the page (orientation, paper) re-lay out the preview;
 * copies, page range, colour and duplex only change what is sent.
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

  const geometry = useMemo(() => ({ landscape: form.landscape, pageSize: paperPageSize(form.paper, job.geometry.pageSize) }), [form.landscape, form.paper, job.geometry.pageSize]);
  const { state, busy } = usePreviewDocument(bridge, job, geometry);

  // Pages can be counted and chosen only from a settled layout; a failed one
  // (too large, busy, timed out) leaves "all pages", which needs no count.
  const pageCount = state.phase === "ready" && !busy ? state.document.pageCount : null;
  const rangeLocked = state.phase === "failed" && !busy;
  const current = Math.min(page, Math.max(0, (state.phase === "ready" ? state.document.pageCount : 1) - 1));

  const printerList = printers.phase === "ready" ? printers.printers : [];
  const deviceName = form.deviceName || printerList.find((printer) => printer.isDefault)?.name || printerList[0]?.name || "";
  const copies = parseCopies(form.copies);
  const range = resolveRange(rangeLocked ? "all" : form.rangeMode, form.customRange, current, pageCount);
  const canPrint = deviceName !== "" && copies !== null && range.kind !== "invalid";

  const print = (): void => {
    if (!canPrint) return;
    onChoice({ kind: "print", options: buildPrintOptions({ landscape: geometry.landscape, pageSize: geometry.pageSize, deviceName, copies, range, color: form.color, duplex: form.duplex }) });
  };

  return <Dialog open onOpenChange={(open) => { if (!open) onChoice({ kind: "cancel" }); }} disablePointerDismissal>
    <DialogContent closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="p-4 pr-12">
        <DialogTitle>{t("title", { title: job.title })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-4 overflow-y-auto px-4 pb-4 md:grid-cols-[18rem_minmax(0,1fr)] md:overflow-hidden">
        <div className="min-h-0 md:overflow-y-auto md:pr-1">
          <SettingsPanel form={form} onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))} printers={printers} deviceName={deviceName} range={range} pageCount={pageCount} rangeLocked={rangeLocked} />
        </div>
        <div className="flex h-96 min-h-0 flex-col md:h-auto">
          <PreviewPane state={state} busy={busy} geometry={geometry} current={current} onCurrentChange={setPage} />
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <Button type="button" variant="link" onClick={() => onChoice({ kind: "system" })}>{t("systemDialog")}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onChoice({ kind: "cancel" })}>{t("cancel")}</Button>
          {printers.phase === "ready" && printerList.length > 0 ? <Button type="button" aria-disabled={!canPrint || undefined} onClick={print}>{t("print")}</Button> : null}
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

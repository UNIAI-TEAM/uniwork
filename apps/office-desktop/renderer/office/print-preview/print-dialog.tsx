import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { buildPrintOptions, buildSavePdfOptions, initialPrintForm, paperPageSize, parseCopies, resolveDestination, resolveRange, type PrintForm } from "./print-settings";
import { PreviewPane } from "./preview-pane";
import { SettingsPanel } from "./settings-panel";
import { usePreviewDocument, usePrinters } from "./use-print-data";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewJob } from "./types";

/** What the hook tells the dialog about its shell: the Dialog itself outlives a job. */
export interface PrintDialogShell {
  /** True while a job is pending; false starts Base UI's close (focus return, inert cleanup). */
  readonly open: boolean;
  /** The job on screen; kept after `open` turns false until the close finishes. Null: nothing rendered. */
  readonly job: PrintPreviewJob | null;
  /** Distinct per job, so a new job starts with fresh settings. */
  readonly jobId: number;
  /** Where focus goes when the dialog closes; null for the default. */
  focusAfterClose(): HTMLElement | null;
  /** Base UI finished closing: the job may be dropped. */
  onClosed(): void;
}

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
export function PrintPreviewDialog({ bridge, shell, onChoice }: {
  bridge: PrintPreviewBridge;
  shell: PrintDialogShell;
  onChoice(choice: PrintPreviewChoice): void;
}) {
  // One Dialog root for the life of the hook, opened and closed by `open`: an
  // unmounted open dialog never runs Base UI's close path, so the second open
  // of a session would leave focus guards and inert state behind.
  return <Dialog open={shell.open} onOpenChange={(open) => { if (!open) onChoice({ kind: "cancel" }); }} onOpenChangeComplete={(open) => { if (!open) shell.onClosed(); }} disablePointerDismissal>
    {shell.job ? <PrintPreviewContent key={shell.jobId} bridge={bridge} job={shell.job} focusAfterClose={shell.focusAfterClose} onChoice={onChoice} /> : null}
  </Dialog>;
}

function PrintPreviewContent({ bridge, job, focusAfterClose, onChoice }: {
  bridge: PrintPreviewBridge;
  job: PrintPreviewJob;
  focusAfterClose(): HTMLElement | null;
  onChoice(choice: PrintPreviewChoice): void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.print" });
  const [form, setForm] = useState<PrintForm>(() => initialPrintForm(job.geometry));
  const [page, setPage] = useState(0);
  const printers = usePrinters(bridge);
  const popupRef = useRef<HTMLDivElement | null>(null);

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

  // Focus starts on the printer select (the first field) and returns to what
  // opened the dialog while that is still on the page; otherwise Base UI's default.
  const initialFocus = (): HTMLElement | null => popupRef.current?.querySelector<HTMLElement>('[role="combobox"]') ?? null;
  const finalFocus = (): HTMLElement | null => focusAfterClose();

  return <DialogContent ref={popupRef} initialFocus={initialFocus} finalFocus={finalFocus} closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
    <DialogHeader className="p-4 pr-12">
      <DialogTitle>{t("title", { title: job.title })}</DialogTitle>
      <DialogDescription>{t("description")}</DialogDescription>
    </DialogHeader>
    {/* Below md one column scrolls as a whole: the settings first, then a preview of fixed height, neither squeezed into the other. From md two columns, each scrolling alone. */}
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4 md:grid md:grid-cols-[18rem_minmax(0,1fr)] md:overflow-hidden">
      <div className="shrink-0 md:min-h-0 md:overflow-y-auto md:pr-1">
        <SettingsPanel form={form} onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))} printers={printers} destination={destination} range={range} pageCount={pageCount} rangeLocked={rangeLocked} />
      </div>
      <div className="flex h-80 shrink-0 flex-col md:h-auto md:min-h-0 md:shrink">
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
  </DialogContent>;
}

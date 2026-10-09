import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import type { DesktopPrintGeometry } from "../../../shared/ipc";
import { PreviewPages } from "./preview-pages";
import type { PreviewState } from "./use-print-data";

/** The right half of the dialog: how many pages, which one is shown, and the
 * thumbnails. The failure copy lives here; whether printing is still allowed is
 * the dialog's call. */
export function PreviewPane({ state, busy, geometry, current, onCurrentChange }: {
  state: PreviewState;
  /** A new layout is on its way; the old pages stay up, dimmed. */
  busy: boolean;
  geometry: DesktopPrintGeometry;
  current: number;
  onCurrentChange(pageIndex: number): void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.print" });
  const scrollerRef = useRef<HTMLOListElement | null>(null);
  const { width, height } = geometry.pageSize;
  const aspect = geometry.landscape ? height / width : width / height;

  const ready = state.phase === "ready" ? state.document : null;
  const pageCount = ready?.pageCount ?? 0;
  // Spoken only when a button moves the page; the visible "Page x / y" also
  // changes on every scroll step and would otherwise be read out each time.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => { setAnnouncement(""); }, [ready?.id]);

  const go = (pageIndex: number): void => {
    setAnnouncement(t("pageOf", { current: pageIndex + 1, total: pageCount }));
    onCurrentChange(pageIndex);
    const slot = scrollerRef.current?.querySelector<HTMLElement>(`[data-page-index="${pageIndex}"]`);
    slot?.scrollIntoView?.({ block: "nearest" });
  };

  const showFailure = state.phase === "failed" && !busy;
  const showSpinner = !ready && !showFailure;

  return <section aria-label={t("preview")} aria-busy={busy} className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex items-center justify-between gap-2 text-label text-muted-foreground">
      <span>{ready ? t("pageCount", { count: pageCount }) : null}</span>
      {ready ? <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("previousPage")} title={t("previousPage")} disabled={current <= 0} onClick={() => go(current - 1)}><ChevronLeft className="size-4 shrink-0" aria-hidden /></Button>
        <span>{t("pageOf", { current: current + 1, total: pageCount })}</span>
        <span className="sr-only" aria-live="polite">{announcement}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("nextPage")} title={t("nextPage")} disabled={current >= pageCount - 1} onClick={() => go(current + 1)}><ChevronRight className="size-4 shrink-0" aria-hidden /></Button>
      </div> : null}
    </div>
    {ready ? <div className={busy ? "flex min-h-0 flex-1 flex-col opacity-60 transition-opacity" : "flex min-h-0 flex-1 flex-col transition-opacity"}>
      <PreviewPages key={ready.id} source={ready} current={current} onViewing={onCurrentChange} scrollerRef={scrollerRef} aspect={aspect} />
    </div> : null}
    {showSpinner ? <p role="status" className="flex flex-1 items-center justify-center gap-2 rounded-md bg-surface-hover/60 p-6 text-body text-muted-foreground"><Spinner />{t("previewPreparing")}</p> : null}
    {showFailure && state.phase === "failed" ? <p role="status" className="flex flex-1 items-center justify-center rounded-md bg-surface-hover/60 p-6 text-center text-body text-muted-foreground">{state.reason === "print_preview_too_large" ? t("previewTooLarge") : t("previewFailed")}</p> : null}
  </section>;
}

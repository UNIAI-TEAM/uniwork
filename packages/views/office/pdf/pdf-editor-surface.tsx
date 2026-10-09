"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import { TriangleAlert, X, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../../common/notice";
import { OfficeFrame } from "../frame";
import { PdfCanvas, type PdfCanvasHighlight, type PdfCanvasHighlightQuad, type PdfCanvasPage, type PdfCanvasRegion, type PdfCanvasTool } from "./canvas";
import { PdfThumbnailsRail } from "./chrome";
import { PdfFindBar } from "./find/pdf-find-bar";
import type { PdfSearchHit } from "./find/types";
import { createPdfFormOperationProvider } from "./forms";
import type { PdfFormField } from "./forms";
import { createPdfNoteOperationProvider } from "./notes";
import type { PdfNoteAddTarget, PdfNoteThread } from "./notes";
import { PdfPages } from "./pages/pdf-pages";
import { PdfRailThumbnail } from "./pdf-rail-thumbnail";
import { PdfEditorPanels, type PdfEditorPanelId, type PdfEditorPanelSlots } from "./pdf-editor-panels";
import { createPdfStampOperationProvider } from "./stamps/provider";
import type { PdfStampPlacement } from "./stamps";
import type { PdfEditOperation, PdfEditorHandle, PdfFontReport, PdfPage, PdfSelection, PdfTextMarkupSelection } from "./types";

/** The panel ids the surface can host: the shell's panels plus the page strip. */
export type PdfSurfacePanelId = PdfEditorPanelId | "pages";

/** The handle members the surface uses; no snapshot type, so any host's handle fits. */
export type PdfSurfaceEditor = Pick<PdfEditorHandle, "edit" | "renderer" | "getCanvasPages" | "submitEngineOperations" | "readFormFields" | "searchText" | "readSavedNotes">;

/** Runs one document change: the shell serialises it, marks the save coordinator
 * dirty on success and records a translated failure on error (then rethrows so a
 * panel can show its own message too). */
export type PdfSurfaceRun = <T>(action: () => Promise<T> | T) => Promise<T>;

export interface PdfEditorSurfaceProps {
  editor: PdfSurfaceEditor;
  pages: readonly PdfPage[];
  readOnly: boolean;
  zoom: number;
  /** The frame's canvas scroll container, so the shell can measure the pane for
   *  the fit modes (F-12). */
  canvasRef?: Ref<HTMLDivElement>;
  selection: PdfSelection | null;
  selectedPage: number | null;
  /** Bumped by the shell whenever the document bytes changed (edit, undo, redo). */
  revision: number;
  activePanel: PdfSurfacePanelId | null;
  onActivePanelChange: (panel: PdfSurfacePanelId | null) => void;
  findOpen: boolean;
  onFindClose: () => void;
  /** Thumbnail or find-hit navigation. */
  onSelectPage: (page: number) => void;
  /** A click on the canvas (page background or object). */
  onCanvasSelect: (selection: PdfSelection) => void;
  fontReport: PdfFontReport | null;
  errorKey: string | null;
  run: PdfSurfaceRun;
  /** The ribbon band; the surface mounts it as the frame's first row. */
  ribbon?: ReactNode;
  /** The status bar; the surface mounts it as the frame's last row. */
  statusBar?: ReactNode;
  /** A shell-owned notice shown above the surface's own notices. */
  banner?: ReactNode;
  /** Below sm the thumbnail rail is hidden until the status bar's toggle opens it. */
  railOpen?: boolean;
  /** The rail slot, so the shell can move focus into the open overlay rail. */
  railRef?: Ref<HTMLDivElement>;
}

const NOTE_SIZE = 24;
const STAMP_SIZE = { width: 120, height: 60 };
const FIND_DEBOUNCE_MS = 250;
const NO_PAGES: readonly PdfCanvasPage[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The quads a find hit may carry; absent until the search reads page geometry,
 * so a hit without them simply paints nothing. */
function hitQuads(hit: PdfSearchHit): readonly PdfCanvasHighlightQuad[] {
  const quads: unknown = (hit as unknown as Record<string, unknown>)["quads"];
  if (!Array.isArray(quads)) return [];
  return (quads as unknown[]).filter((quad): quad is PdfCanvasHighlightQuad => Array.isArray(quad) && quad.length === 4);
}

/** Turn the current find hits into canvas highlights, marking the active hit. */
function toHighlights(hits: readonly PdfSearchHit[], activeIndex: number): readonly PdfCanvasHighlight[] {
  const active = hits[activeIndex];
  return hits.flatMap((hit) => hitQuads(hit).map((quad, index) => ({ id: `${hit.id}:${index}`, page: hit.page, quad, active: hit === active })));
}

/** A box of `width` x `height` hanging below the clicked point, in PDF user space
 * (origin bottom-left), kept inside the page. */
function boxAt(page: PdfCanvasPage, region: PdfCanvasRegion, width: number, height: number): [number, number, number, number] {
  const left = clamp(region.x, 0, page.width - width);
  const top = clamp(page.height - region.y, height, page.height);
  return [left, top - height, left + width, top];
}

function freshPages(editor: PdfSurfaceEditor): readonly PdfCanvasPage[] {
  // New objects every time so the canvas re-requests its render after an edit.
  return (editor.getCanvasPages?.() ?? NO_PAGES).map((page) => ({ ...page }));
}

function toolFor(panel: PdfSurfacePanelId | null, enabled: boolean): PdfCanvasTool {
  if (!enabled) return "select";
  if (panel === "markups") return "region";
  if (panel === "notes" || panel === "stamps") return "point";
  return "select";
}

function noop(): void {
  // A failed edit is already reported through the shell's notice.
}

/**
 * The ready-state PDF editor inside the shared Office frame (F1-F10): the shell's
 * ribbon and status bar, find and notices as sub-bars, thumbnails in the rail,
 * the rendered page canvas with its annotate tool, and the side panels. Every change goes through `run`,
 * so a successful edit marks the save coordinator dirty and a failure shows a
 * translated message instead of crashing the editor.
 */
export function PdfEditorSurface({ editor, pages, readOnly, zoom, canvasRef, selection, selectedPage, revision, activePanel, onActivePanelChange, findOpen, onFindClose, onSelectPage, onCanvasSelect, fontReport, errorKey, run, ribbon, statusBar, banner, railOpen = false, railRef }: PdfEditorSurfaceProps) {
  const { t } = useTranslation();
  const canvasMode = editor.renderer !== undefined && editor.getCanvasPages !== undefined;
  const [canvasPages, setCanvasPages] = useState<readonly PdfCanvasPage[]>(() => (canvasMode ? freshPages(editor) : NO_PAGES));
  const [focus, setFocus] = useState<{ page: number; token: number } | null>(null);
  const [markupSelection, setMarkupSelection] = useState<PdfTextMarkupSelection | null>(null);
  const [addTarget, setAddTarget] = useState<PdfNoteAddTarget | null>(null);
  const [stampPlacement, setStampPlacement] = useState<PdfStampPlacement | null>(null);
  const [formFields, setFormFields] = useState<readonly PdfFormField[] | undefined>(undefined);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [noteThreads, setNoteThreads] = useState<readonly PdfNoteThread[] | undefined>(undefined);
  const [notesError, setNotesError] = useState<string | null>(null);
  // The translation key of the last partial-apply warning, or null.
  const [skipped, setSkipped] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly PdfSearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [finding, setFinding] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const canEdit = !readOnly && editor.edit !== undefined;
  const canEngine = !readOnly && editor.submitEngineOperations !== undefined;

  useEffect(() => {
    if (canvasMode) setCanvasPages(freshPages(editor));
  }, [canvasMode, editor, revision]);

  const submitEngine = useCallback(async (operations: readonly unknown[]): Promise<void> => {
    setSkipped(null);
    const submit = editor.submitEngineOperations;
    if (!submit) throw new Error("pdf_engine_operations_unavailable");
    const result = await run(() => submit(operations));
    if (result && result.skipped.length > 0) {
      // A form value pdf-lib cannot encode (Vietnamese in a WinAnsi field) is a
      // refusal of that value, not a browser gap: say so.
      const formOnly = result.skipped.every((skip) => skip.op === "setFormValue");
      setSkipped(formOnly ? "office.pdf.errors.formValueRejected" : "office.pdf.errors.editSkipped");
    }
  }, [editor, run]);

  const editOps = useCallback((operations: readonly PdfEditOperation[]): Promise<void> => {
    setSkipped(null);
    const edit = editor.edit;
    if (!edit) return Promise.reject(new Error("pdf_edit_unavailable"));
    return run(async () => { await edit(operations); });
  }, [editor, run]);

  const submitter = useMemo(() => ({ submit: submitEngine }), [submitEngine]);
  const noteProvider = useMemo(() => (canEngine ? createPdfNoteOperationProvider(submitter) : undefined), [canEngine, submitter]);
  const formProvider = useMemo(() => (canEngine ? createPdfFormOperationProvider(submitter) : undefined), [canEngine, submitter]);
  const stampProvider = useMemo(() => (canEngine ? createPdfStampOperationProvider({}, submitter) : undefined), [canEngine, submitter]);

  const formsOpen = activePanel === "forms";
  useEffect(() => {
    const read = editor.readFormFields;
    if (!formsOpen || !read) return;
    let cancelled = false;
    setFormsError(null);
    read().then((fields) => { if (!cancelled) setFormFields(fields); }).catch(() => {
      if (!cancelled) { setFormFields([]); setFormsError(t("office.pdf.errors.formsFailed")); }
    });
    return () => { cancelled = true; };
  }, [editor, formsOpen, revision, t]);

  const notesOpen = activePanel === "notes";
  useEffect(() => {
    const read = editor.readSavedNotes;
    if (!notesOpen) return;
    // No reader means no saved threads to wait for; clear any stale ones so a
    // reader-less handle shows the empty/composer state instead of hanging.
    if (!read) { setNoteThreads([]); return; }
    let cancelled = false;
    setNotesError(null);
    read().then((threads) => { if (!cancelled) setNoteThreads(threads); }).catch(() => {
      if (!cancelled) { setNoteThreads([]); setNotesError(t("office.pdf.notes.error")); }
    });
    return () => { cancelled = true; };
  }, [editor, notesOpen, revision, t]);

  useEffect(() => {
    const search = editor.searchText;
    if (!findOpen || !search || query.trim() === "") { setHits([]); setFinding(false); return; }
    let cancelled = false;
    setFinding(true);
    const timer = setTimeout(() => {
      search(query).then((found) => { if (!cancelled) { setHits(found); setHitIndex(0); } })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setFinding(false); });
    }, FIND_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [editor, findOpen, query, revision]);

  const highlights = useMemo(() => toHighlights(hits, hitIndex), [hits, hitIndex]);
  const focusPage = useCallback((page: number) => {
    setFocus((current) => ({ page, token: (current?.token ?? 0) + 1 }));
  }, []);
  const navigate = useCallback((page: number) => { onSelectPage(page); focusPage(page); }, [focusPage, onSelectPage]);
  const onHitActivate = useCallback((hit: PdfSearchHit) => { navigate(hit.page); }, [navigate]);

  const tool = toolFor(activePanel, canEdit || canEngine);
  const onPageRegion = useCallback((pageNumber: number, region: PdfCanvasRegion) => {
    const page = canvasPages.find((candidate) => candidate.pageNumber === pageNumber);
    if (!page) return;
    if (activePanel === "markups") {
      // The canvas is top-left origin in points; PDF user space is bottom-left.
      const top = page.height - region.y;
      const bottom = top - region.height;
      const right = region.x + region.width;
      setMarkupSelection({ page: pageNumber, quads: [[region.x, top, right, top, region.x, bottom, right, bottom]] });
    } else if (activePanel === "notes") {
      setAddTarget({ pageIndex: pageNumber - 1, page: pageNumber, rect: boxAt(page, region, NOTE_SIZE, NOTE_SIZE) });
    } else if (activePanel === "stamps") {
      setStampPlacement({ pageIndex: pageNumber - 1, rect: boxAt(page, region, STAMP_SIZE.width, STAMP_SIZE.height) });
    }
  }, [activePanel, canvasPages]);

  const applyEdit = useCallback((operation: PdfEditOperation) => { editOps([operation]).catch(noop); }, [editOps]);

  const slots = useMemo<PdfEditorPanelSlots>(() => ({
    markups: {
      selection: markupSelection,
      disabled: !canEdit,
      onMarkup: (operation) => { editOps([operation]).then(() => setMarkupSelection(null)).catch(noop); },
    },
    notes: { threads: noteThreads ?? [], provider: noteProvider, addTarget, loading: notesOpen && editor.readSavedNotes !== undefined && noteThreads === undefined && notesError === null, error: notesError, disabled: !canEngine, onApplied: () => setAddTarget(null) },
    stamps: { placement: stampPlacement, provider: stampProvider, disabled: !canEngine },
    forms: { fields: formFields, provider: formProvider, loading: formsOpen && formFields === undefined && formsError === null, error: formsError, disabled: !canEngine },
  }), [addTarget, canEdit, canEngine, editOps, editor, formFields, formProvider, formsError, formsOpen, markupSelection, noteProvider, noteThreads, notesError, notesOpen, stampPlacement, stampProvider]);

  const hint = activePanel === "markups" ? (markupSelection ? t("office.pdf.surface.areaSelected", { page: markupSelection.page }) : t("office.pdf.surface.hintRegion"))
    : activePanel === "notes" ? t("office.pdf.surface.hintNote")
      : activePanel === "stamps" ? t("office.pdf.surface.hintStamp") : null;
  const closePanel = () => onActivePanelChange(null);

  const notices = errorKey || skipped || fontReport?.missing.length || hint || banner ? (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-office-band px-3 py-2" data-testid="pdf-surface-notices">
      {banner}
      {errorKey ? <Notice tone="destructive" icon={CircleAlert} live="assertive">{t(errorKey)}</Notice> : null}
      {skipped ? <Notice tone="warning" icon={TriangleAlert} live="polite">{t(skipped)}</Notice> : null}
      {fontReport?.missing.length ? <div data-testid="pdf-font-warning"><Notice tone="warning" icon={TriangleAlert} live="polite">{t("office.pdf.fonts.missing", { fonts: fontReport.missing.join(", ") })}</Notice></div> : null}
      {hint ? <p className="text-caption text-muted-foreground" role="status" data-testid="pdf-surface-hint">{hint}</p> : null}
    </div>
  ) : null;
  const findBar = findOpen ? (
    <div className="shrink-0 border-b border-border bg-office-band px-3 py-1.5">
      <PdfFindBar query={query} hits={hits} activeIndex={hitIndex} loading={finding} onQueryChange={setQuery} onNext={() => setHitIndex((index) => (hits.length ? (index + 1) % hits.length : 0))} onPrevious={() => setHitIndex((index) => (hits.length ? (index - 1 + hits.length) % hits.length : 0))} onClose={onFindClose} onHitActivate={onHitActivate} />
    </div>
  ) : null;
  const objectEditor = selection?.kind === "text" && !readOnly ? (
    <div className="flex shrink-0 gap-2 border-t border-border bg-office-band p-2" data-testid="pdf-object-editor"><label htmlFor="pdf-text-edit" className="sr-only">{t("office.pdf.edit.textLabel")}</label><input id="pdf-text-edit" value={textDraft} onChange={(event) => setTextDraft(event.target.value)} className="min-w-0 flex-1 rounded-control border border-input bg-background px-2 py-1 text-body" placeholder={t("office.pdf.edit.textPlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId) applyEdit({ op: "replace_text", target: { page: selection.page, objectId: selection.objectId }, text: textDraft }); }}>{t("office.pdf.edit.applyText")}</Button></div>
  ) : selection?.kind === "image" && !readOnly ? (
    <div className="flex shrink-0 gap-2 border-t border-border bg-office-band p-2" data-testid="pdf-object-editor"><label htmlFor="pdf-image-asset" className="sr-only">{t("office.pdf.edit.imageLabel")}</label><input id="pdf-image-asset" value={imageAssetId} onChange={(event) => setImageAssetId(event.target.value)} className="min-w-0 flex-1 rounded-control border border-input bg-background px-2 py-1 text-body" placeholder={t("office.pdf.edit.imagePlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId && imageAssetId) applyEdit({ op: "replace_image", target: { page: selection.page, objectId: selection.objectId }, assetId: imageAssetId }); }}>{t("office.pdf.edit.applyImage")}</Button></div>
  ) : null;
  const aside = activePanel === "pages" ? (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-office-band p-2" data-testid="pdf-pages-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-label font-medium">{t("office.pdf.pages.title")}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={closePanel}><X aria-hidden /></Button>
      </div>
      <PdfPages
        pages={pages}
        disabled={!canEdit}
        rotatePages={(selected, dir) => editOps(selected.map((page): PdfEditOperation => ({ op: "rotate_page", target: { page }, degrees: dir === -90 ? 270 : dir })))}
        deletePage={(page) => editOps([{ op: "delete_page", target: { page } }])}
        setPageOrder={canEngine ? (order) => submitEngine([{ op: "setPageOrder", attributes: { order: order.map((page) => page - 1) } }]) : undefined}
      />
    </aside>
  ) : <PdfEditorPanels className="bg-office-band" activePanel={activePanel} onActivePanelChange={onActivePanelChange} slots={slots} />;

  // With a renderer the rail shows rendered previews captioned by number, like
  // the Office page rail; without one it keeps the numbered placeholders.
  const renderer = canvasMode ? editor.renderer : undefined;
  const railPages = useMemo(() => (renderer ? pages.map((page) => ({ pageNumber: page.pageNumber, label: String(page.pageNumber) })) : pages), [pages, renderer]);
  const canvasPageByNumber = useMemo(() => new Map(canvasPages.map((page) => [page.pageNumber, page] as const)), [canvasPages]);
  const renderThumbnail = useCallback((page: { pageNumber: number }): ReactNode => {
    const canvasPage = canvasPageByNumber.get(page.pageNumber);
    return renderer && canvasPage ? <PdfRailThumbnail page={canvasPage} renderer={renderer} /> : null;
  }, [canvasPageByNumber, renderer]);

  return (
    <OfficeFrame
      data-testid="pdf-canvas"
      ribbon={ribbon}
      subbar={findBar || notices ? <>{findBar}{notices}</> : undefined}
      rail={
        // Below sm an open rail floats over the canvas instead of squeezing it: the
        // fitted page keeps its width and is not clipped on the right (UIQ-3).
        <div ref={railRef} className={cn("relative z-10 w-0 shrink-0 sm:contents", !railOpen && "hidden")} data-testid="pdf-rail-slot">
          <PdfThumbnailsRail className={railOpen ? "absolute inset-y-0 left-0 flex shadow-[var(--floating-shadow)] sm:static sm:shadow-none" : "hidden sm:flex"} pages={railPages} activePage={selectedPage ?? undefined} onSelect={navigate} renderThumbnail={renderer ? renderThumbnail : undefined} />
        </div>
      }
      aside={aside}
      bottom={objectEditor}
      statusBar={statusBar}
      canvasRef={canvasRef}
      canvasClassName="flex flex-col overflow-hidden"
    >
      {canvasMode && editor.renderer ? (
        <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="pdf-document-surface">
          <PdfCanvas pages={canvasPages} renderer={editor.renderer} zoom={zoom} selection={selection} onSelectionChange={onCanvasSelect} tool={tool} onPageRegion={onPageRegion} focusPage={focus} highlights={highlights} />
        </div>
      ) : (
        <div className="flex min-h-64 min-w-0 flex-1 items-center justify-center overflow-auto p-4 text-body text-muted-foreground sm:p-8" data-testid="pdf-document-surface">
          {t("office.pdf.surface.ready")}
        </div>
      )}
    </OfficeFrame>
  );
}

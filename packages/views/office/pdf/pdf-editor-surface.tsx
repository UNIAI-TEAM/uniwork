"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import { PdfCanvas, type PdfCanvasPage, type PdfCanvasRegion, type PdfCanvasTool } from "./canvas";
import { PdfThumbnailsRail } from "./chrome";
import { PdfFindBar } from "./find/pdf-find-bar";
import type { PdfSearchHit } from "./find/types";
import { createPdfFormOperationProvider } from "./forms";
import type { PdfFormField } from "./forms";
import { createPdfNoteOperationProvider } from "./notes";
import type { PdfNoteAddTarget } from "./notes";
import { PdfPages } from "./pages/pdf-pages";
import { PdfEditorPanels, type PdfEditorPanelId, type PdfEditorPanelSlots } from "./pdf-editor-panels";
import { createPdfStampOperationProvider } from "./stamps/provider";
import type { PdfStampPlacement } from "./stamps";
import type { PdfEditOperation, PdfEditorHandle, PdfFontReport, PdfPage, PdfSelection, PdfTextMarkupSelection } from "./types";

/** The panel ids the surface can host: the shell's panels plus the page strip. */
export type PdfSurfacePanelId = PdfEditorPanelId | "pages";

/** The handle members the surface uses; no snapshot type, so any host's handle fits. */
export type PdfSurfaceEditor = Pick<PdfEditorHandle, "edit" | "renderer" | "getCanvasPages" | "submitEngineOperations" | "readFormFields" | "searchText">;

/** Runs one document change: the shell serialises it, marks the save coordinator
 * dirty on success and records a translated failure on error (then rethrows so a
 * panel can show its own message too). */
export type PdfSurfaceRun = <T>(action: () => Promise<T> | T) => Promise<T>;

export interface PdfEditorSurfaceProps {
  editor: PdfSurfaceEditor;
  pages: readonly PdfPage[];
  readOnly: boolean;
  zoom: number;
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
}

const NOTE_SIZE = 24;
const STAMP_SIZE = { width: 120, height: 60 };
const FIND_DEBOUNCE_MS = 250;
const NO_PAGES: readonly PdfCanvasPage[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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
 * The document area of the PDF editor: thumbnails, the rendered page canvas with
 * its annotate tool, find, and the side panels. Every change goes through `run`,
 * so a successful edit marks the save coordinator dirty and a failure shows a
 * translated message instead of crashing the editor.
 */
export function PdfEditorSurface({ editor, pages, readOnly, zoom, selection, selectedPage, revision, activePanel, onActivePanelChange, findOpen, onFindClose, onSelectPage, onCanvasSelect, fontReport, errorKey, run }: PdfEditorSurfaceProps) {
  const { t } = useTranslation();
  const canvasMode = editor.renderer !== undefined && editor.getCanvasPages !== undefined;
  const [canvasPages, setCanvasPages] = useState<readonly PdfCanvasPage[]>(() => (canvasMode ? freshPages(editor) : NO_PAGES));
  const [focus, setFocus] = useState<{ page: number; token: number } | null>(null);
  const [markupSelection, setMarkupSelection] = useState<PdfTextMarkupSelection | null>(null);
  const [addTarget, setAddTarget] = useState<PdfNoteAddTarget | null>(null);
  const [stampPlacement, setStampPlacement] = useState<PdfStampPlacement | null>(null);
  const [formFields, setFormFields] = useState<readonly PdfFormField[] | undefined>(undefined);
  const [formsError, setFormsError] = useState<string | null>(null);
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
    notes: { threads: [], provider: noteProvider, addTarget, disabled: !canEngine, onApplied: () => setAddTarget(null) },
    stamps: { placement: stampPlacement, provider: stampProvider, disabled: !canEngine },
    forms: { fields: formFields, provider: formProvider, loading: formsOpen && formFields === undefined && formsError === null, error: formsError, disabled: !canEngine },
  }), [addTarget, canEdit, canEngine, editOps, formFields, formProvider, formsError, formsOpen, markupSelection, noteProvider, stampPlacement, stampProvider]);

  const hint = activePanel === "markups" ? (markupSelection ? t("office.pdf.surface.areaSelected", { page: markupSelection.page }) : t("office.pdf.surface.hintRegion"))
    : activePanel === "notes" ? t("office.pdf.surface.hintNote")
      : activePanel === "stamps" ? t("office.pdf.surface.hintStamp") : null;
  const closePanel = () => onActivePanelChange(null);

  return (
    <div className="flex min-h-0 flex-1" data-testid="pdf-canvas">
      <PdfThumbnailsRail className="hidden sm:flex" pages={pages} activePage={selectedPage ?? undefined} onSelect={navigate} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20">
        <div className="flex flex-col gap-2 px-3 pt-3 empty:hidden">
          {errorKey ? <Notice tone="destructive" icon={AlertTriangle} live="assertive">{t(errorKey)}</Notice> : null}
          {skipped ? <Notice tone="warning" icon={AlertTriangle} live="polite">{t(skipped)}</Notice> : null}
          {findOpen ? <PdfFindBar query={query} hits={hits} activeIndex={hitIndex} loading={finding} onQueryChange={setQuery} onNext={() => setHitIndex((index) => (hits.length ? (index + 1) % hits.length : 0))} onPrevious={() => setHitIndex((index) => (hits.length ? (index - 1 + hits.length) % hits.length : 0))} onClose={onFindClose} onHitActivate={onHitActivate} /> : null}
          {fontReport?.missing.length ? <div data-testid="pdf-font-warning"><Notice tone="warning" icon={AlertTriangle} live="polite">{t("office.pdf.fonts.missing", { fonts: fontReport.missing.join(", ") })}</Notice></div> : null}
          {hint ? <p className="text-caption text-muted-foreground" role="status" data-testid="pdf-surface-hint">{hint}</p> : null}
        </div>
        {canvasMode && editor.renderer ? (
          <div className="flex min-h-0 flex-1 flex-col" data-testid="pdf-document-surface">
            <PdfCanvas pages={canvasPages} renderer={editor.renderer} zoom={zoom} selection={selection} onSelectionChange={onCanvasSelect} tool={tool} onPageRegion={onPageRegion} focusPage={focus} />
          </div>
        ) : (
          <div className="min-h-64 min-w-0 flex-1 overflow-auto p-4 sm:p-8">
            <div className="mx-auto min-h-[24rem] w-full max-w-4xl rounded-lg border border-border bg-background p-8 shadow-sm" data-testid="pdf-document-surface" />
          </div>
        )}
        {selection?.kind === "text" && !readOnly ? <div className="flex gap-2 border-t border-border bg-background p-2"><label htmlFor="pdf-text-edit" className="sr-only">{t("office.pdf.edit.textLabel")}</label><input id="pdf-text-edit" value={textDraft} onChange={(event) => setTextDraft(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-caption" placeholder={t("office.pdf.edit.textPlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId) applyEdit({ op: "replace_text", target: { page: selection.page, objectId: selection.objectId }, text: textDraft }); }}>{t("office.pdf.edit.applyText")}</Button></div> : null}
        {selection?.kind === "image" && !readOnly ? <div className="flex gap-2 border-t border-border bg-background p-2"><label htmlFor="pdf-image-asset" className="sr-only">{t("office.pdf.edit.imageLabel")}</label><input id="pdf-image-asset" value={imageAssetId} onChange={(event) => setImageAssetId(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-caption" placeholder={t("office.pdf.edit.imagePlaceholder")} /><Button type="button" variant="outline" size="sm" onClick={() => { if (selection.objectId && imageAssetId) applyEdit({ op: "replace_image", target: { page: selection.page, objectId: selection.objectId }, assetId: imageAssetId }); }}>{t("office.pdf.edit.applyImage")}</Button></div> : null}
      </div>
      {activePanel === "pages" ? (
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-muted/10 p-2" data-testid="pdf-pages-panel">
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
      ) : <PdfEditorPanels activePanel={activePanel} onActivePanelChange={onActivePanelChange} slots={slots} />}
    </div>
  );
}

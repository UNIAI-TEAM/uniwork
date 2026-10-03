"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, Trash2, GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PdfPage } from "../types";

export type PdfPageRotation = 90 | -90 | 180;
export interface PdfPageOperationProvider {
  rotatePages(input: { pages: readonly number[]; dir: PdfPageRotation }): Promise<void> | void;
  deletePage(input: { pageIndex: number }): Promise<void> | void;
  setPageOrder(input: { order: readonly number[] }): Promise<void> | void;
}

export interface PdfPagesProps {
  pages: readonly PdfPage[];
  selectedPages?: readonly number[];
  disabled?: boolean;
  className?: string;
  provider?: PdfPageOperationProvider;
  onSelectionChange?: (pages: readonly number[]) => void;
  /** Page numbers are the one-based displayed positions exposed by the browser PDF seam. */
  rotatePages?: (pages: readonly number[], dir: PdfPageRotation) => Promise<void> | void;
  /** Page numbers are the one-based displayed positions exposed by the browser PDF seam. */
  deletePage?: (page: number) => Promise<void> | void;
  /** Order is the complete one-based displayed page order after a drag. */
  setPageOrder?: (order: readonly number[]) => Promise<void> | void;
}

function pageNumbers(pages: readonly PdfPage[]): number[] {
  return pages.map((page) => page.pageNumber);
}

function validSelection(selection: readonly number[], pages: readonly PdfPage[]): number[] {
  const available = new Set(pageNumbers(pages));
  return selection.filter((page, index) => available.has(page) && selection.indexOf(page) === index);
}

function reorder(order: readonly number[], source: number, target: number): number[] {
  if (source === target) return [...order];
  const next = [...order];
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return next;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

/**
 * PDF page thumbnails and page-operation affordances.
 *
 * This view only emits typed browser-safe contracts. It never imports the PDF
 * engine or decodes page bytes; previews remain host-owned URLs.
 */
export function PdfPages({ pages, selectedPages: controlledSelection, disabled = false, className, provider, onSelectionChange, rotatePages, deletePage, setPageOrder }: PdfPagesProps) {
  const { t } = useTranslation();
  const [localSelection, setLocalSelection] = useState<number[]>(() => validSelection(controlledSelection ?? [], pages));
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const anchorRef = useRef<number | null>(null);
  const selected = useMemo(() => validSelection(controlledSelection ?? localSelection, pages), [controlledSelection, localSelection, pages]);
  const order = useMemo(() => pageNumbers(pages), [pages]);

  useEffect(() => {
    if (controlledSelection) setLocalSelection(validSelection(controlledSelection, pages));
  }, [controlledSelection, pages]);

  const updateSelection = (next: readonly number[]) => {
    const normalized = validSelection(next, pages);
    if (!controlledSelection) setLocalSelection(normalized);
    onSelectionChange?.(normalized);
  };

  const selectPage = (page: number, additive: boolean, range: boolean) => {
    if (range && anchorRef.current !== null) {
      const start = order.indexOf(anchorRef.current);
      const end = order.indexOf(page);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        updateSelection(order.slice(from, to + 1));
        return;
      }
    }
    if (additive) {
      updateSelection(selected.includes(page) ? selected.filter((value) => value !== page) : [...selected, page]);
    } else {
      updateSelection([page]);
    }
    anchorRef.current = page;
  };

  const rotate = () => {
    if (disabled || selected.length === 0) return;
    if (provider) void provider.rotatePages({ pages: selected.map((page) => page - 1), dir: 90 });
    else if (rotatePages) void rotatePages(selected, 90);
  };

  const remove = () => {
    if (disabled || selected.length === 0 || selected.length >= pages.length || (!deletePage && !provider)) return;
    for (const page of [...selected].sort((a, b) => b - a)) {
      if (provider) void provider.deletePage({ pageIndex: page - 1 });
      else if (deletePage) void deletePage(page);
    }
    updateSelection([]);
  };

  const drop = (target: number) => {
    if (disabled || draggedPage === null || (!setPageOrder && !provider)) return;
    const next = reorder(order, draggedPage, target);
    if (next.some((page, index) => page !== order[index])) {
      if (provider) void provider.setPageOrder({ order: next.map((page) => page - 1) });
      else if (setPageOrder) void setPageOrder(next);
    }
    setDraggedPage(null);
  };

  return (
    <aside className={cn("flex w-48 shrink-0 flex-col gap-2 border-r border-border bg-muted/10 p-2", className)} aria-label={t("office.pdf.pages.label")} data-testid="pdf-pages">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-label font-medium">{t("office.pdf.pages.title")}</h2>
        <div className="flex items-center gap-1" role="group" aria-label={t("office.pdf.pages.title")}>
          <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.rotatePage")} disabled={disabled || selected.length === 0 || (!rotatePages && !provider)} onClick={rotate}><RotateCw aria-hidden="true" /></Button>
          <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.pdf.commands.deletePage")} disabled={disabled || selected.length === 0 || selected.length >= pages.length || (!deletePage && !provider)} onClick={remove}><Trash2 aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="listbox" aria-label={t("office.pdf.pages.label")} aria-multiselectable="true">
        {pages.map((page) => {
          const isSelected = selected.includes(page.pageNumber);
          return (
            <div key={page.pageNumber} className={cn("relative flex items-stretch gap-1 rounded-md", isSelected && "bg-accent/50")} role="option" aria-selected={isSelected} tabIndex={-1} data-testid={`pdf-page-${page.pageNumber}`} draggable={!disabled && Boolean(setPageOrder || provider)} onDragStart={() => setDraggedPage(page.pageNumber)} onDragOver={(event) => { if (draggedPage !== null) event.preventDefault(); }} onDrop={() => drop(page.pageNumber)}>
              <span className="flex w-5 items-center justify-center text-muted-foreground" aria-hidden="true"><GripVertical className="size-3" /></span>
              <Button type="button" variant={isSelected ? "secondary" : "ghost"} size="sm" className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-2" aria-label={t("office.pdf.pages.page", { page: page.pageNumber })} aria-pressed={isSelected} disabled={disabled} onClick={(event) => selectPage(page.pageNumber, event.metaKey || event.ctrlKey, event.shiftKey)}>
                {page.previewUrl ? <img src={page.previewUrl} alt="" className="h-8 w-6 object-cover" draggable={false} /> : <span className="flex h-8 w-6 items-center justify-center rounded-sm border border-border bg-background text-caption" aria-hidden="true">{page.pageNumber}</span>}
                <span className="truncate">{t("office.pdf.pages.page", { page: page.pageNumber })}</span>
              </Button>
            </div>
          );
        })}
        {pages.length === 0 ? <p className="px-1 text-caption text-muted-foreground">{t("office.pdf.pages.empty")}</p> : null}
      </div>
    </aside>
  );
}

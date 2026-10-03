"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { pdfPageOpsErrorMessage } from "./error";
import type { PdfNewDocument, PdfPageOpsPanelProps } from "./types";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Parse "1-3, 5" into 1-based page numbers; null when the text is malformed. */
export function parsePageRanges(text: string, max: number): number[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (token === "") return null;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > max) return null;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function optionalSize(width: string, height: string): { width: number; height: number } | null | undefined {
  if (width.trim() === "" && height.trim() === "") return undefined;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function ResultList({ t, documents, warnings }: { t: Translate; documents: readonly PdfNewDocument[]; warnings: readonly string[] }) {
  if (documents.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/20 p-2" role="status" data-testid="pdf-page-ops-result">
      <h3 className="text-label font-medium">{t("office.pdf.pageOps.results.title")}</h3>
      <ul className="space-y-0.5">
        {documents.map((document) => (
          <li key={`${document.op}-${document.name}`} className="text-caption text-muted-foreground">
            {t("office.pdf.pageOps.results.document", { name: document.name, count: document.pageCount })}
          </li>
        ))}
      </ul>
      {warnings.map((warning, index) => (
        <p key={`${index}-${warning}`} className="text-caption text-muted-foreground">{warning}</p>
      ))}
    </div>
  );
}

/**
 * Page operations panel: insert a blank page, insert or merge another PDF,
 * extract pages and split the document. Produced documents go through the
 * provider's F2 commit seam — this panel never downloads or writes a file.
 */
export function PdfPageOpsPanel({ pages, provider, assetOptions = [], selectedPages = [], disabled = false, className, onDocuments, onApplied }: PdfPageOpsPanelProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [insertAsset, setInsertAsset] = useState<string | null>(null);
  const [mergeAssets, setMergeAssets] = useState<string[]>([]);
  const [ranges, setRanges] = useState("");
  const [chunkSize, setChunkSize] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<readonly PdfNewDocument[]>([]);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const maxPage = pages.length;
  /** 1-based displayed number → zero-based displayed position, or -1 for front. */
  const anchorPosition = (): number | null => {
    if (anchor.trim() === "") return -1;
    const page = Number(anchor);
    const position = pages.indexOf(page);
    return Number.isSafeInteger(page) && position >= 0 ? position : null;
  };

  const run = async (action: () => Promise<{ documents: readonly PdfNewDocument[]; warnings: readonly string[] }>, changed: boolean) => {
    if (disabled || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await action();
      setDocuments(result.documents);
      setWarnings(result.warnings);
      onDocuments?.(result.documents, result.warnings);
      if (changed) onApplied?.();
    } catch (reason) {
      setError(pdfPageOpsErrorMessage(reason, t));
      setDocuments([]);
      setWarnings([]);
    } finally {
      setPending(false);
    }
  };

  const insertBlank = () => {
    const position = anchorPosition();
    if (position === null) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    const size = optionalSize(width, height);
    if (size === null) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.insertBlankPage({ afterPageIndex: position, ...(size ? { size } : {}) }), true);
  };

  const insertPdf = () => {
    if (!insertAsset) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    const position = anchorPosition();
    if (position === null) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.insertPdfPages({ afterPageIndex: position, assetId: insertAsset }), true);
  };

  const extract = () => {
    const parsed = parsePageRanges(ranges, maxPage);
    if (!parsed) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    const positions = parsed.map((page) => pages.indexOf(page));
    if (positions.some((position) => position < 0)) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.extractPages({ pages: positions }), false);
  };

  const extractSelection = () => {
    if (selectedPages.length === 0) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.extractPages({ pages: [...selectedPages] }), false);
  };

  const merge = () => {
    if (mergeAssets.length === 0) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.mergePdfs({ assetIds: mergeAssets }), false);
  };

  const split = () => {
    const size = Number(chunkSize);
    if (!Number.isSafeInteger(size) || size < 1) {
      setError(t("office.pdf.pageOps.errors.input"));
      return;
    }
    void run(() => provider.splitPdf({ chunkSize: size }), false);
  };

  const toggleMerge = (id: string) => setMergeAssets((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <section className={cn("flex w-64 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-muted/10 p-2", className)} aria-label={t("office.pdf.pageOps.title")} data-testid="pdf-page-ops-panel">
      <h2 className="px-1 text-label font-medium">{t("office.pdf.pageOps.title")}</h2>

      <div className="space-y-2 rounded-md border border-border p-2">
        <h3 className="text-label font-medium">{t("office.pdf.pageOps.insertBlank.title")}</h3>
        <label className="block text-caption text-muted-foreground" htmlFor="pdf-page-ops-anchor">{t("office.pdf.pageOps.anchor")}</label>
        <Input id="pdf-page-ops-anchor" type="number" min={1} max={maxPage} inputMode="numeric" placeholder={t("office.pdf.pageOps.anchorPlaceholder")} value={anchor} onChange={(event) => setAnchor(event.target.value)} disabled={disabled || pending} />
        <div className="flex items-center gap-2">
          <Input aria-label={t("office.pdf.pageOps.insertBlank.width")} type="number" min={1} placeholder={t("office.pdf.pageOps.insertBlank.width")} value={width} onChange={(event) => setWidth(event.target.value)} disabled={disabled || pending} />
          <Input aria-label={t("office.pdf.pageOps.insertBlank.height")} type="number" min={1} placeholder={t("office.pdf.pageOps.insertBlank.height")} value={height} onChange={(event) => setHeight(event.target.value)} disabled={disabled || pending} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={insertBlank} disabled={disabled || pending}>{t("office.pdf.pageOps.insertBlank.submit")}</Button>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        <h3 className="text-label font-medium">{t("office.pdf.pageOps.insertPdf.title")}</h3>
        {assetOptions.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("office.pdf.pageOps.assetsEmpty")}</p>
        ) : (
          <div role="group" aria-label={t("office.pdf.pageOps.insertPdf.asset")} className="flex flex-wrap gap-1">
            {assetOptions.map((asset) => (
              <Button key={asset.id} type="button" size="sm" variant={insertAsset === asset.id ? "secondary" : "outline"} aria-pressed={insertAsset === asset.id} onClick={() => setInsertAsset(asset.id)} disabled={disabled || pending}>{asset.label}</Button>
            ))}
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={insertPdf} disabled={disabled || pending || !insertAsset}>{t("office.pdf.pageOps.insertPdf.submit")}</Button>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        <h3 className="text-label font-medium">{t("office.pdf.pageOps.extract.title")}</h3>
        <label className="block text-caption text-muted-foreground" htmlFor="pdf-page-ops-ranges">{t("office.pdf.pageOps.extract.ranges")}</label>
        <Input id="pdf-page-ops-ranges" placeholder={t("office.pdf.pageOps.extract.rangesPlaceholder")} value={ranges} onChange={(event) => setRanges(event.target.value)} disabled={disabled || pending} />
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={extract} disabled={disabled || pending || maxPage === 0}>{t("office.pdf.pageOps.extract.submit")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={extractSelection} disabled={disabled || pending || selectedPages.length === 0}>{t("office.pdf.pageOps.extract.submitSelection", { count: selectedPages.length })}</Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        <h3 className="text-label font-medium">{t("office.pdf.pageOps.merge.title")}</h3>
        {assetOptions.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("office.pdf.pageOps.assetsEmpty")}</p>
        ) : (
          <ul className="space-y-1" role="list">
            {assetOptions.map((asset) => (
              <li key={asset.id} className="flex items-center gap-2">
                <Checkbox id={`pdf-page-ops-merge-${asset.id}`} aria-label={asset.label} checked={mergeAssets.includes(asset.id)} onCheckedChange={() => toggleMerge(asset.id)} disabled={disabled || pending} />
                <label htmlFor={`pdf-page-ops-merge-${asset.id}`} className="text-caption">{asset.label}</label>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" size="sm" onClick={merge} disabled={disabled || pending || mergeAssets.length === 0}>{t("office.pdf.pageOps.merge.submit")}</Button>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        <h3 className="text-label font-medium">{t("office.pdf.pageOps.split.title")}</h3>
        <label className="block text-caption text-muted-foreground" htmlFor="pdf-page-ops-chunk">{t("office.pdf.pageOps.split.chunk")}</label>
        <Input id="pdf-page-ops-chunk" type="number" min={1} inputMode="numeric" value={chunkSize} onChange={(event) => setChunkSize(event.target.value)} disabled={disabled || pending} />
        <Button type="button" variant="outline" size="sm" onClick={split} disabled={disabled || pending || maxPage === 0}>{t("office.pdf.pageOps.split.submit")}</Button>
      </div>

      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
      <ResultList t={t} documents={documents} warnings={warnings} />
    </section>
  );
}

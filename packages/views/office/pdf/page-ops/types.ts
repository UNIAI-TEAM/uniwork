import type { PdfOpsBridgeOptions } from "../ops-bridge";

/** A page size in PDF points. */
export interface PdfPageSize {
  width: number;
  height: number;
}

/** Insert one blank page after a displayed position (-1 = front). Without a
    size the engine copies the neighbor's size and /Rotate. */
export interface PdfBlankPageInsertInput {
  /** Zero-based displayed position the blank page goes after; -1 = front. */
  afterPageIndex: number;
  size?: PdfPageSize;
}

/** Insert another PDF's pages after a displayed position. The browser only
    holds an asset id; the provider resolves it through `PdfAssetProvider` and
    the host owns the decoding. */
export interface PdfInsertPdfPagesInput {
  afterPageIndex: number;
  assetId: string;
  /** Source page indices (0-based, in order); absent = every page. */
  pages?: readonly number[];
}

/** Extract pages into a NEW document. `pages` are zero-based positions in the
    saved output — the engine's producer reads the output, not the opened file,
    so a displayed position is already the right index. */
export interface PdfExtractPagesInput {
  pages: readonly number[];
  name?: string;
}

/** Append other PDFs' pages to the current document, producing a NEW document. */
export interface PdfMergePdfsInput {
  assetIds: readonly string[];
  name?: string;
}

/** Split the saved output into consecutive chunks, each a NEW document. */
export interface PdfSplitPdfInput {
  chunkSize: number;
  name?: string;
}

/** A document produced by extract / merge / split. F2: the host commits it
    through Documents; the panel never downloads or writes it itself. */
export interface PdfNewDocument {
  op: "extractPages" | "mergePdfs" | "splitPdf";
  /** Suggested filename stem, extension excluded. */
  name: string;
  pageCount: number;
  /** 1-based part ordinal for split output; absent for single-document ops. */
  part?: number;
  bytes: Uint8Array;
}

/** One batch per user action; every entry is a serialisable engine envelope. */
export type PdfPageOpsEngineOperation =
  | { op: "insertBlankPage"; attributes: { afterPageIndex: number; width?: number; height?: number } }
  | { op: "insertPdfPages"; attributes: { afterPageIndex: number; pdf: string; pages?: number[] } }
  | { op: "extractPages"; attributes: { pages: number[]; name?: string } }
  | { op: "mergePdfs"; attributes: { pdfs: string[]; name?: string } }
  | { op: "splitPdf"; attributes: { chunkSize: number; name?: string } };

/** One produced document exactly as the engine returns it (office-engine's
    PdfEditOutcome.documents): base64-encoded so it crosses the worker / IPC
    boundary unchanged. A host forwards the engine's array verbatim; the
    provider decodes it, so the two shapes cannot drift. */
export interface PdfPageOpsDocumentPayload {
  op: "extractPages" | "mergePdfs" | "splitPdf";
  name: string;
  pageCount: number;
  /** 1-based part ordinal for split output; absent for single-document ops. */
  part?: number;
  dataBase64: string;
}

/** What the host answers after applying a page-op batch: the engine's produced
    documents and any honest per-op skip warnings. */
export interface PdfPageOpsResult {
  documents: readonly PdfPageOpsDocumentPayload[];
  warnings: readonly string[];
}

/** Host seam. The provider hands one batch to the host, which parses, applies
    and returns the documents the batch produced plus its skip warnings. */
export interface PdfPageOpsOperationSubmitter {
  submit(operations: readonly PdfPageOpsEngineOperation[]): Promise<PdfPageOpsResult>;
}

export interface PdfPageOpsOperationProvider {
  insertBlankPage(input: PdfBlankPageInsertInput): Promise<PdfPageOpsResult>;
  insertPdfPages(input: PdfInsertPdfPagesInput): Promise<PdfPageOpsResult>;
  extractPages(input: PdfExtractPagesInput): Promise<PdfPageOpsResult>;
  mergePdfs(input: PdfMergePdfsInput): Promise<PdfPageOpsResult>;
  splitPdf(input: PdfSplitPdfInput): Promise<PdfPageOpsResult>;
}

export type PdfPageOpsProviderOptions = Pick<PdfOpsBridgeOptions, "assets" | "pageOrder"> & {
  /** F2 commit seam: when wired, every produced document goes through a
      Documents commit here before it is returned to the caller. */
  commit?: (document: PdfNewDocument) => Promise<void> | void;
};

/** One selectable PDF asset the host exposes for insert / merge. The panel
    never sees bytes; it passes the id to the provider, which resolves it. */
export interface PdfPageOpsAssetOption {
  id: string;
  label: string;
}

export interface PdfPageOpsPanelProps {
  /** 1-based displayed page numbers, in display order (same shape as the page rail). */
  pages: readonly number[];
  provider: PdfPageOpsOperationProvider;
  /** PDFs the host offers for "insert pages" and "merge" (from its asset library). */
  assetOptions?: readonly PdfPageOpsAssetOption[];
  /** Zero-based displayed positions pre-selected for extraction. */
  selectedPages?: readonly number[];
  disabled?: boolean;
  className?: string;
  /** Every produced document (already committed through the F2 seam). */
  onDocuments?: (documents: readonly PdfNewDocument[], warnings: readonly string[]) => void;
  /** Fired after a batch that changed the working document (inserts). */
  onApplied?: () => void;
}

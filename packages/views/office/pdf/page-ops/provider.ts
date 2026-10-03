import type {
  PdfBlankPageInsertInput,
  PdfExtractPagesInput,
  PdfInsertPdfPagesInput,
  PdfMergePdfsInput,
  PdfNewDocument,
  PdfPageOpsEngineOperation,
  PdfPageOpsOperationProvider,
  PdfPageOpsDocumentPayload,
  PdfPageOpsOperationSubmitter,
  PdfPageOpsProviderOptions,
  PdfPageOpsResult,
  PdfSplitPdfInput,
} from "./types";

export class PdfPageOpsProviderError extends Error {
  readonly code: "invalid_input" | "asset_provider_missing" | "asset_unavailable" | "commit_failed";
  readonly operation: string;

  constructor(code: PdfPageOpsProviderError["code"], operation: string, message: string) {
    super(message);
    this.name = "PdfPageOpsProviderError";
    this.code = code;
    this.operation = operation;
  }
}

/** Raw-byte bound mirroring the engine's base64 cap (`capPdfB64` in
    office-engine): 64 MiB of base64 is exactly 48 MiB of raw bytes. */
export const MAX_PDF_SOURCE_BYTES = 48 * 1024 * 1024;

function integer(value: number, name: string, operation: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new PdfPageOpsProviderError("invalid_input", operation, `${name} must be a whole number ≥ ${minimum}`);
  }
  return value;
}

/** Zero-based displayed position → the original engine index. Unlike the
    document producers, inserts address the opened document, so a non-identity
    display order must map back or the wrong anchor is used. */
function displayedIndex(displayed: number, order: readonly number[] | undefined, operation: string): number {
  const index = integer(displayed, "afterPageIndex", operation, 0);
  const mapped = order ? order[index] : index;
  if (mapped === undefined) throw new PdfPageOpsProviderError("invalid_input", operation, "afterPageIndex is outside the current page order");
  return mapped;
}

function afterPageIndex(value: number, order: readonly number[] | undefined, operation: string): number {
  // -1 keeps upstream's "front of the document" convention and bypasses the
  // display-order map: there is no page to look up.
  return value === -1 ? -1 : displayedIndex(value, order, operation);
}

function name(value: string | undefined, operation: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") throw new PdfPageOpsProviderError("invalid_input", operation, "name must not be blank");
  return trimmed;
}

function pageList(pages: readonly number[], operation: string): number[] {
  if (pages.length === 0) throw new PdfPageOpsProviderError("invalid_input", operation, "at least one page is required");
  return pages.map((page) => integer(page, "pages[]", operation, 0));
}

async function assetBytes(assetId: string, options: PdfPageOpsProviderOptions, operation: string): Promise<Uint8Array> {
  if (typeof assetId !== "string" || assetId.trim() === "") throw new PdfPageOpsProviderError("invalid_input", operation, "assetId must be a non-empty string");
  if (!options.assets) throw new PdfPageOpsProviderError("asset_provider_missing", operation, "asset provider is required");
  let bytes: Uint8Array;
  try {
    bytes = await options.assets.read(assetId);
  } catch {
    throw new PdfPageOpsProviderError("asset_unavailable", operation, "asset could not be read");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new PdfPageOpsProviderError("asset_unavailable", operation, "asset has no PDF bytes");
  if (bytes.length > MAX_PDF_SOURCE_BYTES) throw new PdfPageOpsProviderError("invalid_input", operation, "asset exceeds the engine PDF size cap");
  return bytes;
}

function base64(bytes: Uint8Array, operation: string): string {
  if (typeof globalThis.btoa !== "function") throw new PdfPageOpsProviderError("asset_unavailable", operation, "base64 encoder is unavailable");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary);
}

/** Decode the engine's base64 document payload into typed documents. Exported
    so a host adapter can reuse the exact decode the provider relies on. */
export function decodePdfPageOpsDocuments(payload: readonly PdfPageOpsDocumentPayload[]): PdfNewDocument[] {
  if (typeof globalThis.atob !== "function") throw new PdfPageOpsProviderError("asset_unavailable", "documents", "base64 decoder is unavailable");
  return payload.map((entry) => {
    const binary = globalThis.atob(entry.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {
      op: entry.op,
      name: entry.name,
      pageCount: entry.pageCount,
      ...(entry.part === undefined ? {} : { part: entry.part }),
      bytes,
    };
  });
}

/** Commit every produced document through the F2 seam before returning it. A
    missing seam is allowed for hosts that commit elsewhere, but a seam that
    fails refuses the whole batch so no document is handed out uncommitted. */
async function commitDocuments(
  documents: readonly PdfNewDocument[],
  options: PdfPageOpsProviderOptions,
): Promise<void> {
  if (!options.commit) return;
  for (const document of documents) {
    try {
      await options.commit(document);
    } catch (error) {
      throw new PdfPageOpsProviderError("commit_failed", document.op, error instanceof Error ? error.message : "document commit failed");
    }
  }
}

/** Browser-safe page-op provider. It only emits serialisable envelopes and
    resolves asset ids through the host's `PdfAssetProvider`; decoding and PDF
    mutation stay in the Node engine. Documents come back from the host, are
    committed through the F2 seam, and are returned for the panel to report. */
export function createPdfPageOpsProvider(options: PdfPageOpsProviderOptions, submitter: PdfPageOpsOperationSubmitter): PdfPageOpsOperationProvider {
  const apply = async (operation: PdfPageOpsEngineOperation): Promise<PdfPageOpsResult> => {
    const result = await submitter.submit([operation]);
    const documents = decodePdfPageOpsDocuments(result.documents);
    await commitDocuments(documents, options);
    return { documents, warnings: result.warnings };
  };

  return {
    async insertBlankPage(input: PdfBlankPageInsertInput) {
      const size = input.size;
      if (size && (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)) {
        throw new PdfPageOpsProviderError("invalid_input", "insertBlankPage", "size must have positive width and height");
      }
      const operation: PdfPageOpsEngineOperation = {
        op: "insertBlankPage",
        attributes: {
          afterPageIndex: afterPageIndex(input.afterPageIndex, options.pageOrder, "insertBlankPage"),
          ...(size ? { width: size.width, height: size.height } : {}),
        },
      };
      const result = await apply(operation);
      return { documents: result.documents, warnings: result.warnings };
    },

    async insertPdfPages(input: PdfInsertPdfPagesInput) {
      const bytes = await assetBytes(input.assetId, options, "insertPdfPages");
      const operation: PdfPageOpsEngineOperation = {
        op: "insertPdfPages",
        attributes: {
          afterPageIndex: afterPageIndex(input.afterPageIndex, options.pageOrder, "insertPdfPages"),
          pdf: base64(bytes, "insertPdfPages"),
          ...(input.pages ? { pages: pageList(input.pages, "insertPdfPages") } : {}),
        },
      };
      const result = await apply(operation);
      return { documents: result.documents, warnings: result.warnings };
    },

    async extractPages(input: PdfExtractPagesInput) {
      // The engine's producer reads the saved output, so a zero-based
      // displayed position already addresses the right page; no pageOrder map.
      const trimmed = name(input.name, "extractPages");
      const operation: PdfPageOpsEngineOperation = {
        op: "extractPages",
        attributes: { pages: pageList(input.pages, "extractPages"), ...(trimmed ? { name: trimmed } : {}) },
      };
      const result = await apply(operation);
      return { documents: result.documents, warnings: result.warnings };
    },

    async mergePdfs(input: PdfMergePdfsInput) {
      if (input.assetIds.length === 0) throw new PdfPageOpsProviderError("invalid_input", "mergePdfs", "at least one assetId is required");
      const pdfs: string[] = [];
      for (const assetId of input.assetIds) pdfs.push(base64(await assetBytes(assetId, options, "mergePdfs"), "mergePdfs"));
      const trimmed = name(input.name, "mergePdfs");
      const operation: PdfPageOpsEngineOperation = {
        op: "mergePdfs",
        attributes: { pdfs, ...(trimmed ? { name: trimmed } : {}) },
      };
      const result = await apply(operation);
      return { documents: result.documents, warnings: result.warnings };
    },

    async splitPdf(input: PdfSplitPdfInput) {
      const chunkSize = integer(input.chunkSize, "chunkSize", "splitPdf", 1);
      const trimmed = name(input.name, "splitPdf");
      const operation: PdfPageOpsEngineOperation = {
        op: "splitPdf",
        attributes: { chunkSize, ...(trimmed ? { name: trimmed } : {}) },
      };
      const result = await apply(operation);
      return { documents: result.documents, warnings: result.warnings };
    },
  };
}

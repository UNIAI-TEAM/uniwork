import { describe, expect, it, vi } from "vitest";
import { createPdfPageOpsProvider, decodePdfPageOpsDocuments, MAX_PDF_SOURCE_BYTES, PdfPageOpsProviderError } from "./provider";
import type { PdfNewDocument, PdfPageOpsDocumentPayload, PdfPageOpsOperationSubmitter, PdfPageOpsResult } from "./types";

const empty: PdfPageOpsResult = { documents: [], warnings: [] };
/** Base64 of Uint8Array([9]) — what the engine returns for a produced document. */
const b64 = (value: string) => Buffer.from(value, "binary").toString("base64");

function submitter(result: PdfPageOpsResult = empty): PdfPageOpsOperationSubmitter & { submit: ReturnType<typeof vi.fn> } {
  return { submit: vi.fn(async () => result) };
}

describe("PDF page-ops provider — insert", () => {
  it("maps a displayed anchor through pageOrder and passes an explicit size", async () => {
    const submit = submitter();
    const provider = createPdfPageOpsProvider({ pageOrder: [2, 0, 1] }, submit);

    await provider.insertBlankPage({ afterPageIndex: 1, size: { width: 200, height: 300 } });
    expect(submit.submit).toHaveBeenCalledWith([
      { op: "insertBlankPage", attributes: { afterPageIndex: 0, width: 200, height: 300 } },
    ]);
  });

  it("keeps -1 as front and rejects an anchor outside the order or a bad size", async () => {
    const submit = submitter();
    const provider = createPdfPageOpsProvider({ pageOrder: [2, 0, 1] }, submit);

    await provider.insertBlankPage({ afterPageIndex: -1 });
    expect(submit.submit).toHaveBeenLastCalledWith([{ op: "insertBlankPage", attributes: { afterPageIndex: -1 } }]);

    await expect(provider.insertBlankPage({ afterPageIndex: 3 })).rejects.toThrow("outside the current page order");
    await expect(provider.insertBlankPage({ afterPageIndex: 0, size: { width: 0, height: 10 } })).rejects.toThrow("positive width and height");
    expect(submit.submit).toHaveBeenCalledTimes(1);
  });

  it("resolves an insert asset through the PdfAssetProvider seam", async () => {
    const submit = submitter();
    const read = vi.fn(async () => Uint8Array.from([0, 1, 255]));
    const provider = createPdfPageOpsProvider({ assets: { read } }, submit);

    await provider.insertPdfPages({ afterPageIndex: 0, assetId: "asset-1", pages: [0, 2] });
    expect(read).toHaveBeenCalledWith("asset-1");
    expect(submit.submit).toHaveBeenCalledWith([
      { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "AAH/", pages: [0, 2] } },
    ]);
  });

  it("refuses a missing provider, an unreadable asset and an oversized asset", async () => {
    await expect(createPdfPageOpsProvider({}, submitter()).insertPdfPages({ afterPageIndex: 0, assetId: "a" })).rejects.toMatchObject({ code: "asset_provider_missing" });

    const failing = createPdfPageOpsProvider({ assets: { read: async () => { throw new Error("nope"); } } }, submitter());
    await expect(failing.insertPdfPages({ afterPageIndex: 0, assetId: "a" })).rejects.toMatchObject({ code: "asset_unavailable" });

    const huge = new Uint8Array(MAX_PDF_SOURCE_BYTES + 1);
    const provider = createPdfPageOpsProvider({ assets: { read: async () => huge } }, submitter());
    await expect(provider.insertPdfPages({ afterPageIndex: 0, assetId: "a" })).rejects.toThrow("size cap");
  });
});

describe("PDF page-ops provider — documents", () => {
  it("extracts zero-based displayed positions without a pageOrder map", async () => {
    const submit = submitter();
    const provider = createPdfPageOpsProvider({ pageOrder: [2, 0, 1] }, submit);
    await provider.extractPages({ pages: [0, 2], name: "  trich-xuat  " });
    expect(submit.submit).toHaveBeenCalledWith([{ op: "extractPages", attributes: { pages: [0, 2], name: "trich-xuat" } }]);
  });

  it("merges several assets in order and rejects an empty set", async () => {
    const submit = submitter();
    const read = vi.fn(async (id: string) => Uint8Array.from([id === "a" ? 1 : 2]));
    const provider = createPdfPageOpsProvider({ assets: { read } }, submit);

    await provider.mergePdfs({ assetIds: ["a", "b"] });
    expect(submit.submit).toHaveBeenCalledWith([{ op: "mergePdfs", attributes: { pdfs: ["AQ==", "Ag=="] } }]);
    await expect(provider.mergePdfs({ assetIds: [] })).rejects.toThrow("at least one assetId");
  });

  it("validates the split chunk size before submit", async () => {
    const submit = submitter();
    const provider = createPdfPageOpsProvider({}, submit);
    await provider.splitPdf({ chunkSize: 2 });
    expect(submit.submit).toHaveBeenCalledWith([{ op: "splitPdf", attributes: { chunkSize: 2 } }]);
    await expect(provider.splitPdf({ chunkSize: 0 })).rejects.toThrow("chunkSize");
    await expect(provider.splitPdf({ chunkSize: 1.5 })).rejects.toThrow("chunkSize");
  });

  it("decodes the engine's base64 payload into typed documents and returns warnings", async () => {
    const payload: PdfPageOpsDocumentPayload[] = [{ op: "splitPdf", name: "tach-1", pageCount: 1, part: 1, dataBase64: b64("\t") }];
    const submit = submitter({ documents: payload, warnings: ["splitPdf #1: nothing"] });
    const provider = createPdfPageOpsProvider({}, submit);

    const result = await provider.splitPdf({ chunkSize: 1 });
    expect(result.warnings).toEqual(["splitPdf #1: nothing"]);
    expect(result.documents).toEqual([{ op: "splitPdf", name: "tach-1", pageCount: 1, part: 1, bytes: Uint8Array.from([9]) }]);
  });

  it("decodes a payload through the exported host helper", () => {
    const decoded: PdfNewDocument[] = decodePdfPageOpsDocuments([{ op: "mergePdfs", name: "gop", pageCount: 4, dataBase64: b64("\u0001\u0002") }]);
    expect(decoded).toEqual([{ op: "mergePdfs", name: "gop", pageCount: 4, bytes: Uint8Array.from([1, 2]) }]);
  });

  it("commits every produced document through the F2 seam", async () => {
    const payload: PdfPageOpsDocumentPayload[] = [
      { op: "splitPdf", name: "tach-1", pageCount: 1, part: 1, dataBase64: b64("\u0001") },
      { op: "splitPdf", name: "tach-2", pageCount: 1, part: 2, dataBase64: b64("\u0002") },
    ];
    const commit = vi.fn(async () => undefined);
    const provider = createPdfPageOpsProvider({ commit }, submitter({ documents: payload, warnings: [] }));

    await provider.splitPdf({ chunkSize: 1 });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ name: "tach-1", bytes: Uint8Array.from([1]) }));
  });

  it("refuses the batch when the commit seam fails", async () => {
    const payload: PdfPageOpsDocumentPayload[] = [{ op: "extractPages", name: "pages", pageCount: 1, dataBase64: b64("\u0001") }];
    const provider = createPdfPageOpsProvider({ commit: async () => { throw new Error("offline"); } }, submitter({ documents: payload, warnings: [] }));
    const error = await provider.extractPages({ pages: [0] }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PdfPageOpsProviderError);
    expect((error as PdfPageOpsProviderError).code).toBe("commit_failed");
  });
});

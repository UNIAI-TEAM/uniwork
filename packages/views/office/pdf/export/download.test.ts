import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPdfBytes, downloadPdfPageFile, pdfCopyFileName, pdfPageFileName, safePdfFileStem } from "./download";

interface CapturedClick {
  href: string | null;
  download: string;
}

function captureClicks(): CapturedClick[] {
  const clicks: CapturedClick[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute("href"), download: this.download });
  });
  return clicks;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe("pdf filenames", () => {
  it("stems a page filename and falls back to a neutral name", () => {
    expect(pdfPageFileName("report", 3)).toBe("report-page-3.png");
    expect(pdfPageFileName(undefined, 1)).toBe("document-page-1.png");
  });

  it("strips path characters and keeps a usable copy filename", () => {
    expect(pdfCopyFileName("Báo cáo/2026")).toBe("Báo cáo-2026.pdf");
    expect(pdfCopyFileName("///")).toBe("document.pdf");
    expect(safePdfFileStem("  ...  ")).toBe("document");
  });
});

describe("browser downloads", () => {
  it("hands a rendered page to the browser and removes the anchor", () => {
    const clicks = captureClicks();

    downloadPdfPageFile({ pageNumber: 2, filename: "report-page-2.png", result: { src: "data:image/png;base64,abc", width: 10, height: 20 } });

    expect(clicks).toEqual([{ href: "data:image/png;base64,abc", download: "report-page-2.png" }]);
    expect(document.querySelector("a")).toBeNull();
  });

  it("downloads PDF bytes through an object URL and revokes it", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:pdf-copy");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks = captureClicks();

    downloadPdfBytes(Uint8Array.from([1, 2, 3]), "copy.pdf");

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toBe("application/pdf");
    expect(blob?.size).toBe(3);
    expect(clicks).toEqual([{ href: "blob:pdf-copy", download: "copy.pdf" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf-copy");
  });
});

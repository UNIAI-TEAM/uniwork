import { describe, expect, it, vi } from "vitest";
import type { OfficePrintPort } from "../../print";
import type { PdfCanvasPage } from "../canvas";
import { printPdfDocument } from "./print-document";

const pages: PdfCanvasPage[] = [
  { pageNumber: 1, width: 595, height: 842, rotation: 0 },
  { pageNumber: 2, width: 842, height: 595, rotation: 0 },
];
const renderer = { renderPage: vi.fn(async () => ({ src: "data:image/png;base64,AAAA", width: 1, height: 1 })) };

describe("printPdfDocument", () => {
  it("hands the port a copy of every page, titled with the document", async () => {
    const print = vi.fn<OfficePrintPort["print"]>(() => ({ outcome: "printed" }));
    const outcome = await printPdfDocument({ port: { print }, renderer, pages, title: "Hợp đồng.pdf" });

    expect(outcome).toEqual({ outcome: "printed" });
    const request = print.mock.calls[0]?.[0];
    expect(request?.title).toBe("Hợp đồng.pdf");
    const doc = new DOMParser().parseFromString(request?.html ?? "", "text/html");
    expect(doc.querySelectorAll(".pdf-print-page")).toHaveLength(2);
  });

  it("passes a cancelled dialog and a busy host through unchanged", async () => {
    await expect(printPdfDocument({ port: { print: () => ({ outcome: "cancelled" }) }, renderer, pages, title: "x" })).resolves.toEqual({ outcome: "cancelled" });
    await expect(printPdfDocument({ port: { print: async () => ({ outcome: "failed", reason: "print_busy" }) }, renderer, pages, title: "x" }))
      .resolves.toEqual({ outcome: "failed", reason: "print_busy" });
  });

  it("never reaches the port when a page fails to render", async () => {
    const print = vi.fn();
    const broken = { renderPage: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(printPdfDocument({ port: { print }, renderer: broken, pages, title: "x" })).resolves.toEqual({ outcome: "failed", reason: "render_failed" });
    expect(print).not.toHaveBeenCalled();
  });

  it("turns a throwing port into a typed failure", async () => {
    const port: OfficePrintPort = { print: () => { throw new Error("print_blocked"); } };
    await expect(printPdfDocument({ port, renderer, pages, title: "x" })).resolves.toEqual({ outcome: "failed", reason: "print_blocked" });
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DesktopPrintGeometry } from "../../../shared/ipc";
import { createDesktopPrintPort } from "../text-print";
import { loadPreviewDocument } from "./preview-source";
import type { PrintPreviewBridge, PrintPreviewChoice } from "./types";

// UNI-964 T4: an XLSX copy carries its charts, pictures and shapes as a
// positioned `.vis` layer of `<img class="pic">` (print-visuals.ts) laid over
// each page's table. The dialog re-stamps the title and re-sizes the sheet; none
// of that may drop or move the layer, in the preview or in the saved PDF.
const CHART = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2010%2010%22%3E%3Crect%20fill%3D%22%23123456%22%20width%3D%225%22%20height%3D%225%22%2F%3E%3C%2Fsvg%3E";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const A4: DesktopPrintGeometry = { landscape: false, pageSize: { width: 210_000, height: 297_000 } };
const LANDSCAPE: DesktopPrintGeometry = { landscape: true, pageSize: A4.pageSize };

const LAYER_PAGE_1 = `<div class="vis" style="left:21pt;top:15pt;width:300pt;height:200pt"><img class="pic" alt="Doanh thu theo quý" src="${CHART}" style="left:10.5pt;top:30pt;width:180pt;height:120pt"><img class="pic" alt="Logo" src="${PNG}" style="left:200pt;top:0pt;width:40pt;height:40pt"></div>`;
const LAYER_PAGE_2 = `<div class="vis" style="left:21pt;top:15pt;width:300pt;height:200pt"><div class="pic frame" style="left:0pt;top:0pt;width:90pt;height:60pt"><span>Shape</span></div></div>`;
const COPY = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="img-src data:; style-src 'unsafe-inline'"><title>Sheet</title>` +
  `<style>@page{size:8.27in 11.69in;margin:0.75in}.sheet{position:relative}.vis{position:absolute;overflow:hidden}.pic{position:absolute}</style></head>` +
  `<body><section class="page"><div class="sheet"><table><tbody><tr><td>A1</td></tr></tbody></table>${LAYER_PAGE_1}</div></section>` +
  `<section class="page"><div class="sheet"><table><tbody><tr><td>A40</td></tr></tbody></table>${LAYER_PAGE_2}</div></section></body></html>`;

/** The visuals layer of every page, in order, as the browser sees the copy. */
function layers(html: string): string[] {
  return Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll(".vis"), (layer) => layer.outerHTML);
}

describe("XLSX visuals through the in-app print dialog", () => {
  const original = layers(COPY);

  it("is a copy with one layer per page to begin with", () => {
    expect(original).toHaveLength(2);
    expect(original[0]).toContain(CHART);
  });

  it("reaches the dialog and the preview PDF request unchanged, also on a turned sheet", async () => {
    const previewed: string[] = [];
    const bridge: PrintPreviewBridge = {
      call: vi.fn(async (_channel, payload) => {
        if ("html" in payload) previewed.push(payload.html as string);
        return { outcome: "failed", reason: "print_unavailable" };
      }),
    };
    let jobHtml = "";
    const port = createDesktopPrintPort({ call: async () => ({ outcome: "printed" }) }, {
      preview: async (job) => {
        jobHtml = job.html;
        await loadPreviewDocument(bridge, job, job.geometry);
        await loadPreviewDocument(bridge, job, LANDSCAPE);
        return { kind: "cancel" } satisfies PrintPreviewChoice;
      },
    });
    expect(await port.print({ html: COPY, title: "Báo cáo.xlsx", page: { widthMm: 210, heightMm: 297, landscape: false } })).toEqual({ outcome: "cancelled" });
    expect(layers(jobHtml)).toEqual(original);
    expect(previewed).toHaveLength(2);
    for (const html of previewed) expect(layers(html)).toEqual(original);
    expect(previewed[1]).toContain("<style data-print-sheet>@page{size:297mm 210mm}");
  });

  it("reaches Save as PDF unchanged on the chosen sheet", async () => {
    const sent: Array<{ channel: string; html: string }> = [];
    const port = createDesktopPrintPort({
      call: async (channel, payload) => {
        sent.push({ channel, html: (payload as { html: string }).html });
        return { outcome: "saved" };
      },
    }, { preview: async () => ({ kind: "save-pdf", options: LANDSCAPE } as PrintPreviewChoice) });
    await port.print({ html: COPY, title: "Báo cáo.xlsx", page: { widthMm: 210, heightMm: 297, landscape: false } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe("desktop:print-save-pdf");
    expect(layers(sent[0]!.html)).toEqual(original);
  });
});

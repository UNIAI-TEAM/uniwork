// UNI-952 D3: charts, pictures and shapes from the visuals layer's
// getPrintableVisuals, measured in print's own sizes and placed on every page
// body they overlap.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { buildXlsxPrintCopy, type XlsxPrintSheet } from "./print-copy";
import { resolvePrintSetup, type XlsxPrintDefinedName, type XlsxPrintRange } from "./print-setup";
import { collectPrintPictures, type XlsxPrintableVisuals, type XlsxPrintPicture } from "./print-visuals";

const PLAIN: XlsxRenderStyle = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const ANCHOR = { fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: 1, toColumn: 1, toRowOffset: 0, toColumnOffset: 0 };

type Listed = ReturnType<XlsxPrintableVisuals>[number];
const visual = (overrides: Partial<Listed>): Listed => ({ sheetId: "sheet-1", zIndex: 0, anchor: ANCHOR, box: null, image: null, title: "Chart", ...overrides });

describe("collectPrintPictures", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hands print's sizes to the visuals layer and turns its boxes into points, back to front", () => {
    const source = vi.fn<XlsxPrintableVisuals>((_sheetId, metricsFor) => {
      const metrics = metricsFor?.("sheet-1");
      // 48pt columns and 15pt rows are 64px and 20px at 100%; hidden = 0.
      expect([metrics?.columnWidth(0), metrics?.columnWidth(1), metrics?.rowHeight(0)]).toEqual([64, 0, 20]);
      expect(metricsFor?.("other")).toBeNull();
      return [
        visual({ zIndex: 2, box: { x: 64, y: 20, width: 128, height: 40 }, image: { type: "dataUrl", dataUrl: PNG }, title: "Front" }),
        visual({ zIndex: 1, box: { x: 0, y: 0, width: 8, height: 8 }, image: { type: "dataUrl", dataUrl: "https://example.com/x.png" }, title: "Back" }),
        visual({ sheetId: "sheet-2", box: { x: 0, y: 0, width: 8, height: 8 } }),
      ];
    });
    const pictures = collectPrintPictures({
      source,
      sheetIds: ["sheet-1"],
      columnWidth: (column) => (column === 1 ? 0 : 48),
      rowHeight: () => 15,
    });
    expect(source).toHaveBeenCalledWith("sheet-1", expect.any(Function));
    expect(pictures).toEqual([
      { x: 0, y: 0, width: 6, height: 6, zIndex: 1, src: null, title: "Back" },
      { x: 48, y: 15, width: 96, height: 30, zIndex: 2, src: PNG, title: "Front" },
    ]);
  });

  it("places a visual without a box by its anchor and EMU offsets in print's sizes", () => {
    const anchor = { fromRow: 1, fromColumn: 1, fromRowOffset: 9525 * 4, fromColumnOffset: 9525 * 8, toRow: 3, toColumn: 2, toRowOffset: 0, toColumnOffset: 0 };
    const [picture] = collectPrintPictures({ source: () => [visual({ anchor })], sheetIds: ["sheet-1"], columnWidth: () => 48, rowHeight: () => 15 });
    // x = 48 + 8px (6pt); right = 96 -> width 42; y = 15 + 4px (3pt); bottom = 45 -> height 27.
    expect(picture).toMatchObject({ x: 54, y: 18, width: 42, height: 27, src: null });
  });

  it("makes an overlay SVG self-contained: token classes and currentColor resolved, scripts and handlers dropped", () => {
    const style = document.createElement("style");
    style.textContent = ".tok-bar{fill:#123456}.tok-text{color:#654321}";
    document.head.appendChild(style);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect class="tok-bar" width="5" height="5" onload="alert(2)"/><text class="tok-text" fill="currentColor">Hi</text><image href="https://example.com/x.png"/></svg>`;
    const [picture] = collectPrintPictures({ source: () => [visual({ box: { x: 0, y: 0, width: 10, height: 10 }, image: { type: "svg", svg } })], sheetIds: ["sheet-1"], columnWidth: () => 48, rowHeight: () => 15 });
    expect(picture!.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const markup = decodeURIComponent(picture!.src!.slice("data:image/svg+xml;charset=utf-8,".length));
    expect(markup).not.toMatch(/<script|onload|class=|https:/);
    expect(markup).toMatch(/<rect[^>]*style="[^"]*fill:\s*(#123456|rgb\(18, 52, 86\))/);
    expect(markup).not.toMatch(/currentColor/i);
    expect(document.body.children).toHaveLength(0);
  });

  it("keeps gradient defs, url(#id) paints and authored inline styles in the data: SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><rect fill="url(#g)" clip-path="url(#c)" width="10" height="10" style="display:none;fill:url(https://example.com/x.svg#e)"/><rect fill="url(#g)" width="4" height="4" style="transform:rotate(5deg)"/></svg>`;
    // Chromium returns paint-server references as absolute urls; jsdom has no
    // presentation-attribute cascade, so the computed values are supplied.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      const computed = real(element);
      return new Proxy(computed, {
        get: (target, key) => key === "getPropertyValue"
          ? (property: string) => (property === "fill" && element.getAttribute("fill")?.startsWith("url(") ? 'url("http://localhost:3000/office#g")' : target.getPropertyValue(property))
          : Reflect.get(target, key) as unknown,
      });
    });
    const [picture] = collectPrintPictures({ source: () => [visual({ box: { x: 0, y: 0, width: 10, height: 10 }, image: { type: "svg", svg } })], sheetIds: ["sheet-1"], columnWidth: () => 48, rowHeight: () => 15 });
    const markup = decodeURIComponent(picture!.src!.slice("data:image/svg+xml;charset=utf-8,".length));
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect(doc.querySelector("linearGradient#g stop")).not.toBeNull();
    expect(doc.querySelector("clipPath#c rect")).not.toBeNull();
    const [hidden, tilted] = Array.from(doc.querySelectorAll("svg > rect"));
    expect(hidden!.getAttribute("clip-path")).toBe("url(#c)");
    expect(hidden!.getAttribute("style")).toContain("display:none");
    expect(hidden!.getAttribute("style")).toContain("fill:url(#g)");
    expect(tilted!.getAttribute("style")).toContain("transform:rotate(5deg)");
    expect(tilted!.getAttribute("style")).toContain("fill:url(#g)");
    expect(markup).not.toContain("localhost");
    expect(markup).not.toContain("example.com");
  });

  it("prints a frame for an SVG that does not parse", () => {
    const [picture] = collectPrintPictures({ source: () => [visual({ box: { x: 0, y: 0, width: 10, height: 10 }, image: { type: "svg", svg: "<svg><unclosed></svg>" } })], sheetIds: ["sheet-1"], columnWidth: () => 48, rowHeight: () => 15 });
    expect(picture!.src).toBeNull();
  });
});

interface Options {
  used?: XlsxPrintRange;
  names?: XlsxPrintDefinedName[];
  pictures: XlsxPrintPicture[];
  rightToLeft?: boolean;
  horizontalCentered?: boolean;
}

function build(options: Options): Document {
  const used = options.used ?? { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 };
  const setup = resolvePrintSetup({ file: { horizontalCentered: options.horizontalCentered }, definedNames: options.names, sheetIndex: 0, used });
  const sheet: XlsxPrintSheet = {
    title: "Book", setup, areas: setup.printAreas ?? [used], cells: new Map([["0:0", { text: "a", kind: "text" }]]), styles: [PLAIN],
    columns: new Map(), rows: new Map(), defaultColumnWidth: 48, defaultRowHeight: 15, merges: [],
    pictures: options.pictures, rightToLeft: options.rightToLeft,
  };
  const result = buildXlsxPrintCopy(sheet);
  if (!result.ok) throw new Error(result.reason);
  return new DOMParser().parseFromString(result.html, "text/html");
}

const picture = (overrides: Partial<XlsxPrintPicture>): XlsxPrintPicture => ({ x: 48, y: 15, width: 96, height: 30, zIndex: 0, src: PNG, title: "Chart", ...overrides });

describe("printed visuals", () => {
  it("lays visuals over the page body in paint order, a frame with the title when there is no image", () => {
    const doc = build({ pictures: [picture({}), picture({ x: 0, y: 0, width: 20, height: 10, src: null, title: "Doanh thu <Q1>", zIndex: 1 })] });
    const layer = doc.querySelector("section.page .sheet > .vis") as HTMLElement;
    expect(layer.getAttribute("style")).toBe("left:0pt;top:0pt;width:192pt;height:60pt");
    const [image, frame] = Array.from(layer.children) as HTMLElement[];
    expect(image!.tagName).toBe("IMG");
    expect(image!.getAttribute("src")).toBe(PNG);
    expect(image!.getAttribute("style")).toBe("left:48pt;top:15pt;width:96pt;height:30pt");
    expect(frame!.className).toBe("pic frame");
    expect(frame!.textContent).toBe("Doanh thu <Q1>");
    expect(doc.documentElement.outerHTML).toContain(".vis{position:absolute;overflow:hidden}");
  });

  it("prints a visual on every page it overlaps, below repeated title rows, and skips pages it misses", () => {
    const used = { startRow: 0, endRow: 119, startColumn: 0, endColumn: 1 };
    const names = [{ name: "_xlnm.Print_Titles", formula: "Data!$1:$1", sheetIndex: 0 }];
    // Rows 40-79 (600pt-1200pt) span the page break; nothing reaches the last page.
    const doc = build({ used, names, pictures: [picture({ x: 0, y: 600, width: 50, height: 600 })] });
    const pages = Array.from(doc.querySelectorAll("section.page"));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const layers = pages.map((page) => page.querySelector(".vis")?.getAttribute("style") ?? null);
    expect(layers[0]).toMatch(/^left:0pt;top:0pt;/);
    // Page 2 repeats row 1, so its body starts 15pt down.
    expect(layers[1]).toMatch(/^left:0pt;top:15pt;/);
    expect(layers[layers.length - 1]).toBeNull();
    const second = pages[1]!.querySelector(".vis img")!.getAttribute("style")!;
    expect(Number(/top:(-?[\d.]+)pt/.exec(second)![1])).toBeLessThan(0);
  });

  it("mirrors visuals from the right on a right-to-left sheet and centres the table with them (R8)", () => {
    const doc = build({ pictures: [picture({})], rightToLeft: true, horizontalCentered: true });
    expect(doc.querySelector(".vis")!.getAttribute("style")).toMatch(/^right:0pt;/);
    expect(doc.querySelector(".vis img")!.getAttribute("style")).toMatch(/^right:48pt;/);
    const html = doc.documentElement.outerHTML;
    expect(html).toContain(".sheet{margin:0 auto}");
    expect(html).not.toContain("table{margin:0 auto}");
    expect(doc.querySelector(".sheet")!.getAttribute("style")).toBe("width:192pt");
  });

  it("prints no image whose source is not a data: image", () => {
    const doc = build({ pictures: [picture({ src: "https://example.com/x.png" })] });
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector(".frame")?.textContent).toBe("Chart");
  });
});

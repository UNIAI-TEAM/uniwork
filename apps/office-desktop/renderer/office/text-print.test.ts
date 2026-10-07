/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRINT_HTML_MAX_BYTES } from "../../shared/ipc";
import { desktopPrintSavePdfRequestSchema } from "../../shared/ipc-print";
import type { PrintPreviewChoice, PrintPreviewHook } from "./print-preview/types";
import { createDesktopPrintPort, desktopPrintOptions } from "./text-print";

// Any format's copy: a view builds it (DOCX sections, XLSX sheet, PPTX slides,
// PDF pages, Markdown/HTML preview); the desktop port only stamps the title
// and hands it to main.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'none'">`;
const slideCopy = `<!DOCTYPE html><html><head>${CSP}<style>@page s1 { size: 13.333in 7.5in; margin: 0 }</style></head><body><section style="page: s1"><img src="data:image/png;base64,AAAA" alt="Slide 1"></section></body></html>`;

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

function stubBridge(answer: () => Promise<unknown>) {
  const call = vi.fn((_channel: "desktop:print-document" | "desktop:print-save-pdf", _payload: { sessionGeneration: string; title: string; html: string; options?: unknown }) => answer());
  return { call };
}

it("hands any format's copy to main over the typed print channel, never an in-window frame", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  const append = vi.spyOn(document.body, "append");
  const appPrint = vi.spyOn(window, "print").mockImplementation(() => undefined);
  expect(await createDesktopPrintPort(bridge).print({ html: slideCopy, title: "Deck.pptx" })).toEqual({ outcome: "printed" });
  expect(bridge.call).toHaveBeenCalledTimes(1);
  const [channel, payload] = bridge.call.mock.calls[0]!;
  expect(channel).toBe("desktop:print-document");
  expect(payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Deck.pptx", html: expect.any(String), options: { landscape: false, pageSize: { width: 210_000, height: 297_000 } } });
  const sent = new DOMParser().parseFromString(payload.html, "text/html");
  // Only the title differs from the view's copy; page geometry and data: images pass untouched.
  expect(sent.title).toBe("Deck.pptx");
  sent.querySelector("title")?.remove();
  expect(sent.documentElement.outerHTML).toBe(new DOMParser().parseFromString(slideCopy, "text/html").documentElement.outerHTML);
  expect(payload.html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(append).not.toHaveBeenCalled();
  expect(appPrint).not.toHaveBeenCalled();
});

it("names the copy after the document so the OS dialog is not 'Electron - Print'", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await createDesktopPrintPort(bridge).print({ html: `<html><head>${CSP}<title>Old</title></head><body><p>x</p></body></html>`, title: "Báo cáo <Q3>.docx" });
  const doc = new DOMParser().parseFromString(bridge.call.mock.calls[0]![1].html, "text/html");
  expect(doc.querySelectorAll("title")).toHaveLength(1);
  expect(doc.title).toBe("Báo cáo <Q3>.docx");
  expect(doc.querySelector("title")?.children).toHaveLength(0);
  expect(doc.head.firstElementChild?.getAttribute("http-equiv")?.toLowerCase()).toBe("content-security-policy");
});

it.each(["", "   ", "\n"])("never sends an untitled copy (%j): the job falls back to the document name, not the app name", async (blank) => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await createDesktopPrintPort(bridge).print({ html: `<html><head>${CSP}<title></title></head><body><p>x</p></body></html>`, title: blank });
  const payload = bridge.call.mock.calls[0]![1];
  expect(payload.title).toBe("document");
  expect(new DOMParser().parseFromString(payload.html, "text/html").title).toBe("document");
});

it.each([
  [{ outcome: "cancelled" }, { outcome: "cancelled" }],
  [{ outcome: "failed", reason: "print_no_printer" }, { outcome: "failed", reason: "print_no_printer" }],
  [{ outcome: "failed", reason: "print_timeout" }, { outcome: "failed", reason: "print_timeout" }],
  [{ outcome: "printed", extra: 1 }, { outcome: "failed", reason: "print_response_invalid" }],
  [{ outcome: "failed", reason: "Raw Electron Message" }, { outcome: "failed", reason: "print_response_invalid" }],
  [undefined, { outcome: "failed", reason: "print_response_invalid" }],
] as const)("maps main's answer %j to %j", async (answer, expected) => {
  expect(await createDesktopPrintPort(stubBridge(async () => answer)).print({ html: "<p>x</p>", title: "t" })).toEqual(expected);
});

it("returns a typed failure when the channel is refused", async () => {
  expect(await createDesktopPrintPort(stubBridge(async () => { throw new Error("invalid_sender"); })).print({ html: "<p>x</p>", title: "t" })).toEqual({ outcome: "failed", reason: "print_call_failed" });
});

it("refuses a copy over the print cap with a typed reason before crossing IPC", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  // Multi-byte text: the cap is UTF-8 bytes, not characters.
  const html = `<p>${"ệ".repeat(Math.ceil(PRINT_HTML_MAX_BYTES / 3) + 1)}</p>`;
  expect(html.length).toBeLessThan(PRINT_HTML_MAX_BYTES);
  expect(await createDesktopPrintPort(bridge).print({ html, title: "Big.xlsx" })).toEqual({ outcome: "failed", reason: "print_too_large" });
  expect(bridge.call).not.toHaveBeenCalled();
});

it("fails typed, not silently, without a bridge", async () => {
  expect(await createDesktopPrintPort(undefined).print({ html: "<p>x</p>", title: "t" })).toEqual({ outcome: "failed", reason: "print_unavailable" });
});

it("caps the title at the channel limit", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await createDesktopPrintPort(bridge).print({ html: "<p>x</p>", title: "a".repeat(400) });
  expect(bridge.call.mock.calls[0]![1].title).toHaveLength(255);
});

it("opens the system dialog in the document's orientation and paper, not portrait", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  // A 13.333 x 7.5 in slide as printed: the sheet goes portrait, the flag turns it.
  await createDesktopPrintPort(bridge).print({ html: slideCopy, title: "Deck.pptx", page: { widthMm: 338.658, heightMm: 190.5, landscape: true } });
  expect(bridge.call.mock.calls[0]![1].options).toEqual({ landscape: true, pageSize: { width: 190_500, height: 338_658 } });
});

it.each([
  ["the copy's own @page when the request has no page (an HTML file)", "@page { size: A4 landscape; margin: 1cm }", { landscape: true, pageSize: { width: 210_000, height: 297_000 } }],
  ["Markdown's A4 default", "@page{size:A4;margin:18mm}", { landscape: false, pageSize: { width: 210_000, height: 297_000 } }],
  ["A4 portrait for a copy without @page", "p{margin:0}", { landscape: false, pageSize: { width: 210_000, height: 297_000 } }],
])("prints %s", async (_label, css, expected) => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await createDesktopPrintPort(bridge).print({ html: `<!DOCTYPE html><html><head>${CSP}<style>${css}</style></head><body><p>x</p></body></html>`, title: "Notes.md" });
  expect(bridge.call.mock.calls[0]![1].options).toEqual(expected);
});

it.each([
  ["A4 portrait when the view gave no page", undefined, { landscape: false, pageSize: { width: 210_000, height: 297_000 } }],
  ["Letter landscape", { widthMm: 279.4, heightMm: 215.9, landscape: true }, { landscape: true, pageSize: { width: 215_900, height: 279_400 } }],
  ["A3 portrait", { widthMm: 297, heightMm: 420, landscape: false }, { landscape: false, pageSize: { width: 297_000, height: 420_000 } }],
  ["a size that is not a number (A4 portrait)", { widthMm: Number.NaN, heightMm: 297, landscape: true }, { landscape: false, pageSize: { width: 210_000, height: 297_000 } }],
  ["a tiny label clamped to the 10 mm floor", { widthMm: 5, heightMm: 8, landscape: false }, { landscape: false, pageSize: { width: 10_000, height: 10_000 } }],
  ["a banner clamped to the 2 m ceiling", { widthMm: 3000, heightMm: 500, landscape: true }, { landscape: true, pageSize: { width: 500_000, height: 2_000_000 } }],
] as const)("maps %s", (_label, page, expected) => {
  expect(desktopPrintOptions(page)).toEqual(expected);
});

describe("the in-app print preview (UNI-961)", () => {
  const request = { html: `<!DOCTYPE html><html><head>${CSP}</head><body><p>x</p></body></html>`, title: "Deck.pptx", page: { widthMm: 338.658, heightMm: 190.5, landscape: true } };
  const geometry = { landscape: true, pageSize: { width: 190_500, height: 338_658 } };
  const answering = (choice: PrintPreviewChoice) => vi.fn<PrintPreviewHook>(async () => choice);

  it("hands the preview the stamped copy and the document geometry, before anything is sent", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    const preview = answering({ kind: "cancel" });
    await createDesktopPrintPort(bridge, { preview }).print(request);
    expect(preview).toHaveBeenCalledTimes(1);
    const job = preview.mock.calls[0]![0];
    expect(job.title).toBe("Deck.pptx");
    expect(job.geometry).toEqual(geometry);
    expect(new DOMParser().parseFromString(job.html, "text/html").title).toBe("Deck.pptx");
    expect(job.html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("sends the copy silently with the dialog's options, verbatim, when the user prints", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    const options = { ...geometry, silent: true as const, deviceName: "HP LaserJet", copies: 2, pageRanges: [{ from: 0, to: 1 }], color: false, duplexMode: "longEdge" as const };
    const preview = answering({ kind: "print", options });
    expect(await createDesktopPrintPort(bridge, { preview }).print(request)).toEqual({ outcome: "printed" });
    expect(bridge.call).toHaveBeenCalledTimes(1);
    const [channel, payload] = bridge.call.mock.calls[0]!;
    expect(channel).toBe("desktop:print-document");
    expect(payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Deck.pptx", html: preview.mock.calls[0]![0].html, options });
  });

  it("lays the copy out on the sheet the user picked when it differs from the document's", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    const options = { landscape: !geometry.landscape, pageSize: geometry.pageSize, silent: true as const, deviceName: "HP LaserJet" };
    const preview = answering({ kind: "print", options });
    await createDesktopPrintPort(bridge, { preview }).print(request);
    const sent = (bridge.call.mock.calls[0]![1] as { html: string }).html;
    expect(sent).not.toBe(preview.mock.calls[0]![0].html);
    expect(new DOMParser().parseFromString(sent, "text/html").head.lastElementChild?.hasAttribute("data-print-sheet")).toBe(true);
  });

  it("opens the system dialog with today's exact payload when the user asks for it", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    expect(await createDesktopPrintPort(bridge, { preview: answering({ kind: "system" }) }).print(request)).toEqual({ outcome: "printed" });
    const payload = bridge.call.mock.calls[0]![1];
    expect(payload.options).toEqual(geometry);
    expect(payload.options).not.toHaveProperty("silent");
    expect(Object.keys(payload).sort()).toEqual(["html", "options", "sessionGeneration", "title"]);
  });

  it("sends nothing and answers cancelled when the user closes the dialog", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    expect(await createDesktopPrintPort(bridge, { preview: answering({ kind: "cancel" }) }).print(request)).toEqual({ outcome: "cancelled" });
    expect(bridge.call).not.toHaveBeenCalled();
  });

  it("fails typed, sending nothing, when the preview throws", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    const preview = vi.fn<PrintPreviewHook>(async () => { throw new Error("boom"); });
    expect(await createDesktopPrintPort(bridge, { preview }).print(request)).toEqual({ outcome: "failed", reason: "print_preview_failed" });
    expect(bridge.call).not.toHaveBeenCalled();
  });

  it("still maps main's answer to a print the dialog chose", async () => {
    const bridge = stubBridge(async () => ({ outcome: "failed", reason: "print_no_printer" }));
    const preview = answering({ kind: "print", options: { ...geometry, silent: true, deviceName: "PDF" } });
    expect(await createDesktopPrintPort(bridge, { preview }).print(request)).toEqual({ outcome: "failed", reason: "print_no_printer" });
  });

  it("does not open the preview for a copy over the cap or without a bridge", async () => {
    const preview = answering({ kind: "system" });
    const html = `<p>${"ệ".repeat(Math.ceil(PRINT_HTML_MAX_BYTES / 3) + 1)}</p>`;
    expect(await createDesktopPrintPort(stubBridge(async () => ({ outcome: "printed" })), { preview }).print({ html, title: "Big.xlsx" })).toEqual({ outcome: "failed", reason: "print_too_large" });
    expect(await createDesktopPrintPort(undefined, { preview }).print(request)).toEqual({ outcome: "failed", reason: "print_unavailable" });
    expect(preview).not.toHaveBeenCalled();
  });

  describe("Save as PDF", () => {
    const options = { landscape: true, pageSize: { width: 215_900, height: 279_400 }, pageRanges: [{ from: 1, to: 2 }] };

    it("sends the copy on the chosen sheet to the save channel, never to the print channel", async () => {
      const bridge = stubBridge(async () => ({ outcome: "saved" }));
      const preview = answering({ kind: "save-pdf", options });
      expect(await createDesktopPrintPort(bridge, { preview }).print(request)).toEqual({ outcome: "printed" });
      expect(bridge.call).toHaveBeenCalledTimes(1);
      const [channel, payload] = bridge.call.mock.calls[0]!;
      expect(channel).toBe("desktop:print-save-pdf");
      expect(payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Deck.pptx", html: expect.any(String), options });
      expect(desktopPrintSavePdfRequestSchema.safeParse(payload).success).toBe(true);
      // The sheet differs from the document's: the same override rule the preview applied.
      expect(payload.html).not.toBe(preview.mock.calls[0]![0].html);
      expect(new DOMParser().parseFromString(payload.html, "text/html").head.lastElementChild?.hasAttribute("data-print-sheet")).toBe(true);
    });

    it("sends the copy untouched when the chosen sheet is the document's own", async () => {
      const bridge = stubBridge(async () => ({ outcome: "saved" }));
      const own = { ...geometry };
      const preview = answering({ kind: "save-pdf", options: own });
      await createDesktopPrintPort(bridge, { preview }).print(request);
      const payload = bridge.call.mock.calls[0]![1];
      expect(payload.html).toBe(preview.mock.calls[0]![0].html);
      expect(payload.options).toEqual(own);
      expect("pageRanges" in own).toBe(false);
    });

    it.each([
      [{ outcome: "saved" }, { outcome: "printed" }],
      [{ outcome: "cancelled" }, { outcome: "cancelled" }],
      [{ outcome: "failed", reason: "print_save_failed" }, { outcome: "failed", reason: "print_save_failed" }],
      [{ outcome: "failed", reason: "print_timeout" }, { outcome: "failed", reason: "print_timeout" }],
      [{ outcome: "printed" }, { outcome: "failed", reason: "print_response_invalid" }],
      [{ outcome: "saved", extra: 1 }, { outcome: "failed", reason: "print_response_invalid" }],
      [{ outcome: "failed", reason: "Raw Electron Message" }, { outcome: "failed", reason: "print_response_invalid" }],
      [undefined, { outcome: "failed", reason: "print_response_invalid" }],
    ] as const)("maps main's answer %j to %j", async (answer, expected) => {
      expect(await createDesktopPrintPort(stubBridge(async () => answer), { preview: answering({ kind: "save-pdf", options }) }).print(request)).toEqual(expected);
    });

    it("fails typed when the channel is refused", async () => {
      const bridge = stubBridge(async () => { throw new Error("invalid_sender"); });
      expect(await createDesktopPrintPort(bridge, { preview: answering({ kind: "save-pdf", options }) }).print(request)).toEqual({ outcome: "failed", reason: "print_call_failed" });
    });

    it("refuses a copy that grows past the cap on the chosen sheet, sending nothing", async () => {
      const bridge = stubBridge(async () => ({ outcome: "saved" }));
      const shell = (padding: number) => `<!DOCTYPE html><html><head>${CSP}</head><body><p>${"x".repeat(padding)}</p></body></html>`;
      // Measure the stamped copy once, then pad it to just under the cap: the sheet rule tips it over.
      let stamped = "";
      await createDesktopPrintPort(bridge, { preview: vi.fn<PrintPreviewHook>(async (job) => { stamped = job.html; return { kind: "cancel" }; }) }).print({ ...request, html: shell(0) });
      const padding = PRINT_HTML_MAX_BYTES - new TextEncoder().encode(stamped).byteLength - 10;
      const outcome = await createDesktopPrintPort(bridge, { preview: answering({ kind: "save-pdf", options }) }).print({ ...request, html: shell(padding) });
      expect(outcome).toEqual({ outcome: "failed", reason: "print_too_large" });
      expect(bridge.call).not.toHaveBeenCalled();
    });
  });

  it("prints as before when no preview is injected", async () => {
    const bridge = stubBridge(async () => ({ outcome: "printed" }));
    await createDesktopPrintPort(bridge, {}).print(request);
    expect(bridge.call.mock.calls[0]![1].options).toEqual(geometry);
  });
});

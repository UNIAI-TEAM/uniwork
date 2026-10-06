/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { PRINT_HTML_MAX_BYTES } from "../../shared/ipc";
import { createDesktopPrintPort, observePrintPort } from "./text-print";

// Any format's copy: a view builds it (DOCX sections, XLSX sheet, PPTX slides,
// PDF pages, Markdown/HTML preview); the desktop port only stamps the title
// and hands it to main.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'none'">`;
const slideCopy = `<!DOCTYPE html><html><head>${CSP}<style>@page s1 { size: 13.333in 7.5in; margin: 0 }</style></head><body><section style="page: s1"><img src="data:image/png;base64,AAAA" alt="Slide 1"></section></body></html>`;

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

function stubBridge(answer: () => Promise<unknown>) {
  const call = vi.fn((_channel: "desktop:print-document", _payload: { sessionGeneration: string; title: string; html: string }) => answer());
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
  expect(payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Deck.pptx", html: expect.any(String) });
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

it("tells the observer when a print starts and settles, and passes the outcome through", async () => {
  const events: string[] = [];
  const settledWith: unknown[] = [];
  let finish: ((value: { outcome: "cancelled" }) => void) | undefined;
  const port = observePrintPort({ print: () => new Promise((resolve) => { finish = resolve; }) }, { onStart: () => events.push("start"), onSettled: (outcome) => { events.push("settled"); settledWith.push(outcome); } });
  const result = port.print({ html: "<p>x</p>", title: "t" });
  expect(events).toEqual(["start"]);
  finish!({ outcome: "cancelled" });
  expect(await result).toEqual({ outcome: "cancelled" });
  expect(events).toEqual(["start", "settled"]);
  expect(settledWith).toEqual([{ outcome: "cancelled" }]);
});

it("settles the observer even when the port throws", async () => {
  const onSettled = vi.fn();
  const port = observePrintPort({ print: () => { throw new Error("boom"); } }, { onStart: () => undefined, onSettled });
  await expect(port.print({ html: "<p>x</p>", title: "t" })).rejects.toThrow("boom");
  expect(onSettled).toHaveBeenCalledTimes(1);
});

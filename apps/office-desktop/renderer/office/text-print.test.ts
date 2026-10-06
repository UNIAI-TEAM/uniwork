/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import * as viewsMarkdown from "@uniwork/views/office/markdown";
import { buildDesktopPrintCopy, createDesktopPrintPort, isPrintBusy, printTextDocument } from "./text-print";

// The desktop no longer mirrors the sanitizer: it must go through the shared
// view building blocks. Spy on the barrel (keeping the real implementation) so
// the tests prove the call, not just the output shape.
vi.mock("@uniwork/views/office/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/views/office/markdown")>();
  return {
    ...actual,
    sanitizePrintCopy: vi.fn(actual.sanitizePrintCopy),
    printMarkdownDocument: vi.fn(actual.printMarkdownDocument),
  };
});

const hostileHtml = `<html><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body onload="x()">
<script>alert(1)</script><img src="data:image/png;base64,AAAA" onerror="alert(2)"><a href="javascript:alert(3)">go</a>
<iframe src="https://evil.test"></iframe><object data="x"></object><p onclick="y()">ok text</p></body></html>`;
const hostileMd = `# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))\n\n<iframe src="https://evil.test"></iframe>\n\n<object data="x"></object>\n\n<base href="https://evil.test/">\n\n<meta http-equiv="refresh" content="0">\n\n<p onclick="y()">hi</p>\n\nPlain **body**`;

const ACTIVE = "script, img[onerror], iframe, object, base, embed, [onclick], [onload], meta[http-equiv=refresh i]";

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); document.body.innerHTML = ""; });

it.each([["html", hostileHtml], ["md", hostileMd]] as const)("%s copy carries no active content and pins the CSP first", (format, source) => {
  const copy = buildDesktopPrintCopy(format, source);
  const doc = new DOMParser().parseFromString(copy, "text/html");
  expect(doc.querySelectorAll(ACTIVE)).toHaveLength(0);
  expect(Array.from(doc.querySelectorAll("[href],[src]")).some((el) => /^javascript:/i.test(el.getAttribute("href") ?? el.getAttribute("src") ?? ""))).toBe(false);
  if (format === "html") for (const pattern of [/<script/i, /onerror/i, /onclick/i, /onload/i, /javascript:/i, /<iframe/i, /<object/i, /<base/i, /refresh/i]) expect(copy).not.toMatch(pattern);
  const first = doc.head.firstElementChild;
  expect(first?.getAttribute("http-equiv")?.toLowerCase()).toBe("content-security-policy");
  expect(first?.getAttribute("content")).toContain("script-src 'none'");
  if (format === "md") { expect(copy).not.toContain("# Title"); expect(copy).not.toContain("**body**"); expect(copy).toContain("<strong>body</strong>"); }
});

it("lets the shared sanitizer own the former desktop gap-fill (metas, srcdoc, script URLs)", () => {
  // hardenDesktopPrintCopy is gone: the shared pass must drop a non-CSP
  // http-equiv meta, a srcdoc on any element, and a script URL on an
  // attribute the engine does not model (ping/longdesc/cite) as well as the
  // ones it does. These are exactly the three things the desktop used to
  // compensate for, so their absence proves nothing was lost by the removal.
  const source = `<meta http-equiv="refresh" content="0;url=https://evil.test/">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=5">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src *; script-src *">` +
    `<div srcdoc="<script>alert(1)</script>">x</div>` +
    `<a ping="JaVaScRiPt:alert(1)">p</a><img longdesc=" \t javascript:alert(1)">` +
    `<blockquote cite="&#106;avascript:alert(1)">c</blockquote>`;
  const copy = buildDesktopPrintCopy("html", source);
  const doc = new DOMParser().parseFromString(copy, "text/html");
  const metas = Array.from(doc.querySelectorAll("meta[http-equiv]"));
  expect(metas).toHaveLength(1);
  expect(metas[0]!.getAttribute("http-equiv")!.toLowerCase()).toBe("content-security-policy");
  expect(copy).not.toMatch(/refresh|x-ua-compatible|default-src \*|script-src \*/i);
  expect(doc.querySelector("[srcdoc]")).toBeNull();
  const normalised = Array.from(copy).filter((char) => { const code = char.charCodeAt(0); return code > 0x20 && code !== 0x7f; }).join("").toLowerCase();
  expect(normalised).not.toContain("javascript:");
});
it("builds the copy through the shared sanitizer, not a local mirror", () => {
  const sanitize = vi.mocked(viewsMarkdown.sanitizePrintCopy);
  expect(sanitize).not.toHaveBeenCalled();
  buildDesktopPrintCopy("md", hostileMd);
  expect(sanitize).toHaveBeenCalledTimes(1);
  expect(sanitize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ csp: viewsMarkdown.PRINT_COPY_CSP }));
});

function stubBridge(answer: () => Promise<unknown>) {
  const call = vi.fn((_channel: "desktop:print-document", _payload: { sessionGeneration: string; title: string; html: string }) => answer());
  return { call };
}

it("hands the sanitized copy to main over the typed print channel, never the source or an in-window frame", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  const append = vi.spyOn(document.body, "append");
  const result = await printTextDocument(bridge, "md", hostileMd, "Doc.md");
  expect(result).toEqual({ outcome: "printed" });
  expect(bridge.call).toHaveBeenCalledTimes(1);
  const [channel, payload] = bridge.call.mock.calls[0]!;
  expect(channel).toBe("desktop:print-document");
  expect(payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Doc.md", html: expect.any(String) });
  // The only difference from the plain sanitized copy is the document title, which Chromium names the OS print job after.
  const sent = new DOMParser().parseFromString(payload.html, "text/html");
  expect(sent.title).toBe("Doc.md");
  sent.querySelector("title")?.remove();
  expect(sent.documentElement.outerHTML).toBe(new DOMParser().parseFromString(buildDesktopPrintCopy("md", hostileMd), "text/html").documentElement.outerHTML);
  expect(payload.html).not.toContain("# Title");
  expect(append).not.toHaveBeenCalled();
  expect(document.querySelector("iframe")).toBeNull();
});

it("names the copy after the document so the OS print dialog does not fall back to the app name", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await printTextDocument(bridge, "html", "<html><head><title>Old</title></head><body><p>x</p></body></html>", "Báo cáo <Q3>.html");
  const doc = new DOMParser().parseFromString(bridge.call.mock.calls[0]![1].html, "text/html");
  expect(doc.querySelectorAll("title")).toHaveLength(1);
  expect(doc.title).toBe("Báo cáo <Q3>.html");
  expect(doc.head.firstElementChild?.getAttribute("http-equiv")?.toLowerCase()).toBe("content-security-policy");
});

it("routes the desktop path through the shared printMarkdownDocument flow", async () => {
  const shared = vi.mocked(viewsMarkdown.printMarkdownDocument);
  const result = await printTextDocument(stubBridge(async () => ({ outcome: "printed" })), "html", hostileHtml, "Doc.html");
  expect(result).toEqual({ outcome: "printed" });
  expect(shared).toHaveBeenCalledTimes(1);
  expect(shared).toHaveBeenCalledWith(expect.objectContaining({ title: "Doc.html", csp: viewsMarkdown.PRINT_COPY_CSP }));
});

it.each([
  [{ outcome: "cancelled" }, { outcome: "cancelled" }],
  [{ outcome: "failed", reason: "print_no_printer" }, { outcome: "failed", reason: "print_no_printer" }],
  [{ outcome: "printed", extra: 1 }, { outcome: "failed", reason: "print_response_invalid" }],
  [undefined, { outcome: "failed", reason: "print_response_invalid" }],
] as const)("maps main's answer %j to %j", async (answer, expected) => {
  expect(await printTextDocument(stubBridge(async () => answer), "html", "<p>x</p>", "t")).toEqual(expected);
});

it("returns a typed failure when the channel is refused", async () => {
  expect(await printTextDocument(stubBridge(async () => { throw new Error("IPC payload exceeds the byte limit"); }), "html", hostileHtml, "Doc.html")).toEqual({ outcome: "failed", reason: "print_call_failed" });
});

it.each(["print_busy", "print_call_failed", "print_no_preview_available"])("forwards only [a-z0-9_] reason codes (%s)", async (reason) => {
  const result = await printTextDocument(stubBridge(async () => ({ outcome: "failed", reason })), "html", "<p>x</p>", "t");
  expect(result.outcome === "failed" && result.reason).toMatch(/^[a-z0-9_]+$/);
});

it("recognises only print_busy as the already-open case", () => {
  expect(isPrintBusy({ outcome: "failed", reason: "print_busy" })).toBe(true);
  expect(isPrintBusy({ outcome: "failed", reason: "print_unavailable" })).toBe(false);
  expect(isPrintBusy({ outcome: "cancelled" })).toBe(false);
});

it("fails typed, not silently, without a bridge", async () => {
  expect(await printTextDocument(undefined, "html", "<p>x</p>", "t")).toEqual({ outcome: "failed", reason: "print_unavailable" });
  expect(await createDesktopPrintPort(undefined).print({ html: "<p>x</p>", title: "t" })).toEqual({ outcome: "failed", reason: "print_unavailable" });
});

it("caps the title at the channel limit", async () => {
  const bridge = stubBridge(async () => ({ outcome: "printed" }));
  await createDesktopPrintPort(bridge).print({ html: "<p>x</p>", title: "a".repeat(400) });
  expect(bridge.call.mock.calls[0]![1].title).toHaveLength(255);
});

/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { buildDesktopPrintCopy, printTextDocument } from "./text-print";

const hostileHtml = `<html><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body onload="x()">
<script>alert(1)</script><img src="data:image/png;base64,AAAA" onerror="alert(2)"><a href="javascript:alert(3)">go</a>
<iframe src="https://evil.test"></iframe><object data="x"></object><p onclick="y()">ok text</p></body></html>`;
const hostileMd = `# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))\n\n<iframe src="https://evil.test"></iframe>\n\n<object data="x"></object>\n\n<base href="https://evil.test/">\n\n<meta http-equiv="refresh" content="0">\n\n<p onclick="y()">hi</p>\n\nPlain **body**`;

const ACTIVE = "script, img[onerror], iframe, object, base, embed, [onclick], [onload], meta[http-equiv=refresh i]";

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

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

function stubFrame(print: () => void) {
  const view = { focus: vi.fn(), print: vi.fn(print), document: { title: "" } };
  const contentWindow = vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(view as unknown as Window);
  const seen: { sandbox?: string | null; srcdoc?: string | null; frame?: HTMLIFrameElement } = {};
  const append = document.body.append.bind(document.body);
  vi.spyOn(document.body, "append").mockImplementation((...nodes: (Node | string)[]) => {
    const frame = nodes[0] as HTMLIFrameElement;
    seen.frame = frame; seen.sandbox = frame.getAttribute("sandbox"); seen.srcdoc = frame.getAttribute("srcdoc");
    append(...nodes);
    queueMicrotask(() => frame.dispatchEvent(new Event("load")));
  });
  return { view, seen, contentWindow };
}

it("prints the sanitized copy from a sandboxed frame and removes it", async () => {
  const { view, seen } = stubFrame(() => undefined);
  const result = await printTextDocument("md", hostileMd, "Doc.md");
  expect(result).toEqual({ outcome: "printed" });
  expect(seen.sandbox).toBe("allow-same-origin allow-modals");
  expect(seen.srcdoc).toBe(buildDesktopPrintCopy("md", hostileMd));
  expect(seen.srcdoc).not.toContain("# Title");
  expect(view.print).toHaveBeenCalledTimes(1);
  expect(view.document.title).toBe("Doc.md");
  expect(document.querySelector("iframe")).toBeNull();
});

it("returns a typed failure when print throws, and still removes the frame", async () => {
  stubFrame(() => { throw new Error("boom"); });
  expect(await printTextDocument("html", hostileHtml, "Doc.html")).toEqual({ outcome: "failed", reason: "boom" });
  expect(document.querySelector("iframe")).toBeNull();
});

it("fails typed when the frame has no contentWindow", async () => {
  const { contentWindow } = stubFrame(() => undefined);
  contentWindow.mockReturnValue(null);
  expect(await printTextDocument("html", "<p>x</p>", "t")).toEqual({ outcome: "failed", reason: "print_frame_unavailable" });
  expect(document.querySelector("iframe")).toBeNull();
});

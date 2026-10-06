/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { createDesktopTextPreviewPort } from "./text-preview-port";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; TestResizeObserver.instances.push(this); }
  observe() {}
  disconnect() {}
  trigger(width: number, height: number) { this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
}

afterEach(() => { document.body.innerHTML = ""; document.documentElement.classList.remove("dark"); });

const hostile = `<!doctype html><html><head><title>x</title><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><script>window.parent.pwn=1</script></head>
<body onload="steal()"><img src="x" onerror="steal()"><a href="javascript:steal()">go</a><a href="  JaVaScRiPt:steal()">go2</a>
<iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><embed src="https://evil.example"><form action="javascript:steal()"><button formaction="javascript:x">b</button></form>
<svg onload="steal()"><script>steal()</script></svg><p onclick="steal()">hi</p></body></html>`;

async function mountCopy(format: "md" | "html", text: string, title = "Doc") {
  const container = document.createElement("div");
  document.body.append(container);
  const session = await createDesktopTextPreviewPort(format).mount({ container, format, title, text, manifest: { entries: [] } });
  const frame = container.querySelector("iframe")!;
  return { container, frame, session, copy: () => frame.getAttribute("srcdoc") ?? "" };
}

function expectInert(srcdoc: string, rawText = true) {
  const doc = new DOMParser().parseFromString(srcdoc, "text/html");
  expect(doc.querySelectorAll("script, iframe, object, embed, base, form")).toHaveLength(0);
  expect(doc.querySelector('meta[http-equiv="refresh" i]')).toBeNull();
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name.toLowerCase().startsWith("on")).toBe(false);
      expect(/^\s*javascript:/i.test(attribute.value)).toBe(false);
    }
  }
  // Markdown shows hostile markup as escaped text, so only HTML can be text-checked.
  if (rawText) { expect(srcdoc).not.toContain("steal()"); expect(srcdoc).not.toContain("evil.example"); }
}

it("mounts a fully sandboxed iframe: no scripts, no same-origin", async () => {
  const { frame } = await mountCopy("html", "<p>Xin chào</p>");
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.getAttribute("srcdoc")).toContain("Xin chào");
  expect(frame.hasAttribute("src")).toBe(false);
});

it("puts a deny-by-default CSP meta as the first head child", async () => {
  const { copy } = await mountCopy("html", "<html><head><title>t</title></head><body>b</body></html>");
  const doc = new DOMParser().parseFromString(copy(), "text/html");
  const first = doc.head.firstElementChild!;
  expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(first.getAttribute("content")).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
  expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')).toHaveLength(1);
});

it("leaves no executable content in a hostile HTML document", async () => {
  const { copy } = await mountCopy("html", hostile);
  expectInert(copy());
});

it("leaves no executable content when hostile markup is written in Markdown", async () => {
  const { copy } = await mountCopy("md", `# Title\n\n${hostile}\n\n[x](javascript:steal())\n\n![i](https://evil.example/a.png)`);
  expectInert(copy(), false);
  expect(copy()).toContain("Title");
});

it("renders Markdown to a safe copy with its headings", async () => {
  const { copy } = await mountCopy("md", "# Tiêu đề\n\n- một\n- hai\n", "Ghi chú");
  const doc = new DOMParser().parseFromString(copy(), "text/html");
  expect(doc.querySelector("h1")?.textContent).toBe("Tiêu đề");
  expect(doc.querySelectorAll("li")).toHaveLength(2);
  expect(doc.title).toBe("Ghi chú");
  expect(doc.querySelector("style")?.textContent).toContain("html{min-height:100%;}");
  expect(doc.querySelector("style")?.textContent).toContain("body{min-height:100%;");
});

it("rebuilds the copy on update and removes the frame on dispose", async () => {
  const { container, session, copy } = await mountCopy("html", "<p>first</p>");
  expect(copy()).toContain("first");
  await session.update?.("<p>two</p>");
  expect(copy()).toContain("two");
  expect(copy()).not.toContain("first");
  session.dispose();
  expect(container.querySelector("iframe")).toBeNull();
});

it.each(["md", "html"] as const)("re-applies only on hidden-to-visible transition for %s", async (format) => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const { container, frame, session } = await mountCopy(format, "<p>visible</p>");
  const initial = frame.getAttribute("srcdoc");
  const setAttribute = vi.spyOn(frame, "setAttribute");
  TestResizeObserver.instances.at(-1)?.trigger(0, 0);
  TestResizeObserver.instances.at(-1)?.trigger(700, 300);
  expect(setAttribute).toHaveBeenCalledTimes(1);
  expect(frame.getAttribute("srcdoc")).toBe(initial);
  TestResizeObserver.instances.at(-1)?.trigger(800, 400);
  expect(setAttribute).toHaveBeenCalledTimes(1);
  await session.update?.("<p>updated</p>");
  expect(setAttribute).toHaveBeenCalledTimes(2);
  expect(frame.getAttribute("srcdoc")).toContain("updated");
  session.dispose();
  expect(container.querySelector("iframe")).toBeNull();
  vi.unstubAllGlobals();
});

it.each(["md", "html"] as const)("re-applies once on the first measurable observation for initially visible %s", async (format) => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const container = document.createElement("div");
  document.body.append(container);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ width: 700, height: 300 } as DOMRect);
  const session = await createDesktopTextPreviewPort(format).mount({ container, format, title: "Doc", text: "<p>visible</p>" });
  const frame = container.querySelector("iframe")!;
  const setAttribute = vi.spyOn(frame, "setAttribute");
  TestResizeObserver.instances.at(-1)?.trigger(700, 300);
  expect(setAttribute).toHaveBeenCalledTimes(1);
  TestResizeObserver.instances.at(-1)?.trigger(800, 400);
  expect(setAttribute).toHaveBeenCalledTimes(1);
  session.dispose();
  vi.unstubAllGlobals();
});

it("follows the host dark class for the colour scheme", async () => {
  document.documentElement.classList.add("dark");
  const dark = await mountCopy("html", "<p>d</p>");
  expect(dark.copy()).toMatch(/color-scheme" content="dark"/);
  document.documentElement.classList.remove("dark");
  const light = await mountCopy("html", "<p>l</p>");
  expect(light.copy()).toMatch(/color-scheme" content="light"/);
});

it("does not load remote or relative images (local mode has no network)", async () => {
  const { copy } = await mountCopy("html", '<img src="https://evil.example/a.png"><img src="pic.png"><img src="data:image/png;base64,iVBORw0KGgo=">');
  const doc = new DOMParser().parseFromString(copy(), "text/html");
  const sources = Array.from(doc.querySelectorAll("img"), (image) => image.getAttribute("src") ?? "");
  expect(sources.filter((source) => /^https?:|^pic\.png$/.test(source))).toEqual([]);
});

it("renders a blocked image as its alt text so the frame makes no request the CSP must refuse", async () => {
  const { copy } = await mountCopy("html", '<img src="pic.png" alt="Fixture"><img src="https://evil.example/a.png" srcset="pic.png 2x" alt="Remote"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline">');
  const doc = new DOMParser().parseFromString(copy(), "text/html");
  const images = Array.from(doc.querySelectorAll("img"));
  expect(images.map((image) => image.getAttribute("alt"))).toEqual(["Inline"]);
  expect(images[0]!.getAttribute("src")).toMatch(/^data:image\/png/);
  const blocked = Array.from(doc.querySelectorAll("span[data-blocked-image]"));
  expect(blocked.map((span) => span.textContent)).toEqual(["Fixture", "Remote"]);
  expect(blocked.every((span) => !span.hasAttribute("src") && !span.hasAttribute("srcset"))).toBe(true);
  expect(copy()).not.toContain("about:blank#blocked");
  expect(copy()).not.toContain("evil.example");
});

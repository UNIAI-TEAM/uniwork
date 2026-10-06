// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { MarkdownPrintMenuItems } from "./print-menu";
import { printMarkdownDocument, sanitizePrintCopy, type MarkdownPrintPort } from "./print";

const { t } = initI18n();

beforeEach(async () => {
  await setLocale("en");
});

/** Hostile source: every construct the print copy must neutralise. */
const HOSTILE = `
<h1>Báo cáo</h1>
<script>parent.postMessage("exfiltrate", "*")</script>
<img src="x" onerror="alert(1)">
<a href="javascript:alert(2)">click</a>
<a href="https://evil.example/leak">external</a>
<img src="https://tracker.example/p.gif">
<img src="assets/missing.png">
<iframe src="https://evil.example/frame"></iframe>
<base href="https://evil.example/">
`;

/** The payloads one port call captured, so tests can inspect the copy. */
function capturePort() {
  const calls: { html: string; title: string }[] = [];
  const port: MarkdownPrintPort = {
    print(request) {
      calls.push({ html: request.html, title: request.title });
      return { outcome: "printed" };
    },
  };
  return { port, calls };
}

describe("sanitizePrintCopy", () => {
  it("strips scripts, on* handlers and browsing-context elements the parser sees", () => {
    const copy = sanitizePrintCopy(HOSTILE);
    expect(copy).not.toMatch(/<script/i);
    expect(copy).not.toMatch(/onerror/i);
    expect(copy).not.toMatch(/<iframe|<base|<object|<embed/i);
    // Prose survives: the copy is the document, not an empty page.
    expect(copy).toContain("Báo cáo");
  });

  it("neutralises every URL the preview policy refuses", () => {
    const copy = sanitizePrintCopy(HOSTILE);
    expect(copy).not.toContain("evil.example");
    expect(copy).not.toContain("tracker.example");
    expect(copy).not.toContain("javascript:");
    expect(copy).not.toContain("assets/missing.png");
  });

  it("points a granted asset at the scoped proxy and blocks a refused one", () => {
    const manifest = {
      version: 1 as const,
      document_path: "document.md",
      entries: [
        { key: "assets/logo.png", sha256: "a".repeat(64), byte_length: 1, media_type: "image/png", origin: "imported" as const },
        { key: "assets/secret.png", sha256: "b".repeat(64), byte_length: 1, media_type: "image/png", origin: "imported" as const },
      ],
    };
    const copy = sanitizePrintCopy(`<img src="assets/logo.png"><img src="assets/secret.png">`, {
      manifest,
      assetUrl: (key) => (key === "assets/logo.png" ? "https://proxy.example/s/logo.png" : null),
    });
    expect(copy).toContain("https://proxy.example/s/logo.png");
    expect(copy).not.toContain("assets/secret.png");
  });

  it("drops active markup inside <template>, which querySelectorAll does not descend into", () => {
    // `<template>.content` is a separate document fragment: a bare
    // `querySelectorAll("*")` never reaches it, so the script element and the
    // on* handler inside would otherwise reach the payload verbatim.
    const copy = sanitizePrintCopy(
      `<template><img src=x onerror="alert(1)"><script>alert(1)</script></template>`,
    );
    expect(copy).not.toMatch(/<script/i);
    expect(copy).not.toMatch(/onerror/i);
  });
});

/** Schemes a browser executes when it follows a URL: the shared sanitizer must
 * DROP an attribute carrying one, never rewrite it. */
const DANGEROUS_SCHEME = /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i;

/** The ASCII whitespace/control characters a browser strips from a URL before
 * it reads the scheme. A charCode filter keeps the repo lint (no control
 * characters in regexes) happy. */
function stripUrlNoise(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += char;
  }
  return out;
}

/** Every attribute value in the copy, normalised the way a browser reads a URL
 * (ASCII whitespace/control characters removed, lowercased). */
function attributeValues(copy: string): string[] {
  const doc = new DOMParser().parseFromString(copy, "text/html");
  return Array.from(doc.querySelectorAll("*")).flatMap((element) =>
    Array.from(element.attributes).map((attribute) => stripUrlNoise(attribute.value).toLowerCase()),
  );
}

/** The UNI-928 sanitizer gap: the shared pass used to leave these in place. */
describe("sanitizePrintCopy: shared sanitizer gap", () => {
  it("keeps exactly the copy's own CSP meta and drops every other http-equiv meta", () => {
    const copy = sanitizePrintCopy(
      `<meta http-equiv="refresh" content="0;url=https://evil.example/"><meta http-equiv="X-UA-Compatible" content="IE=5">`,
    );
    const metas = Array.from(new DOMParser().parseFromString(copy, "text/html").querySelectorAll("meta[http-equiv]"));
    expect(metas).toHaveLength(1);
    expect(metas[0]!.getAttribute("http-equiv")!.toLowerCase()).toBe("content-security-policy");
    expect(copy).not.toMatch(/refresh|x-ua-compatible/i);
  });

  it("drops a weaker document-supplied CSP meta, keeping only the copy's own first", () => {
    const copy = sanitizePrintCopy(
      `<meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline'">`,
    );
    const metas = Array.from(new DOMParser().parseFromString(copy, "text/html").querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'));
    expect(metas).toHaveLength(1);
    expect(metas[0]!.getAttribute("content")).toContain("script-src 'none'");
    expect(copy).not.toMatch(/default-src \*|script-src \*/);
  });

  it("drops srcdoc on an arbitrary element, not just iframe", () => {
    const copy = sanitizePrintCopy(`<div srcdoc="<script>alert(1)</script>">x</div>`);
    expect(copy).not.toMatch(/srcdoc/i);
    expect(new DOMParser().parseFromString(copy, "text/html").querySelector("[srcdoc]")).toBeNull();
  });

  // The engine's string pass rewrites the URL slots it models; `ping`,
  // `longdesc` and `cite` are NOT modelled, so they prove the parser pass
  // drops a dangerous value rather than relying on the rewrite.
  const DANGEROUS_VECTORS: readonly [string, string][] = [
    ["mixed-case scheme in href", `<a href="JaVaScRiPt:alert(1)">x</a>`],
    ["mixed-case scheme in an unmodelled attribute", `<a ping="JaVaScRiPt:alert(1)">x</a>`],
    ["leading spaces, tabs and newlines before the scheme", `<img longdesc=" \t\n javascript:alert(1)">`],
    ["a tab inside the scheme", `<a ping="java\tscript:alert(1)">x</a>`],
    ["an entity-encoded scheme in the source", `<blockquote cite="&#106;avascript:alert(1)">x</blockquote>`],
    ["vbscript on src", `<img src="VBScript:msgbox(1)">`],
    ["data:text/html on action", `<form action="data:text/html,alert(1)"></form>`],
    ["javascript: on formaction", `<button formaction="javascript:alert(1)">x</button>`],
    ["javascript: in srcset", `<img srcset="a.png 1x, javascript:alert(1) 2x">`],
    ["javascript: on poster", `<video poster="javascript:alert(1)"></video>`],
    ["javascript: on background", `<body background="javascript:alert(1)"></body>`],
    ["javascript: on ping", `<a ping="javascript:alert(1)">x</a>`],
    ["javascript: on an unmodelled attribute (longdesc)", `<img longdesc="javascript:alert(1)">`],
    ["data:text/html on an unmodelled attribute (longdesc)", `<img longdesc="data:text/html,alert(1)">`],
    ["xlink:href in svg", `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`],
  ];

  it.each(DANGEROUS_VECTORS)("drops a %s URL attribute instead of rewriting it", (_label, vector) => {
    const copy = sanitizePrintCopy(vector);
    for (const value of attributeValues(copy)) expect(DANGEROUS_SCHEME.test(value)).toBe(false);
    const flat = stripUrlNoise(copy).toLowerCase();
    expect(flat).not.toContain("javascript:");
    expect(flat).not.toContain("vbscript:");
    expect(flat).not.toContain("data:text/html");
  });

  it("keeps a data:image/svg+xml image: the copy's CSP blocks the script it could carry", () => {
    // Deliberately out of DANGEROUS_SCHEMES. A browser runs no script in an
    // <img> SVG, and the copy pins `script-src 'none'`, so the image stays
    // renderable rather than being dropped as a live URL.
    const copy = sanitizePrintCopy(`<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">`);
    expect(copy).toContain("data:image/svg+xml;base64,");
    expect(copy).toContain("script-src 'none'");
  });
});

/** A Markdown source with a raw HTML block and a javascript: link. */
const HOSTILE_SOURCE = [
  "# Báo cáo",
  "",
  "<script>parent.postMessage(\"exfiltrate\", \"*\")</script>",
  "",
  "[click](javascript:alert(2))",
  "",
  "<img src=x onerror=\"alert(1)\">",
  "",
].join("\n");

/** Stands in for the host's Markdown render: it turns the source into real
 * elements (a link becomes an <a href>), which is exactly the case the print
 * copy has to survive - the render step is NOT the sanitizer. */
const naiveRender = (source: string): string =>
  source
    .split("\n")
    .map((line) => {
      const link = /^\[(.*)\]\((.*)\)$/.exec(line);
      return link ? `<p><a href="${link[2]}">${link[1]}</a></p>` : line;
    })
    .join("\n");

describe("printMarkdownDocument", () => {
  it("sends the SANITIZED copy, never the raw source, to the injected port", async () => {
    const { port, calls } = capturePort();
    const outcome = await printMarkdownDocument({ port, renderHtml: () => HOSTILE, title: "Báo cáo" });
    expect(outcome).toEqual({ outcome: "printed" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe("Báo cáo");
    // The payload is the sanitized copy: no script, no javascript: URL, no
    // external host, no on* handler.
    expect(calls[0]!.html).not.toMatch(/<script|onerror|javascript:|evil\.example|tracker\.example/i);
  });

  it("keeps a raw <script> and a javascript: href in the SOURCE out of the payload", async () => {
    const { port, calls } = capturePort();
    await printMarkdownDocument({ port, renderHtml: () => naiveRender(HOSTILE_SOURCE), title: "Báo cáo" });
    const html = calls[0]!.html;
    // The raw HTML block's script and the on* handler never reach the copy.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    // The link is a real element by then, and its javascript: URL is gone.
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/javascript:/i);
    // The rendered prose is still there.
    expect(html).toContain("Báo cáo");
  });

  it("turns a throwing port into a typed failure instead of crashing", async () => {
    const port: MarkdownPrintPort = { print: () => { throw new Error("no printer"); } };
    await expect(printMarkdownDocument({ port, renderHtml: () => "<p>x</p>", title: "x" })).resolves.toEqual({
      outcome: "failed",
      reason: "no printer",
    });
  });

  it("turns a throwing render into a typed failure too, not an unhandled rejection", async () => {
    const { port } = capturePort();
    await expect(
      printMarkdownDocument({
        port,
        renderHtml: () => {
          throw new Error("render blew up");
        },
        title: "x",
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "render blew up" });
  });
});

function renderMenu(props: Parameters<typeof MarkdownPrintMenuItems>[0]) {
  return render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <MarkdownPrintMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("MarkdownPrintMenuItems", () => {
  it("calls the injected print port with the sanitized copy, never window.print()", async () => {
    const windowPrint = vi.fn();
    const original = window.print;
    window.print = windowPrint;
    try {
      const { port, calls } = capturePort();
      renderMenu({ port, renderHtml: () => HOSTILE, title: "Báo cáo" });
      fireEvent.click(screen.getByRole("menuitem", { name: t("office.markdown.print.title") }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.html).not.toMatch(/<script|javascript:|evil\.example/i);
      // The view never reaches for the browser dialog directly.
      expect(windowPrint).not.toHaveBeenCalled();
    } finally {
      window.print = original;
    }
  });

  it("offers no Print entry when the host injected no print port", () => {
    renderMenu({ renderHtml: () => "<p>x</p>", title: "x" });
    expect(screen.queryByRole("menuitem", { name: t("office.markdown.print.title") })).toBeNull();
  });

  it("renders the export entries disabled with the not-available-yet tooltip", () => {
    const { port, calls } = capturePort();
    renderMenu({ port, renderHtml: () => "<p>x</p>", title: "x" });
    for (const label of [t("office.markdown.print.exportPdf"), t("office.markdown.print.exportDocx")]) {
      const item = screen.getByRole("menuitem", { name: label });
      // Disabled in the accessibility tree, in Base UI's state, and on the
      // native tooltip - the entry says why it is not available.
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAttribute("data-disabled");
      expect(item).toHaveAttribute("title", t("office.markdown.print.exportNotAvailable"));
      // A click on a disabled export does nothing: it never fakes an export.
      fireEvent.click(item);
    }
    expect(calls).toHaveLength(0);
  });

  it("threads the host's csp so a proxied asset is not self-blocked", async () => {
    const { port, calls } = capturePort();
    const manifest = {
      version: 1 as const,
      document_path: "document.md",
      entries: [
        { key: "assets/logo.png", sha256: "a".repeat(64), byte_length: 1, media_type: "image/png", origin: "imported" as const },
      ],
    };
    const csp = "default-src 'none'; img-src data: https://proxy.example; script-src 'none'";
    renderMenu({
      port,
      renderHtml: () => `<img src="assets/logo.png">`,
      title: "Báo cáo",
      manifest,
      assetUrl: (key) => (key === "assets/logo.png" ? "https://proxy.example/s/logo.png" : null),
      csp,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: t("office.markdown.print.title") }));
    await waitFor(() => expect(calls).toHaveLength(1));
    // The granted asset proxies through, and the copy's own CSP names the
    // origin, so the print frame does not block what it just rewrote.
    expect(calls[0]!.html).toContain("https://proxy.example/s/logo.png");
    expect(calls[0]!.html).toContain("img-src data: https://proxy.example");
  });
});

describe("sanitizePrintCopy: page geometry and blocked images", () => {
  it("gives a copy without its own @page rule page margins, ahead of the document's styles", () => {
    const copy = sanitizePrintCopy(`<style>p{color:red}</style><h1>Title</h1><p>Body</p>`);
    const doc = new DOMParser().parseFromString(copy, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style"));
    expect(styles[0]!.textContent).toMatch(/@page\s*\{[^}]*margin:\s*\d+mm/);
    expect(styles.map((s) => s.textContent).join("")).toContain("p{color:red}");
    // page 1 is the content: the first thing in the body is the document's own first block.
    expect(doc.body.firstElementChild!.localName).toBe("h1");
  });

  it("keeps the copy's CSP meta the first thing in the head, the default style right after it", () => {
    const copy = sanitizePrintCopy(`<style>p{color:red}</style><p>x</p>`);
    const head = new DOMParser().parseFromString(copy, "text/html").head;
    expect(head.firstElementChild!.getAttribute("http-equiv")?.toLowerCase()).toBe("content-security-policy");
    const style = head.querySelector("style[data-print-page]")!;
    expect(style.previousElementSibling!.localName).toBe("meta");
    const styles = Array.from(head.querySelectorAll("style"));
    const own = styles.find((s) => s.textContent?.includes("p{color:red}"))!;
    expect(styles.indexOf(style as HTMLStyleElement)).toBeLessThan(styles.indexOf(own));
  });

  it("lets a table and a quote break across pages, but keeps a row and a code block whole", () => {
    const css = new DOMParser()
      .parseFromString(sanitizePrintCopy(`<p>x</p>`), "text/html")
      .head.querySelector("style[data-print-page]")!.textContent!;
    const avoided = /([^{}]+)\{[^}]*break-inside:avoid/.exec(css)![1]!.split(",").map((s) => s.trim());
    expect(avoided).toEqual(expect.arrayContaining(["pre", "tr"]));
    expect(avoided).not.toContain("table");
    expect(avoided).not.toContain("blockquote");
  });

  it("still adds the default margins when a comment or a string only mentions @page", () => {
    const copy = sanitizePrintCopy(`<style>/* @page { margin: 0 } */ p::before{content:"@page"}</style><p>x</p>`);
    expect(new DOMParser().parseFromString(copy, "text/html").head.querySelector("style[data-print-page]")).not.toBeNull();
  });

  it("keeps a document's own @page rule and adds none", () => {
    const copy = sanitizePrintCopy(`<style>@page{size:A5;margin:5mm}</style><p>x</p>`);
    expect(copy.match(/@page/g)).toHaveLength(1);
    expect(copy).toContain("size:A5");
  });

  it("prints a blocked image as its alt text, with no broken-image element", () => {
    const copy = sanitizePrintCopy(`<p><img src="https://tracker.example/p.gif" alt="Sơ đồ"></p><p><img src="assets/missing.png" alt="Ảnh"></p>`);
    const doc = new DOMParser().parseFromString(copy, "text/html");
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(Array.from(doc.querySelectorAll("[data-blocked-image]")).map((e) => e.textContent)).toEqual(["Sơ đồ", "Ảnh"]);
    expect(copy).not.toContain("about:blank#blocked");
  });
});

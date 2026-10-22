import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@uniwork/core/provider";
import type { Document } from "@uniwork/core/types/document";

// The document page's entry: a format a genoffice module opens goes to the lazy
// module host with its module; anything else gets the typed unsupported state.
// Only the transport and the flag service are replaced: the organization-scoped
// config read answers from the mocked request.
const mocks = vi.hoisted(() => ({
  hostProps: vi.fn(),
  loaders: [] as Array<() => Promise<unknown>>,
  request: vi.fn(),
  useFlag: vi.fn((_key: string, fallback: boolean) => fallback),
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    mocks.loaders.push(loader);
    return (props: Record<string, unknown>) => { mocks.hostProps(props); return createElement("i", { "data-testid": "module-host" }); };
  },
}));
vi.mock("@uniwork/core/feature-flags", () => ({ useFlag: mocks.useFlag }));
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => mocks.request(...a),
}));
vi.mock("./module-frame-host", () => ({ OfficeModuleHost: "the module host" }));

import { detectDocumentFormat, DocumentOfficeEditorHost } from "./document-host";

const file = (filename: string, mime_type: string) => ({ filename, mime_type, size_bytes: 10 });
const doc = (filename: string, mime_type = "application/octet-stream") =>
  ({ id: "doc-1", title: "Spec", organization_id: "org-1", workspace_id: "ws-1", file: file(filename, mime_type) }) as unknown as Document;

let root: Root;
let container: HTMLDivElement;

/** The document's organization's public config (a healthy answer always carries office_engine). */
function answerConfig(flags: Record<string, boolean> = {}) {
  mocks.request.mockImplementation((path: string) =>
    path === "/api/v1/config?organization_id=org-1"
      ? Promise.resolve({ flags: { office_engine: true, ...flags } })
      : Promise.reject(new Error(`unexpected ${path}`)));
}

/** One macrotask: lets react-query publish the settled answer. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  mocks.hostProps.mockReset();
  mocks.request.mockReset();
  mocks.useFlag.mockReset().mockImplementation((_key, fallback) => fallback);
  answerConfig();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const mount = (document: Document, extra?: Record<string, unknown>) => act(async () => {
  root.render(createElement(QueryProvider, null, createElement(DocumentOfficeEditorHost, { document, wsId: "ws-1", readonly: true, ...extra })));
});

describe("DocumentOfficeEditorHost", () => {
  it.each([
    ["a.docx", "docs"],
    ["a.pdf", "pdf"],
    ["a.md", "markdown"],
    ["a.html", "html"],
    ["a.pptx", "slides"],
    ["a.xlsx", "sheets"],
  ])("opens %s in the %s module host, readonly passed through", async (filename, module) => {
    const document = doc(filename);
    await mount(document);
    expect(container.querySelector('[data-testid="module-host"]')).not.toBeNull();
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module, document, readonly: true, wsId: "ws-1" }));
    await expect(mocks.loaders[0]!()).resolves.toBe("the module host");
  });

  it.each(["legacy.xls", "letter.odt", "archive.zip"])("gives %s the typed unsupported state, never a module host", async (filename) => {
    await mount(doc(filename));
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
    expect(mocks.hostProps).not.toHaveBeenCalled();
  });

  // A .txt file always opens in the markdown module (plain mode in the frame),
  // like a .md file: no office_txt_open flag, nothing but the extension decides.
  it.each(["ghi-chu.txt", "README.TXT"])("opens %s in the markdown module with no txt flag in the organization's answer", async (filename) => {
    answerConfig();
    await mount(doc(filename, "text/plain"));
    await settle();
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module: "markdown" }));
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).toBeNull();
  });

  it("does not read the organization's config for a .txt file: opening needs no txt answer", async () => {
    mocks.request.mockImplementation(() => new Promise(() => { /* never settles */ }));
    await mount(doc("ghi-chu.txt", "text/plain"));
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module: "markdown" }));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("trusts the page's resolved officeFormat over its own detection", async () => {
    await mount(doc("ghi-chu.txt", "text/plain"), { officeFormat: "md" });
    await settle();
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module: "markdown" }));
  });

  it.each(["notes.csv", "app.log", "no-extension"])("never gives %s a module, even as text/plain", async (filename) => {
    await mount(doc(filename, "text/plain"));
    await settle();
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
    expect(mocks.hostProps).not.toHaveBeenCalled();
  });
});

describe("detectDocumentFormat", () => {
  it("maps a .txt file to md by extension alone", () => {
    expect(detectDocumentFormat(doc("ghi-chu.txt", "text/plain"))).toBe("md");
    expect(detectDocumentFormat(doc("README.TXT", "application/octet-stream"))).toBe("md");
  });

  it("never maps a bare text/plain file that is not .txt", () => {
    expect(detectDocumentFormat(doc("notes.csv", "text/plain"))).toBe("unknown");
    expect(detectDocumentFormat(doc("app.log", "text/plain"))).toBe("unknown");
    expect(detectDocumentFormat(doc("no-extension", "text/plain"))).toBe("unknown");
  });

  it("reads the mime type before the file name, and names the conversion-only sources", () => {
    expect(detectDocumentFormat(doc("noext", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toBe("docx");
    expect(detectDocumentFormat(doc("noext", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe("xlsx");
    expect(detectDocumentFormat(doc("Deck.PPTX"))).toBe("pptx");
    expect(detectDocumentFormat(doc("x", "application/pdf"))).toBe("pdf");
    expect(detectDocumentFormat(doc("notes.markdown"))).toBe("md");
    expect(detectDocumentFormat(doc("page.htm"))).toBe("html");
    expect(detectDocumentFormat(doc("old.xls"))).toBe("xls");
    expect(detectDocumentFormat(doc("x", "application/vnd.oasis.opendocument.text"))).toBe("odt");
    expect(detectDocumentFormat({ ...doc("x"), file: null } as unknown as Document)).toBe("unknown");
  });
});

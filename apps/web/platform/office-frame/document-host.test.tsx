import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@uniwork/core/provider";
import type { Document } from "@uniwork/core/types/document";

// The document page's entry: a format a genoffice module opens goes to the lazy
// module host with its module; anything else gets the typed unsupported state.
// Only the transport and the flag service are replaced: the organization-scoped
// config read (office_txt_open included) answers from the mocked request.
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

const mount = (document: Document) => act(async () => {
  root.render(createElement(QueryProvider, null, createElement(DocumentOfficeEditorHost, { document, wsId: "ws-1", readonly: true })));
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

  // UNI-1813: a .txt file opens in the markdown module only while
  // office_txt_open is on in the document's organization's own config answer;
  // the host-level flag default no longer decides. The flag read happens here,
  // detectDocumentFormat stays pure.
  it.each(["ghi-chu.txt", "README.TXT"])("opens %s in the markdown module when the organization's answer turns office_txt_open on, global off", async (filename) => {
    answerConfig({ office_txt_open: true });
    await mount(doc(filename, "text/plain"));
    await settle();
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module: "markdown" }));
  });

  it("gives a .txt file the unsupported state when the organization's answer turns office_txt_open off, even with the global flag on", async () => {
    mocks.useFlag.mockImplementation((key: string, fallback: boolean) => (key === "office_txt_open" ? true : fallback));
    answerConfig({ office_txt_open: false });
    await mount(doc("ghi-chu.txt", "text/plain"));
    await settle();
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
    expect(mocks.hostProps).not.toHaveBeenCalled();
  });

  it("gives a .txt file the unsupported state while the organization's answer is still loading", async () => {
    mocks.request.mockImplementation((path: string) => path.startsWith("/api/v1/config")
      ? new Promise(() => { /* never settles */ })
      : Promise.reject(new Error(`unexpected ${path}`)));
    await mount(doc("ghi-chu.txt", "text/plain"));
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
    expect(mocks.hostProps).not.toHaveBeenCalled();
  });

  it.each(["notes.csv", "app.log", "no-extension"])("never gives %s a module, text/plain or not, flag on or off", async (filename) => {
    for (const flagOn of [false, true]) {
      answerConfig({ office_txt_open: flagOn });
      mocks.hostProps.mockReset();
      await mount(doc(filename, "text/plain"));
      await settle();
      expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
      expect(mocks.hostProps).not.toHaveBeenCalled();
      await act(async () => root.render(null));
    }
  });
});

describe("detectDocumentFormat", () => {
  it("maps a .txt file to md only while office_txt_open is on", () => {
    expect(detectDocumentFormat(doc("ghi-chu.txt", "text/plain"), true)).toBe("md");
    expect(detectDocumentFormat(doc("README.TXT", "text/plain"), true)).toBe("md");
    expect(detectDocumentFormat(doc("ghi-chu.txt", "text/plain"), false)).toBe("unknown");
    expect(detectDocumentFormat(doc("ghi-chu.txt", "text/plain"))).toBe("unknown");
  });

  it("never maps a bare text/plain file that is not .txt, flag on or off", () => {
    for (const flag of [true, false]) {
      expect(detectDocumentFormat(doc("notes.csv", "text/plain"), flag)).toBe("unknown");
      expect(detectDocumentFormat(doc("app.log", "text/plain"), flag)).toBe("unknown");
      expect(detectDocumentFormat(doc("no-extension", "text/plain"), flag)).toBe("unknown");
    }
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

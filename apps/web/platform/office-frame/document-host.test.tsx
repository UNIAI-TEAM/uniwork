import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

// The document page's entry: a format a genoffice module opens goes to the lazy
// module host with its module; anything else gets the typed unsupported state.
const mocks = vi.hoisted(() => ({
  hostProps: vi.fn(),
  loaders: [] as Array<() => Promise<unknown>>,
  useFlag: vi.fn((_key: string, fallback: boolean) => fallback),
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    mocks.loaders.push(loader);
    return (props: Record<string, unknown>) => { mocks.hostProps(props); return createElement("i", { "data-testid": "module-host" }); };
  },
}));
vi.mock("@uniwork/core/feature-flags", () => ({ useFlag: mocks.useFlag }));
vi.mock("./module-frame-host", () => ({ OfficeModuleHost: "the module host" }));
import { detectDocumentFormat, DocumentOfficeEditorHost } from "./document-host";

const file = (filename: string, mime_type: string) => ({ filename, mime_type, size_bytes: 10 });
const doc = (filename: string, mime_type = "application/octet-stream") =>
  ({ id: "doc-1", title: "Spec", organization_id: "org-1", workspace_id: "ws-1", file: file(filename, mime_type) }) as unknown as Document;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.hostProps.mockReset();
  mocks.useFlag.mockReset().mockImplementation((_key, fallback) => fallback);
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
  root.render(createElement(DocumentOfficeEditorHost, { document, wsId: "ws-1", readonly: true }));
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

  // UNI-1813: a .txt file opens in the markdown module only while the public
  // office_txt_open flag is on; the flag read happens here, detectDocumentFormat
  // stays pure.
  it.each(["ghi-chu.txt", "README.TXT"])("opens %s in the markdown module while office_txt_open is on", async (filename) => {
    mocks.useFlag.mockImplementation((key: string, fallback: boolean) => (key === "office_txt_open" ? true : fallback));
    await mount(doc(filename, "text/plain"));
    expect(mocks.hostProps).toHaveBeenCalledWith(expect.objectContaining({ module: "markdown" }));
  });

  it("gives a .txt file the unsupported state while office_txt_open is off", async () => {
    await mount(doc("ghi-chu.txt", "text/plain"));
    expect(container.querySelector('[data-testid="office-host-unsupported"]')).not.toBeNull();
    expect(mocks.hostProps).not.toHaveBeenCalled();
  });

  it.each(["notes.csv", "app.log", "no-extension"])("never gives %s a module, text/plain or not, flag on or off", async (filename) => {
    for (const flagOn of [false, true]) {
      mocks.useFlag.mockImplementation((key: string, fallback: boolean) => (key === "office_txt_open" ? flagOn : fallback));
      mocks.hostProps.mockReset();
      await mount(doc(filename, "text/plain"));
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
});

describe("detectDocumentFormat", () => {
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

import { act, createElement, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

// The routing contract: the page's one host entry picks the format host, and a
// format with no web editor gets a typed unsupported state instead of being
// handed to a host for a different format (the old xlsx fallback).
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.format ? `${key}:${vars.format}` : key) }) }));
vi.mock("next/dynamic", () => ({
  // Resolve the same loader the real dynamic() is handed, then report the
  // mocked host's __name so the test observes the actual routing choice.
  default: (loader: () => Promise<{ __name?: string }>) => {
    const Host = (props: { document?: Document }) => {
      const [name, setName] = useState<string | null>(null);
      useEffect(() => { void loader().then((module) => setName(module.__name ?? "host")); }, []);
      return createElement("div", { "data-format-host": name ?? "pending", "data-document": props.document?.id });
    };
    return Host as ComponentType<Record<string, unknown>>;
  },
}));
vi.mock("./docx-office-host", () => ({ DocxOfficeEditorHost: Object.assign(() => null, { __name: "docx" }) }));
vi.mock("./xlsx-office-host", () => ({ XlsxOfficeEditorHost: Object.assign(() => null, { __name: "xlsx" }) }));
vi.mock("./pdf-office-host", () => ({ PdfOfficeEditorHost: Object.assign(() => null, { __name: "pdf" }) }));
vi.mock("./pptx-office-host", () => ({ PptxOfficeEditorHost: Object.assign(() => null, { __name: "pptx" }) }));
vi.mock("./md-html-adapter", () => ({
  MarkdownOfficeEditorHost: Object.assign(() => null, { __name: "md" }),
  HtmlOfficeEditorHost: Object.assign(() => null, { __name: "html" }),
}));

import { createDocumentOfficeEditorHost } from "./document-office-host";

// Every genoffice module (docs, pdf, markdown, html, slides, sheets) goes through the injected frame
// slot (UNI-1013/1014), handed its module and the module's G3 host as its fallback.
const MODULES: Record<string, string> = { docx: "docs", xlsx: "sheets", pdf: "pdf", md: "markdown", html: "html", pptx: "slides" };
const Frame = ({ module, fallback }: { module: string; fallback: ReactNode }) => createElement("div", { "data-frame-slot": module }, fallback);
const DocumentOfficeEditorHost = createDocumentOfficeEditorHost({ moduleForFormat: (format) => MODULES[format] ?? null, Frame });

const file = (filename: string, mime_type: string) => ({ file_id: "f", version_id: "v1", version: 1, filename, mime_type, size_bytes: 10, checksum_sha256: "0".repeat(64) });
const documentFor = (filename: string, mime_type: string) => ({ id: "doc-1", title: "Doc", organization_id: "org", workspace_id: "ws", revision: "1", file: file(filename, mime_type) }) as Document;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs(); });

async function route(document: Document) {
  await act(async () => { root.render(createElement(DocumentOfficeEditorHost, { document, wsId: "ws", readonly: false })); });
  return container;
}

describe("document office host routing", () => {
  it.each([
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["paper.pdf", "application/pdf", "pdf"],
    ["notes.md", "text/markdown", "md"],
    ["notes.markdown", "text/markdown", "md"],
    ["page.html", "text/html", "html"],
    ["page.htm", "text/html", "html"],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ])("routes %s to the %s host", async (filename, mime, host) => {
    await route(documentFor(filename, mime));
    expect(container.querySelector(`[data-format-host="${host}"]`)).not.toBeNull();
  });

  it("routes a markdown document whose mime is generic by its .md extension", async () => {
    await route(documentFor("notes.md", "application/octet-stream"));
    expect(container.querySelector('[data-format-host="md"]')).not.toBeNull();
  });

  it("never sends a Markdown document to the XLSX host", async () => {
    await route(documentFor("notes.md", "text/markdown"));
    expect(container.querySelector('[data-format-host="xlsx"]')).toBeNull();
  });

  it.each([
    // The Q7 conversion sources the server detects but never edits in place.
    ["legacy.xls", "application/vnd.ms-excel"],
    ["letter.odt", "application/vnd.oasis.opendocument.text"],
    // A file nothing identifies must not be guessed into DocxHost.
    ["archive.bin", "application/octet-stream"],
  ])("gives %s a typed unsupported state instead of a silent fallback", async (filename, mime) => {
    await route(documentFor(filename, mime));
    expect(container.querySelector("[data-office-unsupported]")).not.toBeNull();
    expect(container.querySelector('[data-format-host]')).toBeNull();
  });

  it("never sends a PowerPoint deck to the XLSX host", async () => {
    await route(documentFor("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
    expect(container.querySelector('[data-format-host="xlsx"]')).toBeNull();
  });

  it("never routes an .xls or .odt to the DOCX or XLSX host", async () => {
    await route(documentFor("legacy.xls", "application/vnd.ms-excel"));
    expect(container.querySelector('[data-format-host="docx"]')).toBeNull();
    expect(container.querySelector('[data-format-host="xlsx"]')).toBeNull();
  });

  it.each([
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docs"],
    ["book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sheets"],
    ["paper.pdf", "application/pdf", "pdf"],
    ["notes.md", "text/markdown", "markdown"],
    ["page.html", "text/html", "html"],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides"],
  ])("hands %s to the frame slot as the %s module, with the G3 host as its fallback", async (filename, mime, module) => {
    await route(documentFor(filename, mime));
    expect(container.querySelector(`[data-frame-slot="${module}"] [data-format-host]`)).not.toBeNull();
  });

  it("does not offer the frame slot for a format with no web editor", async () => {
    await route(documentFor("legacy.xls", "application/vnd.ms-excel"));
    expect(container.querySelector("[data-frame-slot]")).toBeNull();
  });
});

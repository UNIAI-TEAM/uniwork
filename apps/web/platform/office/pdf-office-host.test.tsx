import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), adapter: vi.fn(), dispose: vi.fn(async () => undefined) }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ user: { id: "account-1" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ getOfficeCapabilities: mocks.capabilities }));
vi.mock("./pdf-adapter", () => ({ createPdfFormatAdapter: mocks.adapter }));
// Keep the real module (so `detectDocumentFormat` stays real and the routing
// assertion below stays meaningful) and stub only the composed editor host.
vi.mock("./editor-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-host")>();
  return { ...actual, OfficeEditorHost: (props: { formatAdapter?: unknown; capability?: { status: string; fidelityWarnings?: string[] } }) => createElement("div", { "data-testid": "host", "data-bound": Boolean(props.formatAdapter), "data-capability": props.capability?.status ?? "unknown", "data-warnings": (props.capability?.fidelityWarnings ?? []).join("|") }) };
});
// The app resolves each format host through next/dynamic; the test resolves the
// same loader synchronously behind Suspense so the routing host can mount.
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<unknown>) => {
      const LazyHost = React.lazy(async () => ({ default: (await loader()) as ComponentType<Record<string, unknown>> }));
      return (props: Record<string, unknown>) => React.createElement(React.Suspense, { fallback: null }, React.createElement(LazyHost, props));
    },
  };
});

import { DocumentOfficeEditorHost } from "./document-office-host";
import { PdfOfficeEditorHost } from "./pdf-office-host";

const documentFor = (id: string) => ({ id, title: "Spec", organization_id: "org", workspace_id: "ws", revision: "1", file: { version_id: "version-1", filename: "spec.pdf", mime_type: "application/pdf" } }) as Document;
/** The engine service binds no pdf handlers, so every pdf row is unbound. */
const unboundCapabilities = (id: string) => ({
  documentId: id, format: "pdf", engineVersion: "server-build",
  operations: ["open", "edit", "serialize"].map((operation) => ({ operation, runtime: "none", evidenceLevel: "pending", engineBound: false, supported: false, reason: "not bound in this service build", targetFormat: null })),
});
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.capabilities.mockReset();
  mocks.adapter.mockReset();
  mocks.dispose.mockClear();
  mocks.capabilities.mockResolvedValue(unboundCapabilities("doc-1"));
  mocks.adapter.mockReturnValue({ session: { dispose: mocks.dispose } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(id = "doc-1", readonly = false) {
  await act(async () => {
    root.render(createElement(PdfOfficeEditorHost, { document: documentFor(id), wsId: "ws", readonly }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Let the effect's deferred module import settle inside React's act boundary.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

describe("PDF web host", () => {
  it("binds the editor although every server pdf row is unbound, and records the rows as fidelity warnings", async () => {
    await mount();
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ accountId: "account-1", organizationId: "org", workspaceId: "ws", documentId: "doc-1", baseVersionId: "version-1", baseRevision: "1" }),
      capability: expect.objectContaining({
        format: "pdf", operation: "serialize", host: "web", status: "available", reason: null,
        fidelityWarnings: ["open: not bound in this service build", "edit: not bound in this service build", "serialize: not bound in this service build"],
      }),
    }));
    expect(container.querySelector("[data-bound=true]")).not.toBeNull();
    await act(async () => root.unmount());
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores a capability response for a replaced document and stays available", async () => {
    mocks.capabilities.mockResolvedValue(unboundCapabilities("other-doc"));
    await mount();
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-bound=true]")).not.toBeNull();
    expect(container.querySelector("[data-warnings='']")).not.toBeNull();
  });

  it("does not bind an editing adapter for a readonly document", async () => {
    await mount("doc-1", true);
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(container.querySelector("[data-bound=false]")).not.toBeNull();
    expect(container.querySelector("[data-capability=readonly]")).not.toBeNull();
  });

  it("fails closed when the browser engine module cannot load", async () => {
    mocks.adapter.mockImplementation(() => { throw new Error("engine_load_failed"); });
    await mount();
    expect(container.querySelector("[data-bound=false]")).not.toBeNull();
    expect(container.querySelector("[data-capability=unavailable]")).not.toBeNull();
  });

  it("keeps the editing session alive when the document title changes", async () => {
    await mount();
    await act(async () => root.render(createElement(PdfOfficeEditorHost, { document: { ...documentFor("doc-1"), title: "Renamed" }, wsId: "ws", readonly: false })));
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("disposes the replaced document's adapter and binds the new document", async () => {
    await mount("doc-1");
    await mount("doc-2");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.adapter).toHaveBeenCalledTimes(2);
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ documentId: "doc-2" }) }));
  });

  it("routes a .pdf document to the PDF host", async () => {
    await act(async () => {
      root.render(createElement(DocumentOfficeEditorHost, { document: documentFor("doc-1"), wsId: "ws", readonly: false }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ documentId: "doc-1" }),
      capability: expect.objectContaining({ format: "pdf", operation: "serialize" }),
    }));
  });
});

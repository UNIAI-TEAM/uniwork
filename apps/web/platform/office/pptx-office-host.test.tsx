import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ user: { id: "account-1" }, capabilities: vi.fn(), adapter: vi.fn(), documents: vi.fn(), runtime: vi.fn(), dispose: vi.fn() }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ user: mocks.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ getOfficeCapabilities: mocks.capabilities }));
vi.mock("@uniwork/core/api/endpoints/config", () => ({ getPublicConfig: async () => ({ office_deployment_id: "deployment" }) }));
vi.mock("./pptx-adapter", () => ({ createPptxFormatAdapter: mocks.adapter }));
vi.mock("./pptx-runtime", () => ({ createWebPptxSessionRuntime: mocks.runtime }));
vi.mock("./pptx-save-transport", () => ({ createPptxDocumentsTransport: mocks.documents }));
// Mirror the real OfficeEditorHost contract: the adapter owns the view, so the
// host renders `formatAdapter.editorView` (falling back to a top-level
// `editorView`). Reading only `props.editorView` hid the adapter canvas.
vi.mock("./editor-host", () => ({ OfficeEditorHost: (props: { formatAdapter?: { id: string; editorView?: ReactNode }; editorView?: ReactNode }) => createElement("div", { "data-adapter": props.formatAdapter?.id ?? "unbound" }, props.formatAdapter?.editorView ?? props.editorView) }));
import { PptxOfficeEditorHost } from "./pptx-office-host";
import { withCoreProvider } from "./with-core-provider.test-helper";

const documentFor = (id = "doc-1") => ({
  id,
  title: "Deck",
  organization_id: "org",
  workspace_id: "ws",
  revision: "1",
  file: { version_id: "version-1", filename: "deck.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
}) as Document;
// The engine service binds no pptx handler: every server row is unbound, and
// the browser build is what makes the host available.
const capabilities = (id = "doc-1") => ({ documentId: id, format: "pptx", engineVersion: "service", operations: [{ operation: "open", supported: false, reason: "not_bound" }, { operation: "edit", supported: false, reason: "not_bound" }] });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.user = { id: "account-1" };
  mocks.adapter.mockReset();
  mocks.documents.mockReset();
  mocks.runtime.mockReset();
  mocks.dispose.mockReset();
  mocks.capabilities.mockReset();
  mocks.capabilities.mockImplementation(async (id: string) => capabilities(id));
  mocks.documents.mockReturnValue({ read: vi.fn(), upload: vi.fn(), commit: vi.fn() });
  mocks.runtime.mockReturnValue({});
  mocks.adapter.mockImplementation(() => ({ id: "adapter-" + mocks.adapter.mock.calls.length, session: { dispose: mocks.dispose } }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(doc = documentFor(), readonly = false) {
  await act(async () => {
    root.render(withCoreProvider(createElement(PptxOfficeEditorHost, { document: doc, wsId: "ws", readonly })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PPTX web session lifetime", () => {
  it("binds the browser engine although every server pptx row is unbound, recording the rows as fidelity warnings", async () => {
    await mount();
    expect(mocks.adapter).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({
      capability: expect.objectContaining({ status: "available", fidelityWarnings: ["open: not_bound", "edit: not_bound"] }),
      documents: expect.anything(),
      runtime: expect.anything(),
    }));
    expect(mocks.documents).toHaveBeenCalledWith("doc-1");
    expect(mocks.runtime).toHaveBeenCalledWith({ documentId: "doc-1" });
  });

  it("retains the bound editing session across metadata refetches and a title change", async () => {
    await mount();
    const bound = container.querySelector("[data-adapter]")?.getAttribute("data-adapter");
    await mount({ ...documentFor(), title: "Renamed" });
    expect(container.querySelector("[data-adapter]")?.getAttribute("data-adapter")).toBe(bound);
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("retains live N+1 session state when Save updates the server revision/version", async () => {
    await mount();
    const bound = container.querySelector("[data-adapter]")?.getAttribute("data-adapter");
    await mount({ ...documentFor(), revision: "2", file: { ...documentFor().file!, version_id: "saved-version" } });
    expect(container.querySelector("[data-adapter]")?.getAttribute("data-adapter")).toBe(bound);
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("replaces and disposes the session when the document changes", async () => {
    await mount();
    await mount(documentFor("doc-2"));
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ documentId: "doc-2" }) }));
  });

  it("isolates a different account and mounts readonly with saves blocked", async () => {
    await mount();
    mocks.user = { id: "account-2" };
    await mount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ accountId: "account-2" }) }));
    await mount(documentFor(), true);
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ readonly: true, capability: expect.objectContaining({ status: "readonly" }) }));
  });

  it("shows an accessible loading state while capability negotiation is pending", async () => {
    mocks.capabilities.mockImplementation(() => new Promise(() => undefined));
    await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).toContain("office.pptx.state.opening");
    expect(mocks.adapter).not.toHaveBeenCalled();
  });

  it("fails closed when the browser adapter cannot be created", async () => {
    mocks.adapter.mockImplementation(() => {
      throw new Error("artifact_unavailable");
    });
    await mount();
    expect(container.querySelector("[data-adapter]")?.getAttribute("data-adapter")).toBe("unbound");
  });

  it("mounts the adapter's real-canvas editorView through the shared host", async () => {
    // The adapter owns the canvas; the host must render the node it is given
    // verbatim (the interim element-list surface must never reappear).
    mocks.adapter.mockImplementation(() => ({
      id: "adapter-canvas",
      session: { dispose: mocks.dispose },
      editorView: createElement("div", { "data-pptx-canvas": "" }, createElement("span", null, "real canvas")),
    }));
    await mount();
    const canvas = container.querySelector("[data-pptx-canvas]");
    expect(canvas).not.toBeNull();
    expect(canvas?.textContent).toBe("real canvas");
    expect(container.querySelector("[data-pptx-session-surface]")).toBeNull();
  });

  it("hands a non-pptx document to the shared host without binding the pptx engine", async () => {
    const xlsx = { ...documentFor("sheet-1"), file: { version_id: "version-1", filename: "workbook.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } } as Document;
    await mount(xlsx);
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(container.querySelector("[data-adapter]")?.getAttribute("data-adapter")).toBe("unbound");
  });
});

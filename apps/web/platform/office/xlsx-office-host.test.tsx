import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ user: { id: "account-1" }, capabilities: vi.fn(), adapter: vi.fn(), runtime: vi.fn(), dispose: vi.fn() }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ user: mocks.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ getOfficeCapabilities: mocks.capabilities }));
vi.mock("@uniwork/core/api/endpoints/config", () => ({ getPublicConfig: async () => ({ office_deployment_id: "deployment" }) }));
vi.mock("./xlsx-adapter", () => ({ createXlsxFormatAdapter: mocks.adapter, createXlsxDocumentsTransport: () => ({}) }));
vi.mock("./xlsx-runtime", () => ({ createWebXlsxSessionRuntime: mocks.runtime }));
vi.mock("./editor-host", () => ({ OfficeEditorHost: (props: { formatAdapter?: { id: string }; editorView?: ReactNode }) => createElement("div", { "data-adapter": props.formatAdapter?.id ?? "unbound" }, props.editorView) }));
import { XlsxOfficeEditorHost } from "./xlsx-office-host";
import { withCoreProvider } from "./with-core-provider.test-helper";

const documentFor = (id = "doc-1") => ({ id, title: "Workbook", organization_id: "org", workspace_id: "ws", revision: "1", file: { version_id: "version-1", filename: "workbook.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }) as Document;
const capabilities = (id = "doc-1") => ({ documentId: id, format: "xlsx", engineVersion: "bound", operations: ["open", "edit", "serialize"].map((operation) => ({ operation, supported: true })) });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.user = { id: "account-1" };
  mocks.adapter.mockReset(); mocks.runtime.mockReset(); mocks.dispose.mockReset();
  mocks.capabilities.mockReset(); mocks.capabilities.mockImplementation(async (id: string) => capabilities(id));
  mocks.runtime.mockReturnValue({});
  mocks.adapter.mockImplementation(() => ({ id: "adapter-" + mocks.adapter.mock.calls.length, session: { dispose: mocks.dispose } }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function mount(doc = documentFor(), readonly = false) {
  await act(async () => { root.render(withCoreProvider(createElement(XlsxOfficeEditorHost, { document: doc, wsId: "ws", readonly }))); await new Promise((resolve) => setTimeout(resolve, 0)); });
}
describe("XLSX web session lifetime", () => {
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
    await mount(); await mount(documentFor("doc-2"));
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ documentId: "doc-2" }) }));
  });
  it("isolates a different account and changed read-only permission", async () => {
    await mount(); mocks.user = { id: "account-2" }; await mount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ accountId: "account-2" }) }));
    await mount(documentFor(), true);
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.objectContaining({ readonly: true }));
  });
  it("shows an accessible loading state while capability negotiation is pending", async () => {
    mocks.capabilities.mockImplementation(() => new Promise(() => undefined));
    await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).toContain("office.xlsx.state.opening");
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("fails closed on capabilities for another document", async () => {
    mocks.capabilities.mockResolvedValue(capabilities("other-doc"));
    await mount(); expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("opens a read-only workbook without requiring edit or serialize capabilities", async () => {
    mocks.capabilities.mockResolvedValue({ ...capabilities(), operations: [{ operation: "open", supported: true }] });
    await mount(documentFor(), true);
    expect(mocks.adapter).toHaveBeenCalledOnce();
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({ readonly: true, embedded: true, capability: expect.objectContaining({ status: "readonly" }) }));
  });
});

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import { initI18n, setLocale } from "@uniwork/core/i18n";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), adapter: vi.fn(), checkpoint: vi.fn(), save: vi.fn(), config: vi.fn() }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ user: { id: "account" } }) }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ getOfficeCapabilities: mocks.capabilities }));
vi.mock("@uniwork/core/api/endpoints/config", () => ({ getPublicConfig: mocks.config }));
vi.mock("./xlsx-runtime", () => ({ createWebXlsxSessionRuntime: () => ({}) }));
vi.mock("./xlsx-adapter", () => ({ createXlsxFormatAdapter: mocks.adapter, createXlsxDocumentsTransport: () => ({}) }));
// The real OfficeEditorHost and OfficeShell must remain in this regression.
import { XlsxOfficeEditorHost } from "./xlsx-office-host";

const doc = { id: "doc", title: "Workbook", organization_id: "org", workspace_id: "ws", revision: "1",
  file: { filename: "book.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", version_id: "v1" } } as Document;
const capabilities = { documentId: "doc", format: "xlsx", engineVersion: "native",
  operations: ["open", "edit", "serialize"].map(operation => ({ operation, supported: true })) };
let root: Root;
let container: HTMLDivElement;
initI18n();
beforeEach(async () => {
  await setLocale("en");
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({ office_deployment_id: "deployment", office_channel: "dev" });
  mocks.adapter.mockImplementation(({ capability }: { capability: OfficeCapabilityEntry }) => ({ capability,
    editorView: createElement("div", { role: "grid", tabIndex: 0 }),
    session: {
      editor: { getDirtyGeneration: () => 1 },
      coordinator: { getState: () => ({ state: "ready", dirtyGeneration: 1, lastSavedGeneration: 1, error: null }),
        subscribe: () => () => undefined, setCapability: () => undefined, save: mocks.save, markDirty: vi.fn() },
      recoverDraft: async () => ({ status: "missing" }), dispose: vi.fn(), checkpoint: mocks.checkpoint,
    },
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(readonly = false) {
  await act(async () => { root.render(createElement(XlsxOfficeEditorHost, { document: doc, readonly, wsId: "ws" })); });
}
describe("XLSX loading/readonly composition across the real Shared host", () => {
  it("negotiates with a styled polite busy state, then opens the actual host without any false assertive alert", async () => {
    let resolve!: (value: typeof capabilities) => void;
    mocks.capabilities.mockImplementation(() => new Promise(done => { resolve = done; }));
    const alerts: Element[] = [];
    const observer = new MutationObserver(() => alerts.push(...container.querySelectorAll('[role="alert"]')));
    observer.observe(container, { childList: true, subtree: true });
    await render();
    expect(container.querySelector('[role="status"][aria-live="polite"][aria-busy="true"]')).toBeTruthy();
    expect(container.querySelector('[data-office-shell]')).toBeTruthy();
    expect(container.querySelector('[data-office-editor-host] button[aria-label="Save to UniWork"]')).toBeNull();
    expect(mocks.adapter).not.toHaveBeenCalled();
    await act(async () => resolve(capabilities));
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(alerts).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    observer.disconnect();
  });
  it("reads GET /api/v1/config once for the format host and the shared host together", async () => {
    mocks.capabilities.mockResolvedValue(capabilities);
    await render();
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(mocks.config).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...capabilities, documentId: "other" }, { ...capabilities, operations: [] }])("keeps actual unavailable responses refused", async value => {
    mocks.capabilities.mockResolvedValue(value);
    await render();
    expect(container.querySelector('[data-testid="office-host-unbound"][role="alert"]')).toBeTruthy();
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("opens negotiated readonly with no Save or draft checkpoint", async () => {
    vi.useFakeTimers();
    mocks.capabilities.mockResolvedValue({ ...capabilities, operations: [{ operation: "open", supported: true }] });
    await render(true);
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="office-host-unbound"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Save to UniWork"]')).toBeNull();
    await act(async () => {
      container.querySelector('[role="grid"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
});

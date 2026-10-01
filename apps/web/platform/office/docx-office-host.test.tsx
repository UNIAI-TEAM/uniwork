import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), adapter: vi.fn(), dispose: vi.fn(async () => undefined) }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ user: { id: "account-1" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ getOfficeCapabilities: mocks.capabilities }));
vi.mock("./docx-adapter", () => ({ createDocxFormatAdapter: mocks.adapter }));
vi.mock("./editor-host", () => ({ OfficeEditorHost: (props: { formatAdapter?: unknown; capability?: { status: string } }) => createElement("div", { "data-testid": "host", "data-bound": Boolean(props.formatAdapter), "data-capability": props.capability?.status ?? "unknown" }) }));

import { DocxOfficeEditorHost } from "./docx-office-host";

const documentFor = (id: string) => ({ id, title: "Spec", organization_id: "org", workspace_id: "ws", revision: "1", file: { version_id: "version-1", filename: "spec.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }) as Document;
const capabilitiesFor = (id: string, supported = true) => ({ documentId: id, format: "docx", engineVersion: "server-build", operations: ["open", "edit", "serialize"].map((operation) => ({ operation, supported })) });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.capabilities.mockReset();
  mocks.adapter.mockReset();
  mocks.dispose.mockClear();
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
    root.render(createElement(DocxOfficeEditorHost, { document: documentFor(id), wsId: "ws", readonly }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Let the effect's deferred module import settle inside React's act boundary.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

describe("DOCX web host", () => {
  it("binds the lazy adapter only after capability negotiation and supplies the authenticated document identity", async () => {
    mocks.capabilities.mockResolvedValue(capabilitiesFor("doc-1"));
    await mount();
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ accountId: "account-1", organizationId: "org", workspaceId: "ws", documentId: "doc-1", baseVersionId: "version-1", baseRevision: "1" }),
      capability: expect.objectContaining({ format: "docx", status: "available", reason: null }),
    }));
    expect(container.querySelector("[data-bound=true]")).not.toBeNull();
    await act(async () => root.unmount());
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["unsupported", "wrong-document", "readonly"])("does not bind an editing adapter for %s", async (scenario) => {
    mocks.capabilities.mockResolvedValue(capabilitiesFor(scenario === "wrong-document" ? "other-doc" : "doc-1", scenario !== "unsupported"));
    await mount("doc-1", scenario === "readonly");
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(container.querySelector("[data-bound=false]")).not.toBeNull();
  });

  it("keeps the editing session alive when the document title changes", async () => {
    mocks.capabilities.mockResolvedValue(capabilitiesFor("doc-1"));
    await mount();
    await act(async () => root.render(createElement(DocxOfficeEditorHost, { document: { ...documentFor("doc-1"), title: "Renamed" }, wsId: "ws", readonly: false })));
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("ignores a capability response from a document that has already been replaced", async () => {
    let resolveOld: ((value: ReturnType<typeof capabilitiesFor>) => void) | undefined;
    mocks.capabilities.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    mocks.capabilities.mockResolvedValue(capabilitiesFor("doc-2"));
    await mount("doc-1");
    await mount("doc-2");
    await act(async () => { resolveOld?.(capabilitiesFor("doc-1")); });
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ documentId: "doc-2" }) }));
  });
});

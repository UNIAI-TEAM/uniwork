import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ switchProps: vi.fn(), frameProps: vi.fn(), push: vi.fn() }));
vi.mock("@uniwork/views/layout/workspace-context", () => ({ useWorkspace: () => ({ workspace: { organization_slug: "acme", slug: "ops" } }) }));
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ push: mocks.push }) }));
vi.mock("@uniwork/views/office", () => ({
  OfficeModuleOpenSwitch: (props: { module: string; organizationId?: string; frame: ReactNode; fallback: ReactNode }) => {
    mocks.switchProps(props);
    return createElement("div", { "data-testid": "switch" }, props.frame, props.fallback);
  },
  OfficeModuleFrame: (props: Record<string, unknown>) => { mocks.frameProps(props); return createElement("i", { "data-testid": "frame" }); },
}));

import { pinnedFrameVersion } from "./frame-versions";
import { ModuleFrameOrG3Host } from "./module-frame-host";

const doc = { id: "doc-1", title: "Deck", organization_id: "org-1", workspace_id: "ws-1" } as Document;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.switchProps.mockReset();
  mocks.frameProps.mockReset();
  mocks.push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

const mount = (module: "slides" | "sheets" = "sheets", readonly = true) => act(async () => {
  root.render(createElement(ModuleFrameOrG3Host, { module, document: doc, wsId: "ws-1", readonly, className: "c", fallback: createElement("b", { "data-testid": "g3" }) }));
});

describe("ModuleFrameOrG3Host", () => {
  it("is the G3 host alone when the module has no installed bundle", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "1.0.0" }));
    await mount();
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.switchProps).not.toHaveBeenCalled();
  });

  it("hands the switch the module and organization, and the frame the module's version", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    await mount();
    expect(mocks.switchProps.mock.calls[0]![0]).toMatchObject({ module: "sheets", organizationId: "org-1" });
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({
      module: "sheets", wsId: "ws-1", documentId: "doc-1", title: "Deck", frameVersion: "0.2.0-abc1234", readonly: true, className: "c",
    }));
    (mocks.frameProps.mock.calls[0]![0] as { onSavedAs: (id: string) => void }).onSavedAs("copy-9");
    expect(mocks.push).toHaveBeenCalledWith("/acme/ops/documents/copy-9");
  });

  it("keeps a view-only slides user on the G3 pptx host, and an editor on the frame", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ slides: "0.2.0-abc1234" }));
    await mount("slides", true);
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.switchProps).not.toHaveBeenCalled();
    await mount("slides", false);
    expect(mocks.switchProps.mock.calls[0]![0]).toMatchObject({ module: "slides" });
  });
});

describe("pinnedFrameVersion", () => {
  it("reads the docs variable first, then the module map, and nothing from a broken map", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "1.0.0");
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "0.9.0", pdf: "2.0.0", html: 3 }));
    expect(pinnedFrameVersion("docs")).toBe("1.0.0");
    expect(pinnedFrameVersion("pdf")).toBe("2.0.0");
    expect(pinnedFrameVersion("html")).toBe("");
    expect(pinnedFrameVersion("sheets")).toBe("");
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "");
    expect(pinnedFrameVersion("docs")).toBe("0.9.0");
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", "{not json");
    expect(pinnedFrameVersion("pdf")).toBe("");
  });
});

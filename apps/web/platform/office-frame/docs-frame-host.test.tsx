import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ switchProps: vi.fn(), frameProps: vi.fn(), push: vi.fn() }));
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ push: mocks.push }) }));
vi.mock("@uniwork/views/layout/workspace-context", () => ({ useWorkspace: () => ({ workspace: { organization_slug: "acme", slug: "ops" } }) }));
vi.mock("@uniwork/views/office", () => ({
  DocxOpenSwitch: (props: { organizationId?: string; docsFrame: ReactNode; fallback: ReactNode }) => {
    mocks.switchProps(props);
    return createElement("div", { "data-testid": "switch" }, props.docsFrame, props.fallback);
  },
  OfficeDocsFrame: (props: Record<string, unknown>) => { mocks.frameProps(props); return createElement("i", { "data-testid": "frame" }); },
}));

import { DocxFrameOrG3Host } from "./docs-frame-host";

const doc = { id: "doc-1", title: "Spec", organization_id: "org-1", workspace_id: "ws-1" } as Document;
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
});

const mount = () => act(async () => {
  root.render(createElement(DocxFrameOrG3Host, {
    document: doc, wsId: "ws-1", readonly: false, className: "c", frameVersion: "0.1.0-abc1234",
    documentHref: (id: string) => `/acme/ops/documents/${id}`, fallback: createElement("b", { "data-testid": "g3" }),
  }));
});

describe("DocxFrameOrG3Host", () => {
  it("hands the switch the document's organization and the pinned version for the frame", async () => {
    await mount();
    expect(mocks.switchProps.mock.calls[0]![0].organizationId).toBe("org-1");
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({
      wsId: "ws-1", documentId: "doc-1", title: "Spec", frameVersion: "0.1.0-abc1234", readonly: false, className: "c",
      libraryHref: "/acme/ops/documents",
    }));
    // The core createDocsFrameApi default serves the frame; the host injects none.
    expect(mocks.frameProps.mock.calls[0]![0]).not.toHaveProperty("api");
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
  });

  it("follows a save-as copy by navigating to the document route the app layer gave it", async () => {
    await mount();
    (mocks.frameProps.mock.calls[0]![0] as { onSavedAs: (id: string) => void }).onSavedAs("copy-9");
    expect(mocks.push).toHaveBeenCalledWith("/acme/ops/documents/copy-9");
  });
});

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

const mocks = vi.hoisted(() => ({ switchProps: vi.fn(), frameProps: vi.fn() }));
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

const mount = () => act(async () => {
  root.render(createElement(DocxFrameOrG3Host, { document: doc, wsId: "ws-1", readonly: false, className: "c", fallback: createElement("b", { "data-testid": "g3" }) }));
});

describe("DocxFrameOrG3Host", () => {
  it("is the G3 editor alone, and asks no flag, when no frame build is pinned", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "");
    await mount();
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.switchProps).not.toHaveBeenCalled();
  });

  it("hands the switch the document's organization and the pinned version for the frame", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "0.1.0-abc1234");
    await mount();
    expect(mocks.switchProps.mock.calls[0]![0].organizationId).toBe("org-1");
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({
      wsId: "ws-1", documentId: "doc-1", title: "Spec", frameVersion: "0.1.0-abc1234", readonly: false, className: "c", api: expect.any(Object),
    }));
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
  });
});

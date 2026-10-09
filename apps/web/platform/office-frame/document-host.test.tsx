import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

// The app-layer wiring: the pin and the workspace routes are read here and
// handed to the browser-isolated document host as its docx slot.
const mocks = vi.hoisted(() => ({ frameProps: vi.fn(), loader: null as null | (() => Promise<unknown>) }));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    mocks.loader = loader;
    return (props: Record<string, unknown>) => { mocks.frameProps(props); return createElement("i", { "data-testid": "frame-switch" }); };
  },
}));
vi.mock("./docs-frame-host", () => ({ DocxFrameOrG3Host: "the frame switch" }));
vi.mock("@uniwork/views/layout/workspace-context", () => ({ useWorkspace: () => ({ workspace: { organization_slug: "acme", slug: "ops" } }) }));
vi.mock("../office/document-office-host", () => ({
  LoadingEditor: () => null,
  // The real host routes a .docx to the slot with the G3 host as fallback; the slot is what is under test.
  createDocumentOfficeEditorHost: (Slot: ComponentType<{ document: Document; fallback: ReactNode }>) =>
    (props: { document: Document }) => createElement(Slot, { ...props, fallback: createElement("b", { "data-testid": "g3" }) }),
}));

import { DocumentOfficeEditorHost } from "./document-host";

const doc = { id: "doc-1", title: "Spec", organization_id: "org-1", workspace_id: "ws-1" } as Document;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
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
  root.render(createElement(DocumentOfficeEditorHost, { document: doc, wsId: "ws-1", readonly: false }));
});

describe("DocumentOfficeEditorHost (app wiring)", () => {
  it("is the G3 editor alone, and mounts no frame switch, when no frame build is pinned", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "");
    await mount();
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.frameProps).not.toHaveBeenCalled();
  });

  it("hands the lazy frame switch the pinned version, the G3 fallback and this workspace's document route", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "0.1.0-abc1234");
    await mount();
    const props = mocks.frameProps.mock.calls[0]![0] as { frameVersion: string; documentHref: (id: string) => string; document: Document; fallback: unknown };
    expect(props.frameVersion).toBe("0.1.0-abc1234");
    expect(props.document).toBe(doc);
    expect(props.fallback).toBeTruthy();
    expect(props.documentHref("copy-9")).toBe("/acme/ops/documents/copy-9");
    await expect(mocks.loader!()).resolves.toBe("the frame switch");
  });
});

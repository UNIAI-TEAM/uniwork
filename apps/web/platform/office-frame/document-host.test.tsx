import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@uniwork/core/types/document";

// The app-layer wiring: the pins and the workspace routes are read here and
// handed to the browser-isolated document host as its frame slot.
const mocks = vi.hoisted(() => ({
  frameProps: vi.fn(),
  loaders: [] as Array<() => Promise<unknown>>,
  module: "docs",
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const index = mocks.loaders.push(loader) - 1;
    return (props: Record<string, unknown>) => { mocks.frameProps(index, props); return createElement("i", { "data-testid": index === 0 ? "docs-switch" : "module-switch" }); };
  },
}));
vi.mock("./docs-frame-host", () => ({ DocxFrameOrG3Host: "the docs switch" }));
vi.mock("./module-frame-host", () => ({ ModuleFrameOrG3Host: "the module switch" }));
vi.mock("@uniwork/views/layout/workspace-context", () => ({ useWorkspace: () => ({ workspace: { organization_slug: "acme", slug: "ops" } }) }));
vi.mock("../office/document-office-host", () => ({
  LoadingEditor: () => null,
  // The real host routes a document to the slot with its module and the G3 host as fallback; the slot is what is under test.
  createDocumentOfficeEditorHost: ({ Frame: Slot }: { Frame: ComponentType<{ document: Document; module: string; fallback: ReactNode }> }) =>
    (props: { document: Document }) => createElement(Slot, { ...props, module: mocks.module, fallback: createElement("b", { "data-testid": "g3" }) }),
}));

import { DocumentOfficeEditorHost } from "./document-host";

const doc = { id: "doc-1", title: "Spec", organization_id: "org-1", workspace_id: "ws-1" } as Document;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.frameProps.mockReset();
  mocks.module = "docs";
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
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", "");
    await mount();
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.frameProps).not.toHaveBeenCalled();
  });

  it("hands the lazy Docs switch the pinned version, the G3 fallback and this workspace's document route", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "0.1.0-abc1234");
    await mount();
    const [index, props] = mocks.frameProps.mock.calls[0]! as [number, { frameVersion: string; documentHref: (id: string) => string; document: Document; fallback: unknown }];
    expect(index).toBe(0);
    expect(props.frameVersion).toBe("0.1.0-abc1234");
    expect(props.document).toBe(doc);
    expect(props.fallback).toBeTruthy();
    expect(props.documentHref("copy-9")).toBe("/acme/ops/documents/copy-9");
    await expect(mocks.loaders[0]!()).resolves.toBe("the docs switch");
  });

  it.each(["pdf", "markdown", "html", "slides", "sheets"])("hands the %s module to the lazy module switch once its bundle is pinned", async (module) => {
    mocks.module = module;
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ [module]: "0.1.0-abc1234" }));
    await mount();
    const [index, props] = mocks.frameProps.mock.calls[0]! as [number, { module: string; document: Document; fallback: unknown }];
    expect(index).toBe(1);
    expect(props.module).toBe(module);
    expect(props.document).toBe(doc);
    expect(props.fallback).toBeTruthy();
    await expect(mocks.loaders[1]!()).resolves.toBe("the module switch");
  });

  it("keeps the G3 host of a module without a bundle, whatever else is installed", async () => {
    mocks.module = "pdf";
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "0.1.0-abc1234", slides: "0.1.0-abc1234" }));
    await mount();
    expect(container.querySelector('[data-testid="g3"]')).not.toBeNull();
    expect(mocks.frameProps).not.toHaveBeenCalled();
  });
});

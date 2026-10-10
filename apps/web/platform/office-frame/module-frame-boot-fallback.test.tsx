import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@uniwork/core/provider";
import type { Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "@uniwork/views/layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "@uniwork/views/navigation";

// Unlike module-frame-host.test.tsx the real OfficeModuleFrame runs here: only the transport is replaced,
// and the frame bundle's own request (the boot probe) answers an HTTP error.
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => mocks.request(...a),
}));

import { DocxFrameOrG3Host } from "./docs-frame-host";
import { ModuleFrameOrG3Host } from "./module-frame-host";

const doc = { id: "doc-1", title: "Deck", organization_id: "org-1", workspace_id: "ws-1" } as Document;
const workspace = { id: "ws-1", organization_slug: "acme", slug: "ops" } as Workspace;
const nav: NavigationAdapter = {
  push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/", searchParams: new URLSearchParams(), getShareableUrl: (p) => p,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  // The flag answers on; the token mint never answers, so only the bundle probe can end the boot.
  mocks.request.mockReset();
  mocks.request.mockImplementation((path: string) => (String(path).startsWith("/api/v1/config")
    ? Promise.resolve({ flags: { office_engine: true }, office_deployment_id: "dep-7" })
    : new Promise(() => undefined)));
  vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "1.0.0", pdf: "1.0.0", markdown: "1.0.0", html: "1.0.0", slides: "1.0.0", sheets: "1.0.0" }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
async function until(check: () => boolean) {
  for (let i = 0; i < 80 && !check(); i += 1) await settle();
}
const render = async (host: ReactNode) => {
  await act(async () => {
    root.render(
      <QueryProvider>
        <NavigationProvider value={nav}>
          <WorkspaceProvider workspace={workspace} user={{ id: "u-1" } as User}>{host}</WorkspaceProvider>
        </NavigationProvider>
      </QueryProvider>,
    );
  });
  await settle();
};
const fallback = createElement("b", { "data-testid": "g3" });
const g3 = () => container.querySelector('[data-testid="g3"]');

describe("a module whose frame bundle answers an HTTP error", () => {
  it.each(["pdf", "markdown", "html", "slides", "sheets"] as const)("%s falls back to the G3 host instead of staying on the loading skeleton", async (module) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 404 })));
    await render(createElement(ModuleFrameOrG3Host, { module, document: doc, wsId: "ws-1", readonly: false, fallback }));
    await until(() => g3() !== null);
    expect(g3()).not.toBeNull();
    expect(container.querySelector("[data-office-docs-frame]")).toBeNull();
    expect(container.querySelector('[data-testid="office-docs-frame-loading"]')).toBeNull();
    expect(fetch).toHaveBeenCalledWith(`/office-frame/${module}/1.0.0/index.html`, expect.anything());
  });

  it("docs falls back to the G3 editor the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 503 })));
    await render(createElement(DocxFrameOrG3Host, {
      document: doc, wsId: "ws-1", readonly: false, frameVersion: "1.0.0", documentHref: (id: string) => `/d/${id}`, fallback,
    }));
    await until(() => g3() !== null);
    expect(g3()).not.toBeNull();
    expect(container.querySelector('[data-testid="office-docs-frame-loading"]')).toBeNull();
  });

  it("keeps the frame mounted, still booting, while the bundle answers", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
    await render(createElement(ModuleFrameOrG3Host, { module: "slides", document: doc, wsId: "ws-1", readonly: false, fallback }));
    await until(() => container.querySelector("[data-office-docs-frame]") !== null);
    await settle();
    expect(container.querySelector("[data-office-docs-frame]")?.getAttribute("data-state")).toBe("booting");
    expect(g3()).toBeNull();
  });
});

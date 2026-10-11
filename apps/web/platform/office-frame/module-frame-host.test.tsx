import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@uniwork/core/provider";
import type { Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "@uniwork/views/layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "@uniwork/views/navigation";

// Only the transport and the heavy frame component are replaced: the real
// open switch, flag hook and config schema answer from the mocked request.
const mocks = vi.hoisted(() => ({
  request: vi.fn(), frameProps: vi.fn(), push: vi.fn(), downloadProfile: vi.fn(),
  // What the mocked frame tells the switch as it mounts: a size refusal, a load failure, or nothing.
  frameRefusal: { reason: undefined as "size" | "load" | undefined },
  createSession: vi.fn(), launch: vi.fn(), downloadFile: vi.fn(),
}));
vi.mock("@uniwork/core/api/endpoints/office-launch", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/office-launch")>()),
  createOfficeLaunchSession: (...a: unknown[]) => mocks.createSession(...a),
}));
vi.mock("../office/desktop-handoff", async (orig) => ({
  ...(await orig<typeof import("../office/desktop-handoff")>()),
  launchOfficeDeepLink: (...a: unknown[]) => mocks.launch(...a),
}));
vi.mock("@uniwork/core/api/endpoints/documents", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/documents")>()),
  downloadDocumentFile: (...a: unknown[]) => mocks.downloadFile(...a),
}));
vi.mock("@uniwork/core/api/endpoints/office-desktop", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/office-desktop")>()),
  getOfficeDesktopDownload: mocks.downloadProfile,
}));
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => mocks.request(...a),
}));
vi.mock("@uniwork/views/office", async (orig) => {
  const { useEffect } = await import("react");
  const { useDocsFrameRefusal } = await import("../../../../packages/views/office/frame/docs-frame-refusal");
  return {
    ...(await orig<typeof import("@uniwork/views/office")>()),
    OfficeModuleFrame: function MockFrame(props: Record<string, unknown>) {
      mocks.frameProps(props);
      const refuse = useDocsFrameRefusal();
      useEffect(() => { if (mocks.frameRefusal.reason) refuse?.(mocks.frameRefusal.reason); }, [refuse]);
      return createElement("i", { "data-testid": "frame" });
    },
  };
});

import { pinnedFrameVersion } from "./frame-versions";
import { ModuleFrameOrG3Host } from "./module-frame-host";

const doc = { id: "doc-1", title: "Deck", organization_id: "org-1", workspace_id: "ws-1" } as Document;
const workspace = { id: "ws-1", organization_slug: "acme", slug: "ops" } as Workspace;
const nav: NavigationAdapter = {
  push: mocks.push, replace: vi.fn(), back: vi.fn(), pathname: "/", searchParams: new URLSearchParams(), getShareableUrl: (p) => p,
};
let root: Root;
let container: HTMLDivElement;

/** The organization's public config (a healthy answer always carries office_engine): module flags and the deployment binding. */
function answerConfig(flags: Record<string, boolean>, officeInstallers?: Record<string, unknown[]>) {
  mocks.request.mockImplementation((path: string) => (path === "/api/v1/config?organization_id=org-1"
    ? Promise.resolve({ flags: { office_engine: true, ...flags }, office_deployment_id: "dep-7", ...(officeInstallers ? { office_installers: officeInstallers } : {}) })
    : Promise.reject(new Error(`unexpected ${path}`))));
}

const configCalls = () => mocks.request.mock.calls.filter(([path]) => String(path).startsWith("/api/v1/config"));

beforeEach(() => {
  mocks.request.mockReset();
  mocks.frameProps.mockReset();
  mocks.push.mockReset();
  mocks.frameRefusal.reason = undefined;
  mocks.createSession.mockReset();
  mocks.launch.mockReset();
  mocks.downloadFile.mockReset();
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

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

/** Lets the config query answer and the switch decide (a few macrotasks). */
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i += 1) await settle();
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

const host = (module: "slides" | "sheets" = "sheets", readonly = true, document: Document = doc) =>
  createElement(ModuleFrameOrG3Host, { module, document, wsId: "ws-1", readonly, className: "c", fallback: createElement("b", { "data-testid": "g3" }) });

const g3 = () => container.querySelector('[data-testid="g3"]');
const frame = () => container.querySelector('[data-testid="frame"]');

describe("ModuleFrameOrG3Host", () => {
  it("is the G3 host alone when the module has no installed bundle", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "1.0.0" }));
    answerConfig({ office_sheets_web: true });
    await render(host());
    expect(g3()).not.toBeNull();
    expect(configCalls()).toHaveLength(0);
  });

  it("opens the module's frame on the organization's flag, with its version and the desktop wiring", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: true });
    await render(host());
    await until(() => frame() !== null);
    expect(frame()).not.toBeNull();
    expect(g3()).toBeNull();
    await until(() => (mocks.frameProps.mock.calls.at(-1)?.[0] as { desktopOpen?: { deploymentId?: string } }).desktopOpen?.deploymentId !== undefined);
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({
      module: "sheets", wsId: "ws-1", documentId: "doc-1", title: "Deck", frameVersion: "0.2.0-abc1234", readonly: true, className: "c",
    }));
    // "Open in desktop app": the G3 wiring, with the organization's deployment binding once config answers.
    const last = mocks.frameProps.mock.calls.at(-1)![0] as { desktopOpen: { deploymentId?: string; channel?: string; launch?: unknown; loadInstallers?: unknown } };
    expect(last.desktopOpen).toMatchObject({ deploymentId: "dep-7", channel: "stable" });
    expect(last.desktopOpen.launch).toBeTypeOf("function");
    expect(last.desktopOpen.loadInstallers).toBeTypeOf("function");
    (mocks.frameProps.mock.calls[0]![0] as { onSavedAs: (id: string) => void }).onSavedAs("copy-9");
    expect(mocks.push).toHaveBeenCalledWith("/acme/ops/documents/copy-9");
  });

  describe("installer channel of the desktop open action", () => {
    const row = (channel: string) => ({ platform: "win32-x64", kind: ".exe", url: `https://dl.example/${channel}/UniWork-Office.exe` });
    const loadInstallers = async (officeInstallers: Record<string, unknown[]>) => {
      vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
      answerConfig({ office_sheets_web: true }, officeInstallers);
      mocks.downloadProfile.mockResolvedValue({ installers: [], supported_platforms: ["win32-x64"] });
      await render(host());
      await until(() => (mocks.frameProps.mock.calls.at(-1)?.[0] as { desktopOpen?: { channel?: string } } | undefined)?.desktopOpen?.channel !== undefined && mocks.request.mock.calls.length > 0);
      await settle();
      const last = mocks.frameProps.mock.calls.at(-1)![0] as { desktopOpen: { channel: string; loadInstallers: () => Promise<unknown> } };
      await act(async () => { await last.desktopOpen.loadInstallers(); });
      return last.desktopOpen.channel;
    };

    it("lists the dev installers when only the dev channel publishes one", async () => {
      expect(await loadInstallers({ dev: [row("dev")], beta: [], stable: [] })).toBe("dev");
      expect(mocks.downloadProfile).toHaveBeenCalledWith("org-1", "dev");
    });

    it("prefers stable when stable publishes an installer", async () => {
      expect(await loadInstallers({ dev: [row("dev")], beta: [], stable: [row("stable")] })).toBe("stable");
      expect(mocks.downloadProfile).toHaveBeenCalledWith("org-1", "stable");
    });
  });

  it("keeps the G3 host when the module's own flag is overridden off, whatever the other modules say", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: false, office_docs_web: true, office_slides_web: true });
    await render(host());
    await until(() => g3() !== null);
    expect(g3()).not.toBeNull();
    expect(frame()).toBeNull();
  });

  describe("a workbook above the Sheets cap", () => {
    const ticket = `ticket_${"a".repeat(32)}`;
    const session = { launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}`, expires_at: "2026-10-01T00:00:00Z", document_id: "doc-1", operation: "edit" as const, version: 2 };
    const big = { ...doc, current_version: 2, file: { size_bytes: 10 * 1024 * 1024 + 1, filename: "big.xlsx" } } as Document;
    const tooLargeNotice = () => container.querySelector('[data-testid="office-too-large"]');
    const buttonByText = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
    const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await settle(); };

    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
      answerConfig({ office_sheets_web: true });
    });

    const expectNoEditor = () => {
      expect(g3()).toBeNull();
      expect(frame()).toBeNull();
      expect(container.querySelector('[data-testid="office-frame-fallback-notice"]')).toBeNull();
      expect(tooLargeNotice()?.textContent).toContain("File is too large to edit on the web");
    };

    it("shows the open-in-the-app notice, not the G3 xlsx editor, on the stored-size pre-check, without asking for a token", async () => {
      await render(host("sheets", false, big));
      expectNoEditor();
      // Only the public config (for the launch deployment) is read; no frame mounts, so no token is asked.
      expect(mocks.request.mock.calls.every(([path]) => String(path).startsWith("/api/v1/config"))).toBe(true);
      expect(mocks.frameProps).not.toHaveBeenCalled();
      expect(buttonByText("Open in UniWork Office")).toBeDefined();
      expect(buttonByText("Download")).toBeDefined();
    });

    it("shows the same notice when the frame reports the worksheet gate (too_large)", async () => {
      mocks.frameRefusal.reason = "size";
      await render(host("sheets", false, { ...doc, file: { size_bytes: 2048 } } as Document));
      await until(() => tooLargeNotice() !== null);
      expect(mocks.frameProps).toHaveBeenCalled();
      expectNoEditor();
    });

    it("keeps the G3 editor for a frame that did not load, and says so", async () => {
      mocks.frameRefusal.reason = "load";
      await render(host("sheets", false, { ...doc, file: { size_bytes: 2048 } } as Document));
      await until(() => g3() !== null);
      expect(g3()).not.toBeNull();
      expect(tooLargeNotice()).toBeNull();
      expect(container.querySelector('[data-testid="office-frame-fallback-notice"]')?.getAttribute("data-reason")).toBe("load");
    });

    it("keeps the primary button on the launch-ticket path, and the installer prompt when the app is missing", async () => {
      mocks.createSession.mockResolvedValue(session);
      mocks.launch.mockResolvedValue("not-installed");
      mocks.downloadProfile.mockResolvedValue({ installers: [], supported_platforms: ["win32-x64"] });
      await render(host("sheets", false, big));
      await until(() => buttonByText("Open in UniWork Office") !== undefined);
      // The deployment binding arrives with the public config.
      await until(() => configCalls().length > 0);
      await settle();
      await click(buttonByText("Open in UniWork Office"));
      await until(() => mocks.launch.mock.calls.length > 0);
      expect(mocks.createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({ operation: "edit", deployment_id: "dep-7" }));
      expect(mocks.launch).toHaveBeenCalledWith(`uniwork-office://open?ticket=${ticket}`);
      await until(() => mocks.downloadProfile.mock.calls.length > 0);
      expect(mocks.downloadProfile).toHaveBeenCalledWith("org-1", "stable");
    });

    it("downloads the file itself with the secondary button", async () => {
      mocks.downloadFile.mockResolvedValue(new Blob(["x"]));
      const createObjectURL = vi.fn(() => "blob:big");
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      await render(host("sheets", false, big));
      await click(buttonByText("Download"));
      expect(mocks.downloadFile).toHaveBeenCalledWith("doc-1");
      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClick).toHaveBeenCalled();
      anchorClick.mockRestore();
    });

    it("offers a view-only user the download alone", async () => {
      await render(host("sheets", true, big));
      expectNoEditor();
      expect(buttonByText("Open in UniWork Office")).toBeUndefined();
      expect(buttonByText("Download")).toBeDefined();
    });
  });

  it("says nothing for a workbook under the cap", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: false });
    await render(host("sheets", false, { ...doc, file: { size_bytes: 1024 } } as Document));
    await until(() => g3() !== null);
    expect(container.querySelector('[data-testid="office-frame-fallback-notice"]')).toBeNull();
  });

  it("keeps a view-only slides user on the G3 pptx host, and an editor on the frame", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ slides: "0.2.0-abc1234" }));
    answerConfig({ office_slides_web: true });
    await render(host("slides", true));
    expect(g3()).not.toBeNull();
    expect(configCalls()).toHaveLength(0);
    await render(host("slides", false));
    await until(() => frame() !== null);
    expect(frame()).not.toBeNull();
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({ module: "slides" }));
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

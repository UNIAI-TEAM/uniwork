import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@uniwork/core/provider";
import type { Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "@uniwork/views/layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "@uniwork/views/navigation";

// Only the transport and the heavy frame component are replaced: the real
// open switch, flag hook, failure surface and config schema answer from the mocked request.
const mocks = vi.hoisted(() => ({
  request: vi.fn(), frameProps: vi.fn(), push: vi.fn(), downloadProfile: vi.fn(),
  // What the mocked frame does as it mounts: report the size cap, fail to load, or open.
  frameOutcome: { kind: undefined as "size" | "load" | undefined },
  createSession: vi.fn(), launch: vi.fn(), downloadFile: vi.fn(), retry: vi.fn(),
}));
vi.mock("@uniwork/core/api/endpoints/office-launch", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/office-launch")>()),
  createOfficeLaunchSession: (...a: unknown[]) => mocks.createSession(...a),
}));
vi.mock("./desktop-handoff", async (orig) => ({
  ...(await orig<typeof import("./desktop-handoff")>()),
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
  const { DocsFrameFailure } = await import("../../../../packages/views/office/frame/docs-frame-failure");
  return {
    ...(await orig<typeof import("@uniwork/views/office")>()),
    OfficeModuleFrame: function MockFrame(props: Record<string, unknown>) {
      mocks.frameProps(props);
      const refuse = useDocsFrameRefusal();
      useEffect(() => { if (mocks.frameOutcome.kind === "size") refuse?.(); }, [refuse]);
      // The real frame's failed state for a bundle that never loaded.
      if (mocks.frameOutcome.kind === "load") {
        return createElement(DocsFrameFailure, {
          failure: { code: "network", message: "bundle", details: { frameBundle: "404" } },
          code: "network",
          onRetry: mocks.retry,
          module: String(props.module),
        });
      }
      return createElement("i", { "data-testid": "frame" });
    },
  };
});

import { pinnedFrameVersion } from "./frame-versions";
import { OfficeModuleHost } from "./module-frame-host";

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
  mocks.frameOutcome.kind = undefined;
  mocks.createSession.mockReset();
  mocks.launch.mockReset();
  mocks.downloadFile.mockReset();
  mocks.retry.mockReset();
  nav.searchParams.delete("comment");
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

const host = (module: "docs" | "slides" | "sheets" = "sheets", readonly = true, document: Document = doc) =>
  createElement(OfficeModuleHost, { module, document, wsId: "ws-1", readonly, className: "c" });

const frame = () => container.querySelector('[data-testid="frame"]');
const failed = () => container.querySelector('[data-testid="office-docs-frame-failed"]');
const tooLargeNotice = () => container.querySelector('[data-testid="office-too-large"]');
const buttonByText = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await settle(); };

describe("OfficeModuleHost", () => {
  it("says the web editor is not set up, with open-in-app and download, when the module has no installed bundle", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ docs: "1.0.0" }));
    answerConfig({ office_sheets_web: true });
    await render(host("sheets", false));
    await until(() => buttonByText("Open in UniWork Office") !== undefined);
    expect(frame()).toBeNull();
    expect(failed()?.getAttribute("data-failure-kind")).toBe("unavailable");
    expect(failed()?.textContent).toContain("This UniWork server is not set up to open documents on the web.");
    expect(buttonByText("Download")).toBeDefined();
    // Nothing a retry could change: no Retry button.
    expect(buttonByText("Try again")).toBeUndefined();
  });

  it("opens the module's frame on the organization's flag, with its version and the desktop wiring", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: true });
    await render(host());
    await until(() => frame() !== null);
    expect(frame()).not.toBeNull();
    expect(failed()).toBeNull();
    await until(() => (mocks.frameProps.mock.calls.at(-1)?.[0] as { desktopOpen?: { deploymentId?: string } }).desktopOpen?.deploymentId !== undefined);
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({
      module: "sheets", wsId: "ws-1", documentId: "doc-1", title: "Deck", frameVersion: "0.2.0-abc1234", readonly: true, className: "c",
    }));
    // "Open in desktop app", with the organization's deployment binding once config answers.
    const last = mocks.frameProps.mock.calls.at(-1)![0] as { desktopOpen: { deploymentId?: string; channel?: string; launch?: unknown; loadInstallers?: unknown } };
    expect(last.desktopOpen).toMatchObject({ deploymentId: "dep-7", channel: "stable" });
    expect(last.desktopOpen.launch).toBeTypeOf("function");
    expect(last.desktopOpen.loadInstallers).toBeTypeOf("function");
    (mocks.frameProps.mock.calls[0]![0] as { onSavedAs: (id: string) => void }).onSavedAs("copy-9");
    expect(mocks.push).toHaveBeenCalledWith("/acme/ops/documents/copy-9");
  });

  it("opens a .docx in the Docs frame and follows Save as to the copy", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION", "1.0.0-abc1234");
    answerConfig({ office_docs_web: true });
    await render(host("docs", false));
    await until(() => frame() !== null);
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({ module: "docs", frameVersion: "1.0.0-abc1234", readonly: false }));
    (mocks.frameProps.mock.calls[0]![0] as { onSavedAs: (id: string) => void }).onSavedAs("copy-3");
    expect(mocks.push).toHaveBeenCalledWith("/acme/ops/documents/copy-3");
  });

  it("opens the slides frame for a view-only user too, readonly", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ slides: "0.2.0-abc1234" }));
    answerConfig({ office_slides_web: true });
    await render(host("slides", true));
    await until(() => frame() !== null);
    expect(mocks.frameProps).toHaveBeenCalledWith(expect.objectContaining({ module: "slides", readonly: true }));
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

  it("shows the unavailable notice, not the frame, when the module's own flag is overridden off", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: false, office_docs_web: true, office_slides_web: true });
    await render(host("sheets", false));
    await until(() => failed() !== null);
    expect(frame()).toBeNull();
    expect(failed()?.getAttribute("data-failure-kind")).toBe("unavailable");
    expect(failed()?.textContent).toContain("Your organization has not turned on opening this file type on the web.");
    expect(buttonByText("Download")).toBeDefined();
  });

  it("shows a frame that did not load as its error, with Retry, open-in-app and download", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: true });
    mocks.frameOutcome.kind = "load";
    await render(host("sheets", false, { ...doc, file: { size_bytes: 2048 } } as Document));
    await until(() => failed() !== null && buttonByText("Open in UniWork Office") !== undefined);
    expect(tooLargeNotice()).toBeNull();
    expect(failed()?.getAttribute("data-failure-kind")).toBe("load");
    expect(failed()?.textContent).toContain("Try again, open the file in UniWork Office, or download it.");
    expect(buttonByText("Download")).toBeDefined();
    await click(buttonByText("Try again"));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });

  it("offers a view-only user of a failed frame Retry and the download, not the app", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: true });
    mocks.frameOutcome.kind = "load";
    await render(host("sheets", true, { ...doc, file: { size_bytes: 2048 } } as Document));
    await until(() => failed() !== null);
    expect(buttonByText("Try again")).toBeDefined();
    expect(buttonByText("Download")).toBeDefined();
    expect(buttonByText("Open in UniWork Office")).toBeUndefined();
  });

  it("opens a workbook under the cap in the frame, with no notice", async () => {
    vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
    answerConfig({ office_sheets_web: true });
    await render(host("sheets", false, { ...doc, file: { size_bytes: 1024 } } as Document));
    await until(() => frame() !== null);
    expect(tooLargeNotice()).toBeNull();
    expect(failed()).toBeNull();
  });

  describe("a workbook above 10 MiB and the Sheets worksheet gate (BENCH-01 #2)", () => {
    const ticket = `ticket_${"a".repeat(32)}`;
    const session = { launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}`, expires_at: "2026-10-01T00:00:00Z", document_id: "doc-1", operation: "edit" as const, version: 2 };
    const big = { ...doc, current_version: 2, file: { size_bytes: 10 * 1024 * 1024 + 1, filename: "big.xlsx" } } as Document;

    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_OFFICE_FRAME_VERSIONS", JSON.stringify({ sheets: "0.2.0-abc1234" }));
      answerConfig({ office_sheets_web: true });
      mocks.frameOutcome.kind = "size";
    });

    const expectNoEditor = () => {
      expect(frame()).toBeNull();
      expect(failed()).toBeNull();
      expect(tooLargeNotice()?.textContent).toContain("File is too large to edit on the web");
    };

    it("opens a workbook over 10 MiB of stored xlsx in the frame (no stored-size pre-check block)", async () => {
      mocks.frameOutcome.kind = undefined;
      await render(host("sheets", false, big));
      await until(() => frame() !== null);
      expect(tooLargeNotice()).toBeNull();
      expect(failed()).toBeNull();
      expect(mocks.frameProps).toHaveBeenCalled();
    });

    it("shows the open-in-the-app notice when the frame reports the worksheet gate (too_large)", async () => {
      await render(host("sheets", false, { ...doc, file: { size_bytes: 2048 } } as Document));
      await until(() => tooLargeNotice() !== null);
      expect(mocks.frameProps).toHaveBeenCalled();
      expectNoEditor();
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
      expect(mocks.launch).toHaveBeenCalledWith(`uniwork-office://open?ticket=${ticket}`, expect.anything());
      await until(() => mocks.downloadProfile.mock.calls.length > 0);
      expect(mocks.downloadProfile).toHaveBeenCalledWith("org-1", "stable");
    });

    // S15 desktop: a page opened from the Inbox hands its comment to the app with the ticket.
    it.each([
      ["c_01JABCDEF", { comment_id: "c_01JABCDEF" }],
      ["not an id", {}],
    ])("sends ?comment=%s with the launch ticket only when it is an id", async (comment, extra) => {
      nav.searchParams.set("comment", comment);
      mocks.createSession.mockResolvedValue(session);
      mocks.launch.mockResolvedValue("launched");
      await render(host("sheets", false, big));
      await until(() => buttonByText("Open in UniWork Office") !== undefined);
      await until(() => configCalls().length > 0);
      await settle();
      await click(buttonByText("Open in UniWork Office"));
      await until(() => mocks.createSession.mock.calls.length > 0);
      expect(mocks.createSession).toHaveBeenCalledWith("doc-1", {
        operation: "edit", deployment_id: "dep-7", client_id: "uniwork-office", return_hint: "office", ...extra,
      });
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

import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { DocumentShareScope, DocumentTreeNode } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { CreateMenu, QuickCreateRow } from "./documents-home-create";
import { DocumentsPageView } from "./documents-page-view";

// review_fe r1 (UNI-1784 fe-fix-1) for the create toggle: F-W2-01 (menu toggle
// -> Folder dialog), F-W2-02 (options always passed), F-W2-03 (no level on the
// wire), F-W2-09 (hint markup) and F-W2-10 (the listed missing tests).

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const PRIVATE_SCOPE: DocumentShareScope = { home_workspace: false, users: 0, workspaces: 0, organization: false, public_link: false };

// Read at call time: the locale only switches to the session's vi once a view renders.
const toggleLabel = () => t("documents.home.create.share_workspace_toggle");
const hintText = () =>
  t("documents.home.create.share_workspace_hint", {
    level: t("documents.home.create.share_workspace_level_view"),
  });

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("create toggle: options always reach onCreate (F-W2-02)", () => {
  it("QuickCreateRow hands the options to a wrapped handler whose arity is not 2", () => {
    const spy = vi.fn();
    // Arity 0: the old `onCreate.length <= 2` check would still pass; a bound
    // handler (length 1) or a default-param one (length 1) used to lose them.
    const wrapped = (...args: unknown[]) => spy(...args);
    const bound = (spy as unknown as (...a: unknown[]) => void).bind(null);
    render(
      wrap(
        <>
          <QuickCreateRow pending={false} unavailable={new Set()} onCreate={wrapped as never} />
          <CreateMenu pending={false} unavailable={new Set()} onCreate={bound as never} onUpload={vi.fn()} />
        </>,
      ),
    );

    fireEvent.click(screen.getByRole("switch", { name: toggleLabel() }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.xlsx.chip") }));
    expect(spy).toHaveBeenLastCalledWith("xlsx", { shareWithWorkspace: true });
  });

  it("CreateMenu hands the options to a bound handler", async () => {
    const spy = vi.fn();
    render(
      wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={spy.bind(null)} onUpload={vi.fn()} />),
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: toggleLabel() }));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.docx.menu")) }));
    expect(spy).toHaveBeenLastCalledWith("docx", { shareWithWorkspace: true });
  });
});

describe("create toggle: QuickCreateRow under a shared parent (F-W2-10)", () => {
  it("locks the switch on with the inherited hint and sends no share", () => {
    const onCreate = vi.fn();
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} parentShared onCreate={onCreate} />));

    const toggle = screen.getByRole("switch", { name: toggleLabel() });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    const hint = screen.getByText(t("documents.home.create.share_workspace_inherited"));
    expect(toggle).toHaveAttribute("aria-describedby", hint.id);

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.page.chip") }));
    expect(onCreate).toHaveBeenLastCalledWith("page", { shareWithWorkspace: false });
  });
});

describe("create toggle hint markup (F-W2-09)", () => {
  it("QuickCreateRow keeps one polite status line mounted, so the pills do not move or go unannounced", () => {
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} onCreate={vi.fn()} />));
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("switch", { name: toggleLabel() }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent(hintText());
  });

  it("one shared shareToggle keeps the strip switch and the menu check in sync (TV1-15)", async () => {
    function Harness() {
      const [shareWithWorkspace, setShareWithWorkspace] = useState(false);
      const shareToggle = { shareWithWorkspace, setShareWithWorkspace };
      return (
        <>
          <QuickCreateRow pending={false} unavailable={new Set()} shareToggle={shareToggle} onCreate={vi.fn()} />
          <CreateMenu pending={false} unavailable={new Set()} shareToggle={shareToggle} onCreate={vi.fn()} onUpload={vi.fn()} />
        </>
      );
    }
    render(wrap(<Harness />));

    // Turning the strip switch on shows the menu item checked too.
    fireEvent.click(screen.getByRole("switch", { name: toggleLabel() }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    expect(await screen.findByRole("menuitemcheckbox", { name: toggleLabel() })).toHaveAttribute("aria-checked", "true");

    // Unchecking from the menu flips the strip switch back off, even after the
    // menu closes and reopens — the label never shows two different states.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: toggleLabel() }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("switch", { name: toggleLabel() })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    expect(await screen.findByRole("menuitemcheckbox", { name: toggleLabel() })).toHaveAttribute("aria-checked", "false");
  });

  it("CreateMenu puts the hint inside the checkbox item, where aria-describedby points, as a status", async () => {
    render(wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    const item = await screen.findByRole("menuitemcheckbox", { name: toggleLabel() });
    fireEvent.click(item);

    const hint = within(item).getByText(hintText());
    expect(hint).toHaveAttribute("role", "status");
    expect(item).toHaveAttribute("aria-describedby", hint.id);
    // The name stays the toggle label; the hint is a description, not part of it.
    expect(screen.getByRole("menuitemcheckbox", { name: toggleLabel() })).toBe(item);
  });
});

describe("create toggle through the library page (F-W2-01, F-W2-03, F-W2-10)", () => {
  const tree: DocumentTreeNode[] = [
    { id: "fo-priv", title: "Riêng tư", kind: "folder", parent_id: null, position: 0, share_scope: PRIVATE_SCOPE, children: [] },
  ];

  function serve(posts: Array<{ path: string; body: unknown }>) {
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { documents: true }, rum_sample_rate: 0 });
      if (path === "/api/v1/documents/limits") return Promise.resolve({ upload_max_bytes: 25 * 1024 * 1024 });
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: tree });
      if (path === "/api/v1/documents/fo-priv") {
        return Promise.resolve({
          document: {
            id: "fo-priv",
            workspace_id: WS,
            kind: "folder",
            title: "Riêng tư",
            visibility: "restricted",
            revision: "1",
            my_level: "manage",
            breadcrumbs: [{ id: "fo-priv", title: "Riêng tư" }],
          },
        });
      }
      if (opts?.method === "POST") {
        posts.push({ path, body: opts.body });
        const kind = path === LIST_BASE && (opts.body as { kind?: string })?.kind === "folder" ? "folder" : "page";
        return Promise.resolve({
          document: { id: "created-1", workspace_id: WS, kind, title: "Mới", revision: "1", my_level: "manage" },
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });
  }

  function renderPage() {
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    return render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        fakeNav("/acme/doi/documents?folder=fo-priv"),
      ),
    );
  }

  it("creates a folder with no visibility even when the menu's toggle is on, and the dialog has no toggle", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    serve(posts);
    renderPage();
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: toggleLabel() }));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.folder.menu")) }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("switch")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(t("documents.home.folders.rename_label")), {
      target: { value: "Thư mục riêng" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: LIST_BASE,
      body: { kind: "folder", title: "Thư mục riêng", parent_id: "fo-priv" },
    });
  });

  it("uploads with the toggle on as multipart visibility=workspace and no workspace_level", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    serve(posts);
    renderPage();
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.home.create.upload.button") })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: toggleLabel() }));
    const picked = new File(["hello"], "Spec.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [picked] } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(posts.some((p) => p.path === `${LIST_BASE}/files`)).toBe(true));
    const form = posts.find((p) => p.path === `${LIST_BASE}/files`)!.body as FormData;
    expect(form.get("visibility")).toBe("workspace");
    expect(form.get("parent_id")).toBe("fo-priv");
    expect(form.has("workspace_level")).toBe(false);
  });
});

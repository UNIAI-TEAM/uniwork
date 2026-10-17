import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { DocumentShareScope, DocumentTreeNode } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { CreateMenu, QuickCreateRow } from "./documents-home-create";
import { DocumentsPageView } from "./documents-page-view";
import { FolderNameDialog } from "./folder-name-dialog";

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

const PRIVATE_SCOPE: DocumentShareScope = {
  home_workspace: false,
  users: 0,
  workspaces: 0,
  organization: false,
  public_link: false,
};

const WORKSPACE_SCOPE: DocumentShareScope = {
  home_workspace: true,
  users: 0,
  workspaces: 0,
  organization: false,
  public_link: false,
};

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("Create workspace share toggle (§4, F-01)", () => {
  it("QuickCreateRow: defaults off, shows hint when turned on, forwards shareWithWorkspace, and resets after create", () => {
    const onCreate = vi.fn();
    render(
      wrap(
        <QuickCreateRow
          pending={false}
          unavailable={new Set()}
          onCreate={onCreate}
        />,
      ),
    );

    const toggle = screen.getByRole("switch", { name: t("documents.home.create.share_workspace_toggle") });
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(toggle).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText(
        t("documents.home.create.share_workspace_hint", {
          level: t("documents.home.create.share_workspace_level_view"),
        }),
      ),
    ).toBeNull();

    // Create while off -> 1-arg call without shareWithWorkspace.
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.page.chip") }));
    expect(onCreate).toHaveBeenLastCalledWith("page");

    // Turn on -> shows hint linked via aria-describedby.
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    const hintText = t("documents.home.create.share_workspace_hint", {
      level: t("documents.home.create.share_workspace_level_view"),
    });
    const hint = screen.getByText(hintText);
    expect(hint.id).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-describedby", hint.id);

    // Clicking a pill forwards { shareWithWorkspace: true } and resets toggle to off.
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.docx.chip") }));
    expect(onCreate).toHaveBeenLastCalledWith("docx", { shareWithWorkspace: true });
    expect(toggle).not.toBeChecked();
  });

  it("CreateMenu: defaults off every open, stays open on toggle (menuitemcheckbox), and locks on under a shared parent", async () => {
    const onCreate = vi.fn();
    const { unmount } = render(
      wrap(
        <CreateMenu
          pending={false}
          unavailable={new Set()}
          onCreate={onCreate}
          onUpload={vi.fn()}
        />,
      ),
    );

    const trigger = screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) });
    fireEvent.click(trigger);

    const item = await screen.findByRole("menuitemcheckbox", {
      name: t("documents.home.create.share_workspace_toggle"),
    });
    expect(item).toHaveAttribute("aria-checked", "false");
    expect(item).not.toHaveAttribute("aria-disabled");

    // Toggling keeps the menu open and links the hint via aria-describedby.
    fireEvent.click(item);
    expect(item).toHaveAttribute("aria-checked", "true");
    const hintText = t("documents.home.create.share_workspace_hint", {
      level: t("documents.home.create.share_workspace_level_view"),
    });
    const hint = screen.getByText(hintText);
    expect(item).toHaveAttribute("aria-describedby", hint.id);

    // Close and reopen -> resets to unchecked.
    fireEvent.keyDown(item, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitemcheckbox")).toBeNull());
    fireEvent.click(trigger);
    const reopened = await screen.findByRole("menuitemcheckbox", {
      name: t("documents.home.create.share_workspace_toggle"),
    });
    expect(reopened).toHaveAttribute("aria-checked", "false");

    // Turn on and pick a create item -> forwards { shareWithWorkspace: true }.
    fireEvent.click(reopened);
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) }));
    expect(onCreate).toHaveBeenLastCalledWith("page", { shareWithWorkspace: true });
    unmount();

    // Under a shared parent -> locked on with inherited hint, and does not send shareWithWorkspace.
    const onCreateShared = vi.fn();
    render(
      wrap(
        <CreateMenu
          pending={false}
          unavailable={new Set()}
          parentShared
          onCreate={onCreateShared}
          onUpload={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    const lockedItem = await screen.findByRole("menuitemcheckbox", {
      name: t("documents.home.create.share_workspace_toggle"),
    });
    expect(lockedItem).toHaveAttribute("aria-checked", "true");
    expect(lockedItem).toHaveAttribute("aria-disabled", "true");
    const inheritedHint = screen.getByText(t("documents.home.create.share_workspace_inherited"));
    expect(lockedItem).toHaveAttribute("aria-describedby", inheritedHint.id);

    // Clicking locked item does not uncheck it.
    fireEvent.click(lockedItem);
    expect(lockedItem).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.xlsx.menu")) }));
    expect(onCreateShared).toHaveBeenLastCalledWith("xlsx");
  });

  it("DocumentUploadDialog: resets toggle on open, forwards shareWithWorkspace when turned on, locks under shared parent, and hides when showShareToggle=false", async () => {
    const onSubmit = vi.fn();
    const { rerender, unmount } = render(
      wrap(
        <DocumentUploadDialog
          open
          onOpenChange={vi.fn()}
          title="Tải lên"
          description="Chọn tệp"
          onSubmit={onSubmit}
        />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("switch", { name: t("documents.home.create.share_workspace_toggle") });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    const hint = within(dialog).getByText(
      t("documents.home.create.share_workspace_hint", {
        level: t("documents.home.create.share_workspace_level_view"),
      }),
    );
    expect(toggle).toHaveAttribute("aria-describedby", hint.id);

    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const picked = new File(["hello"], "Spec.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(fileInput, { target: { files: [picked] } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.submit") }));
    expect(onSubmit).toHaveBeenLastCalledWith(picked, { shareWithWorkspace: true });

    // Reopening resets the switch to off.
    rerender(
      wrap(
        <DocumentUploadDialog
          open={false}
          onOpenChange={vi.fn()}
          title="Tải lên"
          description="Chọn tệp"
          onSubmit={onSubmit}
        />,
      ),
    );
    rerender(
      wrap(
        <DocumentUploadDialog
          open
          onOpenChange={vi.fn()}
          title="Tải lên"
          description="Chọn tệp"
          onSubmit={onSubmit}
        />,
      ),
    );
    const resetDialog = await screen.findByRole("dialog");
    expect(
      within(resetDialog).getByRole("switch", { name: t("documents.home.create.share_workspace_toggle") }),
    ).not.toBeChecked();
    unmount();

    // showShareToggle={false} hides the switch (version upload).
    render(
      wrap(
        <DocumentUploadDialog
          open
          onOpenChange={vi.fn()}
          title="Phiên bản mới"
          description="Chọn tệp"
          showShareToggle={false}
          onSubmit={vi.fn()}
        />,
      ),
    );
    const versionDialog = await screen.findByRole("dialog");
    expect(
      within(versionDialog).queryByRole("switch", { name: t("documents.home.create.share_workspace_toggle") }),
    ).toBeNull();
  });

  it("FolderNameDialog: sends visibility=workspace & workspace_level=view when toggled on in create mode, locks under shared parent, and hides in rename mode", async () => {
    const posts: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === LIST_BASE && opts?.method === "POST") {
        posts.push(opts.body);
        return Promise.resolve({
          document: {
            id: "fo-new",
            workspace_id: WS,
            kind: "folder",
            title: "Tài liệu chung",
            revision: "1",
            my_level: "manage",
          },
        });
      }
      return Promise.resolve({});
    });

    const { unmount } = render(
      wrap(
        <FolderNameDialog
          open
          onOpenChange={vi.fn()}
          mode="create"
          wsId={WS}
          parentId="fo-priv"
          parentShared={false}
          parentTitle="Thư mục riêng"
        />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("switch", { name: t("documents.home.create.share_workspace_toggle") });
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toHaveAttribute("aria-disabled");

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    const hint = within(dialog).getByText(
      t("documents.home.create.share_workspace_hint", {
        level: t("documents.home.create.share_workspace_level_view"),
      }),
    );
    expect(toggle).toHaveAttribute("aria-describedby", hint.id);

    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Tài liệu chung" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(posts[0]).toEqual({
        kind: "folder",
        title: "Tài liệu chung",
        parent_id: "fo-priv",
        visibility: "workspace",
        workspace_level: "view",
      }),
    );
    unmount();

    // Under a shared parent -> locked on, omits visibility so server inherits.
    posts.length = 0;
    const sharedRender = render(
      wrap(
        <FolderNameDialog
          open
          onOpenChange={vi.fn()}
          mode="create"
          wsId={WS}
          parentId="fo-shared"
          parentShared
          parentTitle="Thư mục chung"
        />,
      ),
    );
    const sharedDialog = await screen.findByRole("dialog");
    const lockedSwitch = within(sharedDialog).getByRole("switch", {
      name: t("documents.home.create.share_workspace_toggle"),
    });
    expect(lockedSwitch).toBeChecked();
    expect(lockedSwitch).toHaveAttribute("aria-disabled", "true");
    const inheritedHint = within(sharedDialog).getByText(t("documents.home.create.share_workspace_inherited"));
    expect(lockedSwitch).toHaveAttribute("aria-describedby", inheritedHint.id);

    fireEvent.change(within(sharedDialog).getByLabelText(t("documents.home.folders.rename_label")), {
      target: { value: "Con kế thừa" },
    });
    fireEvent.click(within(sharedDialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));
    await waitFor(() =>
      expect(posts[0]).toEqual({
        kind: "folder",
        title: "Con kế thừa",
        parent_id: "fo-shared",
      }),
    );
    sharedRender.unmount();

    // Rename mode -> no toggle.
    render(
      wrap(
        <FolderNameDialog
          open
          onOpenChange={vi.fn()}
          mode="rename"
          wsId={WS}
          folderId="fo-shared"
          initialName="Đổi tên"
        />,
      ),
    );
    const renameDialog = await screen.findByRole("dialog");
    expect(
      within(renameDialog).queryByRole("switch", { name: t("documents.home.create.share_workspace_toggle") }),
    ).toBeNull();
  });

  it("DocumentsPageView: sends visibility=workspace & workspace_level=view when creating at root or inside a private folder with the toggle on, and fires no restricted toast", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const tree: DocumentTreeNode[] = [
      {
        id: "fo-priv",
        title: "Riêng tư",
        kind: "folder",
        parent_id: null,
        position: 0,
        share_scope: PRIVATE_SCOPE,
        children: [],
      },
      {
        id: "fo-ws",
        title: "Chung workspace",
        kind: "folder",
        parent_id: null,
        position: 1,
        share_scope: WORKSPACE_SCOPE,
        children: [],
      },
    ];

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
      if (path === "/api/v1/documents/fo-ws") {
        return Promise.resolve({
          document: {
            id: "fo-ws",
            workspace_id: WS,
            kind: "folder",
            title: "Chung workspace",
            visibility: "workspace",
            revision: "1",
            my_level: "manage",
            breadcrumbs: [{ id: "fo-ws", title: "Chung workspace" }],
          },
        });
      }
      if (opts?.method === "POST") {
        posts.push({ path, body: opts.body });
        return Promise.resolve({
          document: {
            id: "created-1",
            workspace_id: WS,
            kind: "page",
            title: "Tài liệu mới",
            revision: "1",
            my_level: "manage",
          },
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const onOpen = vi.fn();
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    const nav = fakeNav("/acme/doi/documents?folder=fo-priv");
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        nav,
      ),
    );

    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    // Inside private folder fo-priv: CreateMenu toggle starts off, can be turned on -> sends visibility & workspace_level.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    const menuToggle = await screen.findByRole("menuitemcheckbox", {
      name: t("documents.home.create.share_workspace_toggle"),
    });
    expect(menuToggle).toHaveAttribute("aria-checked", "false");
    expect(menuToggle).not.toHaveAttribute("aria-disabled");

    fireEvent.click(menuToggle);
    expect(menuToggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.docx.menu")) }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("created-1"));
    expect(posts[0]).toEqual({
      path: `${LIST_BASE}/files/blank`,
      body: {
        format: "docx",
        title: t("documents.home.default_names.docx"),
        parent_id: "fo-priv",
        visibility: "workspace",
        workspace_level: "view",
      },
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// DOC2-W01..W03 wired through the Documents home: what the create surfaces send,
// the capability gate for file types, the inherited lock and the "Restricted" toast.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};
const CAPABLE = { "documents.create_visibility": { status: "available" } };

function summary(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    organization_id: "org1",
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    my_level: "manage",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function upload(id: string) {
  return summary({
    id,
    kind: "file",
    current_version: 1,
    file: {
      file_id: `file-${id}`,
      version_id: "v1",
      version: 1,
      filename: "note.txt",
      mime_type: "text/plain",
      size_bytes: 5,
      checksum_sha256: "a".repeat(64),
    },
  });
}

interface Routes {
  caps?: Record<string, unknown>;
  list?: () => unknown[];
  search?: () => unknown[];
  detail?: () => unknown;
  post?: (path: string) => unknown;
  upload?: () => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path.startsWith("/api/v1/config")) {
      return Promise.resolve({ flags: { documents: true }, rum_sample_rate: 0, work_management_capabilities: routes.caps ?? {} });
    }
    if (path.startsWith(`${LIST_BASE}/tree`)) {
      return Promise.resolve({ documents: [{ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0, children: [] }] });
    }
    if (path === `${LIST_BASE}/files`) return Promise.resolve(routes.upload?.() ?? {});
    if (method === "POST") return Promise.resolve(routes.post?.(path) ?? {});
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      const doc = routes.detail?.();
      return Promise.resolve(doc ? { document: doc } : {});
    }
    if (path.startsWith(LIST_BASE)) {
      const rows = new URLSearchParams(path.split("?")[1] ?? "").has("q") ? routes.search?.() : routes.list?.();
      return Promise.resolve({ documents: rows ?? [], next_cursor: null });
    }
    return Promise.resolve({});
  });
}

function nav(search = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function renderView(adapter: NavigationAdapter = nav(), onOpen: (id: string) => void = vi.fn()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return adapter;
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function cards() {
  return within(await screen.findByRole("list", { name: t("documents.home.create.label") }));
}

async function cardToggle() {
  const region = await screen.findByRole("region", { name: t("documents.page.title") });
  return within(region).findByRole("button", { name: new RegExp(`^${escape(t("documents.home.create.restricted_toggle"))}`) });
}

async function card(type: string) {
  return (await cards()).getByRole("button", { name: new RegExp(`^${escape(t(`documents.home.create.${type}.card`))}`) });
}

function lastPost() {
  const call = [...requestMock.mock.calls].reverse().find(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");
  return call as [string, { body?: unknown }] | undefined;
}

function pickFile() {
  const input = screen.getByLabelText(t("documents.upload.pick"));
  fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
}

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("restricted create from the Documents home", () => {
  it("creates a page as restricted from the card switch and offers Share (DOC2-W01, DOC2-W03)", async () => {
    const adapter = nav();
    const onOpen = vi.fn();
    route({ caps: CAPABLE, list: () => [], post: () => ({ document: summary({ id: "d9", visibility: "restricted" }) }) });
    renderView(adapter, onOpen);

    fireEvent.click(await cardToggle());
    fireEvent.click(await card("page"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d9"));
    expect(lastPost()?.[0]).toBe(LIST_BASE);
    expect(lastPost()?.[1].body).toMatchObject({ title: t("documents.page.new_page"), visibility: "restricted" });

    const [message, options] = toast.success.mock.calls.at(-1) as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe(t("documents.home.create.created_restricted"));
    expect(options.action.label).toBe(t("documents.home.create.share_action"));
    options.action.onClick();
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/documents/d9?share=1");
  });

  it("sends no visibility field and no restricted toast while the switch is off (DOC2-W01)", async () => {
    const onOpen = vi.fn();
    route({ caps: CAPABLE, list: () => [], post: () => ({ document: summary({ id: "d2" }) }) });
    renderView(nav(), onOpen);

    fireEvent.click(await card("page"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d2"));
    expect(lastPost()?.[1].body).not.toHaveProperty("visibility");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("creates a blank file as restricted when the server declares the capability (DOC2-W01)", async () => {
    const onOpen = vi.fn();
    route({ caps: CAPABLE, list: () => [], post: () => ({ document: summary({ id: "n1", kind: "file", current_version: 1 }) }) });
    renderView(nav(), onOpen);

    fireEvent.click(await cardToggle());
    fireEvent.click(await card("docx"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n1"));
    expect(lastPost()?.[0]).toBe(`${LIST_BASE}/files/blank`);
    expect(lastPost()?.[1].body).toMatchObject({ format: "docx", visibility: "restricted" });
  });

  it("creates a folder as restricted from the New menu in an open folder (DOC2-W01)", async () => {
    route({
      caps: CAPABLE,
      list: () => [],
      detail: () => summary({ id: "fo1", kind: "folder", title: "Dự án CCB", my_level: "edit", breadcrumbs: [] }),
      post: () => ({ document: summary({ id: "fo9", kind: "folder", title: "Thư mục mới", my_level: "manage" }) }),
    });
    renderView(nav("folder=fo1"));
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: new RegExp(t("documents.home.create.restricted_toggle")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.folder.menu")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Hồ sơ nội bộ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() => expect(lastPost()).toBeDefined());
    expect(lastPost()?.[1].body).toMatchObject({ kind: "folder", parent_id: "fo1", visibility: "restricted" });
  });

  it("hides the switch for files when the capability is missing, keeping pages (DOC2-W03)", async () => {
    route({ caps: {}, list: () => [] });
    renderView();

    fireEvent.click(await cardToggle());
    expect(await card("docx")).toHaveAttribute("aria-disabled", "true");
    expect(await card("page")).not.toHaveAttribute("aria-disabled");

    fireEvent.click(await card("upload"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: new RegExp(t("documents.home.create.restricted_toggle")) })).toBeNull();
  });

  it("uploads restricted from the dialog with the multipart field before the file (DOC2-W01)", async () => {
    const onOpen = vi.fn();
    route({ caps: CAPABLE, list: () => [], upload: () => ({ document: upload("u9") }) });
    renderView(nav(), onOpen);

    fireEvent.click(await card("upload"));
    const dialog = await screen.findByRole("dialog");
    const toggle = await within(dialog).findByRole("button", { name: new RegExp(t("documents.home.create.restricted_toggle")) });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    pickFile();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("u9"));
    const form = lastPost()?.[1] as unknown as { body: FormData };
    expect(form.body.get("visibility")).toBe("restricted");
    expect(Array.from(form.body.keys()).indexOf("visibility")).toBeLessThan(Array.from(form.body.keys()).indexOf("file"));
    expect(toast.success).toHaveBeenCalledWith(
      t("documents.home.create.created_restricted"),
      expect.objectContaining({ action: expect.objectContaining({ label: t("documents.home.create.share_action") }) }),
    );
  });

  it("a plain upload and a dropped file never send the field (DOC2-W01)", async () => {
    route({ caps: CAPABLE, list: () => [], upload: () => ({ document: upload("u1") }) });
    renderView();

    const zone = await screen.findByRole("region", { name: t("documents.page.title") });
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [new File(["x"], "drop.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(lastPost()?.[0]).toBe(`${LIST_BASE}/files`));
    expect((lastPost()?.[1] as unknown as { body: FormData }).body.has("visibility")).toBe(false);

    requestMock.mockClear();
    fireEvent.click(await card("upload"));
    pickFile();
    // The dropped upload shares the mutation: wait for the dialog's submit to settle.
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: t("documents.upload.submit") }));
    await waitFor(() => expect(lastPost()?.[0]).toBe(`${LIST_BASE}/files`));
    expect((lastPost()?.[1] as unknown as { body: FormData }).body.has("visibility")).toBe(false);
  });

  it("locks the switch inside a restricted folder and sends no field (DOC2-W02)", async () => {
    const onOpen = vi.fn();
    route({
      caps: CAPABLE,
      list: () => [],
      detail: () => summary({ id: "fo1", kind: "folder", title: "Dự án CCB", visibility: "restricted", my_level: "manage", breadcrumbs: [] }),
      post: () => ({ document: summary({ id: "d5", visibility: "restricted" }) }),
    });
    renderView(nav("folder=fo1"), onOpen);

    const toggle = await cardToggle();
    await waitFor(() => expect(toggle).toHaveAttribute("aria-disabled", "true"));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText(t("documents.home.create.restricted_inherited")).length).toBeGreaterThan(0);

    fireEvent.click(await card("page"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d5"));
    expect(lastPost()?.[1].body).toMatchObject({ parent_id: "fo1" });
    expect(lastPost()?.[1].body).not.toHaveProperty("visibility");
  });
});

describe("restricted badge on rows (F-14)", () => {
  it("marks a restricted row in the library and in search results, with words not only a colour", async () => {
    route({
      list: () => [summary({ id: "r1", title: "Hồ sơ lương", visibility: "restricted" }), summary({ id: "w1", title: "Kế hoạch chung" })],
      search: () => [summary({ id: "r2", title: "Hồ sơ thưởng", visibility: "restricted" })],
    });
    renderView();

    const row = (await screen.findByText("Hồ sơ lương")).closest("tr") as HTMLElement;
    expect(within(row).getByText(t("documents.library.restricted_badge"))).toBeInTheDocument();
    const plain = (await screen.findByText("Kế hoạch chung")).closest("tr") as HTMLElement;
    expect(within(plain).queryByText(t("documents.library.restricted_badge"))).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hồ sơ" } });
    const hit = (await screen.findByText("Hồ sơ thưởng")).closest("li") as HTMLElement;
    expect(within(hit).getByText(t("documents.library.restricted_badge"))).toBeInTheDocument();
  });
});

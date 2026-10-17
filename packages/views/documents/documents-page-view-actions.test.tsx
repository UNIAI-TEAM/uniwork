import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import enLocale from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// The library's row commands and its views beyond the home root: download and
// go-to-source on a file from another module, starring, the Recent / Shared /
// Starred / Archived / Elsewhere views, and the navigation sheet below `xl`.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestBlob: (...args: unknown[]) => downloadBlob(...args),
  };
});

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

function summary(over: Record<string, unknown> = {}) {
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q4", revision: "1", my_level: "manage", updated_at: "2026-09-28T03:00:00Z", ...over };
}

function source(over: Record<string, unknown> = {}) {
  return {
    id: "chat:m1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c1", title: "Kênh chung", message_id: "msg1" },
    name: "Đề xuất ngân sách.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 2_400_000,
    updated_at: "2026-10-09T03:00:00Z",
    owner: { id: "u2", kind: "human", name: "Dũng" },
    can_open_in_app: true,
    can_save: true,
    ...over,
  };
}

interface Routes {
  list?: (path: string) => unknown[];
  recent?: (path: string) => unknown[] | Promise<never>;
  recentCursor?: (path: string) => string | null;
  shared?: () => unknown[];
  favorites?: () => unknown[];
  sources?: (path: string) => unknown[];
  sourcesCursor?: (path: string) => string | null;
  post?: (path: string) => unknown;
  del?: (path: string) => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    const run = (fn: () => unknown) => {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    // The module switch reads the organization's office flags (UNI-1869 viewer).
    if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { office_engine: true } });
    if (path.includes("/documents/favorites")) return run(() => ({ favorites: routes.favorites?.() ?? [] }));
    if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return run(() => ({ items: routes.sources?.(path) ?? [], next_cursor: routes.sourcesCursor?.(path) ?? null }));
    }
    if (path.startsWith(`${LIST_BASE}/recent`)) {
      const rows = routes.recent?.(path);
      return Array.isArray(rows) || !rows ? Promise.resolve({ documents: rows ?? [], next_cursor: routes.recentCursor?.(path) ?? null }) : rows;
    }
    if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return run(() => ({ documents: routes.shared?.() ?? [], next_cursor: null }));
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (method === "DELETE") return run(() => routes.del?.(path) ?? { status: "ok" });
    if (path.startsWith(LIST_BASE)) return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
    return Promise.resolve({});
  });
}

function nav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

function renderView(adapter: NavigationAdapter = nav(), viewProps: Partial<Parameters<typeof DocumentsPageView>[0]> = {}) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} {...viewProps} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return adapter;
}

async function rowOf(title: string) {
  const row = (await screen.findByText(title)).closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

async function pickFromMenu(title: string, item: string) {
  const row = await rowOf(title);
  fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

const calls = (method: string) => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === method);
const sidebarItem = (label: string) => screen.getAllByRole("button", { name: new RegExp(label) })[0]!;

beforeEach(() => {
  requestMock.mockReset();
  downloadBlob.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

describe("file from another module", () => {
  const sourceNameButton = (row: HTMLElement) => row.querySelector("td:first-child button")! as HTMLElement;

  /** Stubs the object-URL API and the click that saves the blob; returns the clicks. */
  const stubDownload = () => {
    const createUrl = vi.fn().mockReturnValue("blob:budget");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download}|${this.href}`);
    });
    return { createUrl, revokeUrl, clicked, restore: () => { click.mockRestore(); vi.unstubAllGlobals(); } };
  };

  it("downloads the blob through a temporary link named after the file", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    renderView();
    const createUrl = vi.fn().mockReturnValue("blob:budget");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download}|${this.href}`);
    });
    try {
      const row = await rowOf("Đề xuất ngân sách.pdf");
      await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.download"));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toBe("Đề xuất ngân sách.pdf|blob:budget");
      expect(downloadBlob.mock.calls[0]?.[0]).toBe(`${LIST_BASE}/sources/chat%3Am1/download`);
      // The link is gone from the page and the object URL is released shortly after.
      expect(document.querySelector("a[download]")).toBeNull();
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("opens an Office source in the view-only dialog on the primary click — no download", async () => {
    // UNI-1869: the office frame hosts the file read-only; the dialog carries
    // the file's name and its own close, and the bytes never take the
    // download route.
    route({
      sources: () => [source({ id: "chat:d9", name: "Kế hoạch.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" })],
      post: (path) =>
        path.includes("/office/frame-token")
          ? {
              token: "ofs1.tok", token_type: "Bearer", expires_at: "2026-10-17T09:10:00Z", expires_in: 600,
              source_id: "chat:d9", parent_kind: "chat_channel", parent_id: "c1",
              workspace_id: WS, organization_id: "org1", can_edit: false, module: "docs", readonly: true,
            }
          : {},
    });
    const adapter = renderView(nav(), { officeFrameVersion: () => "9.9.9-test" });
    const row = await rowOf("Kế hoạch.docx");
    const nameButton = sourceNameButton(row);
    nameButton.focus();
    fireEvent.click(nameButton);
    const dialog = await screen.findByRole("dialog", { name: /Kế hoạch\.docx/ });
    expect((await within(dialog).findByTestId("office-docs-frame-iframe")).getAttribute("src")).toBe("/office-frame/docs/9.9.9-test/index.html");
    expect(within(dialog).getByText(t("documents.home.row.view_only"))).toBeInTheDocument();
    // One close control, in the header (no second default × over the frame).
    expect(within(dialog).getAllByRole("button", { name: t("documents.home.row.preview_close") })).toHaveLength(1);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(adapter.push).not.toHaveBeenCalled();
    expect(calls("POST").some(([path]) => String(path).endsWith("/sources/chat%3Ad9/office/frame-token"))).toBe(true);
    // Esc closes it and focus returns to the row's own button.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(nameButton);
  });

  it("still downloads a docx the server does not mark openable", async () => {
    route({ sources: () => [source({ id: "chat:d9", name: "Kế hoạch.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx", can_open_in_app: false })] });
    downloadBlob.mockResolvedValue(new Blob(["docx"]));
    const adapter = renderView();
    const { clicked, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Kế hoạch.docx");
      fireEvent.click(sourceNameButton(row));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toBe("Kế hoạch.docx|blob:budget");
      expect(downloadBlob.mock.calls[0]?.[0]).toBe(`${LIST_BASE}/sources/chat%3Ad9/download`);
      expect(adapter.push).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      // The download revokes its object URL a second later (documents-page-view
      // onDownloadSource); let that timer land on THIS stub so it cannot leak
      // into a later test's.
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
    } finally {
      restore();
    }
  });

  it("closes with the failed toast when the viewer's token mint is refused", async () => {
    route({
      sources: () => [source({ id: "chat:d5", name: "Mất quyền.docx", extension: "docx" })],
      post: (path) => {
        if (path.includes("/office/frame-token")) throw new ApiError("not found", "not_found", 404);
        return {};
      },
    });
    renderView(nav(), { officeFrameVersion: () => "9.9.9-test" });
    const row = await rowOf("Mất quyền.docx");
    fireEvent.click(sourceNameButton(row));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.preview_failed"));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("downloads instead when no frame build is installed for the module", async () => {
    route({ sources: () => [source({ id: "chat:d7", name: "Kế hoạch.docx", extension: "docx" })] });
    downloadBlob.mockResolvedValue(new Blob(["docx"]));
    renderView(nav(), { officeFrameVersion: () => "" });
    const { clicked, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Kế hoạch.docx");
      fireEvent.click(sourceNameButton(row));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
    } finally {
      restore();
    }
  });

  it("downloads a zip on the primary click instead of navigating", async () => {
    route({ sources: () => [source({ id: "chat:z1", name: "Mã nguồn.zip", mime_type: "application/zip", extension: "zip" })] });
    downloadBlob.mockResolvedValue(new Blob(["zip"]));
    const adapter = renderView();
    const { clicked, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Mã nguồn.zip");
      fireEvent.click(sourceNameButton(row));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(downloadBlob.mock.calls[0]?.[0]).toBe(`${LIST_BASE}/sources/chat%3Az1/download`);
      expect(adapter.push).not.toHaveBeenCalled();
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
    } finally {
      restore();
    }
  });

  it("previews an image in a dialog on the primary click and revokes the blob on close", async () => {
    route({ sources: () => [source({ id: "chat:i1", name: "Chụp màn hình.png", mime_type: "image/png", extension: "png" })] });
    downloadBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const adapter = renderView();
    const { createUrl, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Chụp màn hình.png");
      fireEvent.click(sourceNameButton(row));
      await waitFor(() => expect(downloadBlob.mock.calls[0]?.[0]).toBe(`${LIST_BASE}/sources/chat%3Ai1/download`));
      const dialog = await screen.findByRole("dialog");
      const image = within(dialog).getByRole("img", { name: "Chụp màn hình.png" });
      expect(image).toHaveAttribute("src", "blob:budget");
      // S2V-4: the close button sits on the dialog's own surface, never on the image.
      const close = within(dialog).getByRole("button", { name: t("documents.home.row.preview_close") });
      expect(image).not.toContainElement(close);
      expect(close.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      // A preview never navigates or saves the file.
      expect(adapter.push).not.toHaveBeenCalled();
      fireEvent.click(close);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(revokeUrl).toHaveBeenCalledWith("blob:budget");
    } finally {
      restore();
    }
  });

  it("says why when an image preview cannot load", async () => {
    route({ sources: () => [source({ id: "chat:i2", name: "Ảnh.png", mime_type: "image/png", extension: "png" })] });
    downloadBlob.mockRejectedValue(new ApiError("Tệp đã bị xoá", "not_found", 404));
    renderView();
    const row = await rowOf("Ảnh.png");
    fireEvent.click(sourceNameButton(row));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tệp đã bị xoá"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with the failed toast when the browser cannot draw the image", async () => {
    route({ sources: () => [source({ id: "chat:i3", name: "Ảnh lỗi.png", mime_type: "image/png", extension: "png" })] });
    downloadBlob.mockResolvedValue(new Blob(["nope"], { type: "image/png" }));
    renderView();
    const { restore } = stubDownload();
    try {
      const row = await rowOf("Ảnh lỗi.png");
      fireEvent.click(sourceNameButton(row));
      const dialog = await screen.findByRole("dialog");
      fireEvent.error(await within(dialog).findByRole("img", { name: "Ảnh lỗi.png" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.preview_failed")));
    } finally {
      restore();
    }
  });

  it("drops a blob that resolves after the preview was closed", async () => {
    route({ sources: () => [source({ id: "chat:i4", name: "Chậm.png", mime_type: "image/png", extension: "png" })] });
    let release!: (blob: Blob) => void;
    downloadBlob.mockImplementation(() => new Promise<Blob>((resolve) => { release = resolve; }));
    renderView();
    const { createUrl, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Chậm.png");
      fireEvent.click(sourceNameButton(row));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("documents.home.row.preview_close") }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      await act(async () => {
        release(new Blob(["png"], { type: "image/png" }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      // The closed preview never became an object URL and never reopened.
      expect(createUrl).not.toHaveBeenCalled();
      expect(revokeUrl).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      restore();
    }
  });

  it("says why when the download is refused", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockRejectedValue(new ApiError("Tệp đã bị xoá", "not_found", 404));
    renderView();
      await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.download"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tệp đã bị xoá"));
  });

  it("falls back to the generic copy when the failure carries no message", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockRejectedValue("offline");
    renderView();
      await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.download"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.download_failed")));
  });

  it("opens the channel room at the message the file was sent in, inside this workspace", async () => {
    route({ sources: () => [source()] });
    const adapter = renderView();
    // The literal copy is pinned on purpose (U-SRC3): one label for every origin but email.
    await pickFromMenu("Đề xuất ngân sách.pdf", "Xem nơi đính kèm");
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=c1&message=msg1");
  });

  it("opens the room and message from the row's secondary button too", async () => {
    route({ sources: () => [source()] });
    const adapter = renderView();
    const row = await rowOf("Đề xuất ngân sách.pdf");
    const secondary = within(row).getByRole("button", { name: t("documents.home.row.go_to_source_named", { title: "Đề xuất ngân sách.pdf" }) });
    // S2V-2: an icon button rendered at every list width — nothing in its
    // chain may carry the ladder's `hidden @min-[45rem]/library:block` rung.
    const wrapper = secondary.parentElement;
    expect(wrapper?.className ?? "").not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(wrapper?.className ?? "").not.toMatch(/@min-\[45rem\]\/library:block/);
    // Icon-only: the visible label lives on the tooltip, not as button text.
    expect(secondary).toHaveAttribute("data-slot", "tooltip-trigger");
    expect(secondary).not.toHaveTextContent(t("documents.home.row.go_to_source"));
    fireEvent.click(secondary);
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=c1&message=msg1");
  });

  it("carries the visible label on the tooltip of the icon-only button", async () => {
    route({ sources: () => [source()] });
    renderView();
    const row = await rowOf("Đề xuất ngân sách.pdf");
    const secondary = within(row).getByRole("button", { name: t("documents.home.row.go_to_source_named", { title: "Đề xuất ngân sách.pdf" }) });
    secondary.focus();
    const tip = await screen.findByText(t("documents.home.row.go_to_source"));
    expect(tip.closest('[data-slot="tooltip-content"]')).toBeTruthy();
  });

  it("opens the DM room at the message the file was sent in", async () => {
    route({ sources: () => [source({ parent: { kind: "chat_dm", id: "dm1", title: "Dũng", message_id: "msg7" } })] });
    const adapter = renderView();
    await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=dm1&message=msg7");
  });

  it("opens a group room (sent as chat_dm with the group's room id)", async () => {
    route({ sources: () => [source({ parent: { kind: "chat_dm", id: "group1", title: "Nhóm dự án", message_id: "msg8" } })] });
    const adapter = renderView();
    await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=group1&message=msg8");
  });

  it("opens the room only when the server named no message", async () => {
    route({ sources: () => [source({ parent: { kind: "chat_channel", id: "c1", title: "Kênh chung" } })] });
    const adapter = renderView();
    await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=c1");
  });

  it("opens the Email Hub for an email attachment, under its own label", async () => {
    route({ sources: () => [source({ id: "email:a1", source: "email", name: "Hóa đơn.pdf", parent: { kind: "email_thread", id: "th1", title: "Hóa đơn", message_id: "" } })] });
    const adapter = renderView();
    await pickFromMenu("Hóa đơn.pdf", "Mở Email");
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/email");
    // The row's own button is icon-only: the accessible name says the visible
    // label (WCAG 2.5.3) and the tooltip carries the words.
    const row = await rowOf("Hóa đơn.pdf");
    const secondary = within(row).getByRole("button", { name: t("documents.home.row.open_email_named", { title: "Hóa đơn.pdf" }) });
    expect(secondary).toHaveAttribute("data-slot", "tooltip-trigger");
    expect(secondary).not.toHaveTextContent(t("documents.home.row.open_email"));
    fireEvent.click(secondary);
    expect(adapter.push).toHaveBeenCalledTimes(2);
  });

  it("opens the task a comment attachment belongs to", async () => {
    route({ sources: () => [source({ id: "task:a1", source: "task", name: "Phụ lục.docx", extension: "docx", parent: { kind: "task", id: "t7", title: "Việc", message_id: "" } })] });
    const adapter = renderView();
    await pickFromMenu("Phụ lục.docx", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/tasks/t7");
  });

  it("opens the meeting a file belongs to", async () => {
    route({ sources: () => [source({ id: "meeting:a1", source: "meeting", name: "Biên bản.docx", extension: "docx", parent: { kind: "meeting", id: "mt3", title: "Họp tuần", message_id: "" } })] });
    const adapter = renderView();
    await pickFromMenu("Biên bản.docx", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/meetings/mt3");
  });

  it("downloads on the primary click of an unknown parent and offers no go-to-source", async () => {
    route({ sources: () => [source({ parent: { kind: "unknown", id: "x", title: "?" } })] });
    downloadBlob.mockResolvedValue(new Blob(["pdf"]));
    const adapter = renderView();
    const { clicked, revokeUrl, restore } = stubDownload();
    try {
      const row = await rowOf("Đề xuất ngân sách.pdf");
      fireEvent.click(sourceNameButton(row));
      await waitFor(() => expect(clicked).toHaveLength(1));

      // A parent kind with no route gets neither the row button nor the menu item.
      expect(within(row).queryByRole("button", { name: /nơi đính kèm|Mở Email/ })).toBeNull();
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
      expect(await screen.findByRole("menuitem", { name: t("documents.home.row.download") })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: t("documents.home.row.go_to_source") })).toBeNull();
      expect(adapter.push).not.toHaveBeenCalled();
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
    } finally {
      restore();
    }
  });

  it("opens the file on Enter and keeps View where attached its own named tab stop", async () => {
    route({ sources: () => [source({ id: "chat:k1", name: "Báo cáo.png", mime_type: "image/png", extension: "png" })] });
    downloadBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const adapter = renderView();
    const { restore } = stubDownload();
    try {
      const row = await rowOf("Báo cáo.png");
      sourceNameButton(row).focus();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");

      // The secondary action is reachable by keyboard on its own, with a name.
      const secondary = within(row).getByRole("button", { name: t("documents.home.row.go_to_source_named", { title: "Báo cáo.png" }) });
      secondary.focus();
      await userEvent.keyboard("{Enter}");
      expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=c1&message=msg1");
    } finally {
      restore();
    }
  });
});

describe("starring a document", () => {
  it("stars a row and reports a refused star", async () => {
    route({ list: () => [summary()], post: () => { throw new ApiError("Không có quyền", "forbidden", 403); } });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    await waitFor(() => expect(calls("POST").some(([path]) => path === "/api/v1/documents/d1/favorite")).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không có quyền"));
  });

  it("offers the un-star on a starred row and calls the delete route", async () => {
    route({
      list: () => [summary()],
      favorites: () => [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }],
    });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.unstar"));
    await waitFor(() => expect(calls("DELETE").some(([path]) => path === "/api/v1/documents/d1/favorite")).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("uses the generic copy when the failure has no message", async () => {
    route({ list: () => [summary()], post: () => Promise.reject("offline") as never });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.star_failed")));
  });

  it("shows the starred count in the sidebar and lists the starred documents", async () => {
    route({
      list: () => [summary()],
      favorites: () => [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }, { document_id: "d9", workspace_id: "other", title: "Khác", kind: "page" }],
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    // A favourite of another workspace is not counted here.
    await waitFor(() => expect(within(sidebarItem(t("documents.home.sidebar.starred"))).getByText("1")).toBeInTheDocument());

    fireEvent.click(sidebarItem(t("documents.home.sidebar.starred")));
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.starred") })).toBeInTheDocument();
    expect(await rowOf("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Khác")).toBeNull();
  });

  it("shows the star marker on the row after starring and removes it after unstarring", async () => {
    let starred = false;
    const fav = { document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" };
    route({
      list: () => [summary()],
      favorites: () => (starred ? [fav] : []),
      post: (path) => {
        if (path === "/api/v1/documents/d1/favorite") starred = true;
        return { favorite: fav };
      },
      del: (path) => {
        if (path === "/api/v1/documents/d1/favorite") starred = false;
        return { status: "ok" };
      },
    });
    renderView();
    const row = await rowOf("Kế hoạch Q4");
    expect(within(row).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull();

    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    expect(await within(row).findByRole("img", { name: t("documents.home.row.starred") })).toBeInTheDocument();

    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.unstar"));
    await waitFor(() => expect(within(row).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull());
  });
});

describe("library views", () => {
  it("lists Recent and Shared with me from their own routes", async () => {
    route({
      list: () => [summary()],
      recent: () => [summary({ id: "r1", title: "Vừa mở" })],
      shared: () => [summary({ id: "s1", title: "Hợp đồng chung", updated_by: "agent-1", updated_by_kind: "agent" })],
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(sidebarItem(t("documents.home.sidebar.recent")));
    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();

    fireEvent.click(sidebarItem(t("documents.home.sidebar.shared")));
    const row = await rowOf("Hợp đồng chung");
    // An editor that is an agent without a member entry is named as an agent, not left blank.
    expect(within(row).getByText(t("documents.home.editor_agent"))).toBeInTheDocument();
  });

  it("says the recent list could not be read and retries it", async () => {
    let attempts = 0;
    route({
      recent: () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError("boom", "internal", 500);
        return [summary({ id: "r1", title: "Vừa mở" })];
      },
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));
    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
  });

  it("pages Recent with Load more", async () => {
    const cursorOf = (path: string) => new URLSearchParams(path.split("?")[1] ?? "").get("cursor");
    route({
      recent: (path) => (cursorOf(path) === "c2" ? [summary({ id: "r2", title: "Mở hôm qua" })] : [summary({ id: "r1", title: "Vừa mở" })]),
      recentCursor: (path) => (cursorOf(path) === "c2" ? null : "c2"),
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    await screen.findByText("Vừa mở");
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    expect(await screen.findByText("Mở hôm qua")).toBeInTheDocument();
    expect(screen.getByText("Vừa mở")).toBeInTheDocument();
  });

  it("retries the starred list when it could not be read", async () => {
    let attempts = 0;
    route({
      favorites: () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError("boom", "internal", 500);
        return [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }];
      },
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.starred")) }));
    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("separates a refusal from a failure", async () => {
    route({ recent: () => { throw new ApiError("no", "forbidden", 403); } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.library.error_title"))).toBeNull();
  });

  it("lists archived documents with the trash actions and no live row menu", async () => {
    route({ list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [summary({ id: "a1", title: "Cũ", archived_at: "2026-09-01T00:00:00Z", archived_by: "u2", purge_after: "2026-10-01T00:00:00Z" })] : []) });
    renderView();
    fireEvent.click(await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) }));
    const row = await rowOf("Cũ");
    expect(within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Cũ" }) })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t("documents.trash.purge_item", { title: "Cũ" }) })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t("documents.home.row.menu", { title: "Cũ" }) })).toBeNull();
  });

  it("lists one module's files from the sidebar and names the view after it", async () => {
    const filters: string[] = [];
    route({
      list: () => [summary()],
      sources: (path) => {
        filters.push(path);
        return [source()];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.origin.chat") }));
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.chat") })).toBeInTheDocument();
    expect(filters.some((path) => new URLSearchParams(path.split("?")[1] ?? "").get("source") === "chat")).toBe(true);
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
    expect(await rowOf("Đề xuất ngân sách.pdf")).toBeInTheDocument();
  });

  it("pages one module's files with Load more", async () => {
    route({
      list: () => [summary()],
      sources: (path) => {
        const cursor = new URLSearchParams(path.split("?")[1] ?? "").get("cursor");
        if (cursor === "c2") return [source({ id: "chat:m2", name: "Phụ lục.pdf" })];
        return [source()];
      },
      sourcesCursor: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("cursor") === "c2" ? null : "c2"),
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.origin.chat") }));
    await rowOf("Đề xuất ngân sách.pdf");

    fireEvent.click(await screen.findByRole("button", { name: t("documents.library.load_more") }));
    expect(await screen.findByText("Phụ lục.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.library.load_more") })).toBeNull();
  });

  it("shows the empty copy of the open view, not the home copy", async () => {
    route({});
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.shared")) }));
    expect(await screen.findByText(t("documents.home.empty.shared_title"))).toBeInTheDocument();
  });
});

describe("navigation sheet", () => {
  it("opens the same navigation below xl and closes it after a choice", async () => {
    route({ list: () => [summary()], recent: () => [summary({ id: "r1", title: "Vừa mở" })] });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.sidebar.open") }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(t("documents.tree.sheet_title"))).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));

    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("FD-09 fix r2: one menu vocabulary on live rows", () => {
  async function openMenu(title: string) {
    const row = await rowOf(title);
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  }

  it("names the same actions the same way on a folder row and in the tree menu", async () => {
    route({ list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })] });
    renderView();
    await openMenu("Hợp đồng");
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.archive") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
  });

  it("uses Move to… on a document row too and keeps Archive for it", async () => {
    route({ list: () => [summary()] });
    renderView();
    await openMenu("Kế hoạch Q4");
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.archive") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
  });

  it("carries the same words in English: Move to… and Delete", () => {
    expect(enLocale.documents.tree.menu.move_to).toBe("Move to…");
    expect(enLocale.documents.tree.menu.delete).toBe("Delete");
    expect(enLocale.documents.actions.restore).toBe("Restore");
  });

  it("carries the same words in Vietnamese: Di chuyển tới… and Xóa", () => {
    const tree = viLocale.documents.tree.menu;
    expect(tree.move_to).toBe("Di chuyển tới…");
    expect(tree.delete).toBe("Xóa");
    expect(viLocale.documents.actions.restore).toBe("Khôi phục");
  });
});

describe("workspace access report entry (UNI-1643)", () => {
  it("the header overflow opens the workspace access report for any member", async () => {
    route({});
    const adapter = renderView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.actions.menu_label") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.accessReport.menu_workspace") }));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/documents/access-report");
  });
});

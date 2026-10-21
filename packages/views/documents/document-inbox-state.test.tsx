import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { notificationKeys } from "@uniwork/core/notifications";
import { DocumentSchema } from "@uniwork/core/types/document";
import type { Notification, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { resourceHref } from "../notifications/resource-href";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import "../test/lazy-document-editor";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const user = { id: "u1", display_name: "An" } as User;
const workspace = { id: "ws1", slug: "doi", organization_id: "o1", organization_slug: "acme" } as Workspace;

function renderPage(search: string, pathname = "/acme/doi/documents/d1", client?: QueryClient) {
  const nav = fakeNav(pathname);
  nav.searchParams = new URLSearchParams(search);
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <DocumentDetailView wsId="ws1" documentId="d1" libraryHref="/acme/doi/documents" onBackToList={vi.fn()} />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
      nav,
      client,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
});

// S15 page level (UNI-1389 rows 1-2): a document link from the Inbox names a comment; when the
// page is refused, the sentence is the heading, it takes focus, and the next stop is the Inbox.
describe("DocumentDetailView opened from the Inbox", () => {
  it.each([
    ["no access (403)", new ApiError("forbidden", "forbidden", 403), "Bạn không có quyền truy cập tài liệu này."],
    ["gone (410)", new ApiError("document_deleted", "gone", 410), "Tài liệu không còn tồn tại hoặc đã bị xóa."],
  ])("says %s as the page heading with the way back to the Inbox", async (_, error, sentence) => {
    requestMock.mockRejectedValue(error);
    renderPage("comment=c1");
    const heading = await screen.findByRole("heading", { level: 2, name: sentence });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("link", { name: "Về Hộp việc" })).toHaveAttribute("href", "/acme/doi/inbox");
    expect(screen.queryByText(t("documents.detail.revoked_title"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.detail.back_to_library") })).toBeNull();
  });

  // F-G819-A07b: the server answers a revoked reader 404 on purpose (no level = not found), but a
  // person who followed a notice already knows the document exists: the page says no access and
  // keeps the request-access form (the route's 202 is uniform, so nothing is revealed).
  it("reads a 404 from a notice as no access, with the request form and the way back to the Inbox", async () => {
    requestMock.mockRejectedValue(new ApiError("not_found", "not found", 404));
    renderPage("comment=c1");
    const heading = await screen.findByRole("heading", { level: 2, name: "Bạn không có quyền truy cập tài liệu này." });
    expect(heading).toHaveFocus();
    expect(screen.queryByText("Tài liệu không còn tồn tại hoặc đã bị xóa.")).toBeNull();
    expect(screen.getByRole("link", { name: "Về Hộp việc" })).toHaveAttribute("href", "/acme/doi/inbox");
    expect(screen.queryByRole("button", { name: t("documents.detail.back_to_library") })).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.access_request.send") })).toBeInTheDocument();
  });

  it("sends the access request from a 404 notice page and says it was sent", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/documents/d1/access-requests"
        ? Promise.resolve({ status: "sent" })
        : Promise.reject(new ApiError("not_found", "not found", 404)),
    );
    renderPage("comment=c1");
    fireEvent.click(await screen.findByRole("button", { name: t("documents.access_request.send") }));
    expect(await screen.findByRole("status")).toHaveTextContent(t("documents.access_request.sent"));
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/documents/d1/access-requests")).toBe(true);
  });

  it("keeps the neutral locked card for a 404 without a notice (nothing new is revealed)", async () => {
    requestMock.mockRejectedValue(new ApiError("not_found", "not found", 404));
    renderPage("");
    expect(await screen.findByText(t("documents.access_request.locked_title"))).toBeInTheDocument();
    expect(screen.queryByText("Bạn không có quyền truy cập tài liệu này.")).toBeNull();
    expect(screen.queryByText("Tài liệu không còn tồn tại hoặc đã bị xóa.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Về Hộp việc" })).toBeNull();
  });

  // V7 F2: without cn() the base border-transparent beat the outline variant's border in light mode.
  it("draws the way back as an outline button with a visible border", async () => {
    requestMock.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    renderPage("comment=c1");
    const link = await screen.findByRole("link", { name: "Về Hộp việc" });
    const classes = link.className.split(/\s+/);
    expect(classes).toContain("border-input");
    expect(classes).not.toContain("border-transparent");
  });

  it("keeps the library's own refusal for a link that names no comment", async () => {
    requestMock.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    renderPage("");
    expect(await screen.findByText(t("documents.detail.revoked_title"))).toBeInTheDocument();
    expect(screen.queryByText("Bạn không có quyền truy cập tài liệu này.")).toBeNull();
  });

  it("keeps the retryable load error for a server that cannot be reached", async () => {
    requestMock.mockRejectedValue(new ApiError("internal", "boom", 500));
    renderPage("comment=c1");
    expect(await screen.findByText(t("documents.detail.load_error"))).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu không còn tồn tại hoặc đã bị xóa.")).toBeNull();
  });
});

// UNI-2019 option B: the server answers 404 for a revoked reader AND a deleted document, so a 404 from
// a notice asks the Inbox's own first page (fresh, never the cached one) which of the two it was.
describe("DocumentDetailView 404 from a notice: deleted or revoked", () => {
  const noticeRow = (over: Partial<Notification>) =>
    ({
      id: "n1", kind: "document_commented", workspace_id: "ws1", organization_id: "o1", resource_type: "document",
      resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
      actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.document_commented",
      params: { comment_id: "c1" }, count: 1, created_at: "", ...over,
    }) as Notification;
  const isNotifications = (path: string) => path.startsWith("/api/v1/me/notifications");
  const notificationCalls = () => requestMock.mock.calls.filter(([path]) => isNotifications(path as string));
  const answer = (notifications: () => Promise<unknown>) =>
    requestMock.mockImplementation((path: string) =>
      isNotifications(path) ? notifications() : Promise.reject(new ApiError("not_found", "not found", 404)),
    );
  const gone = "Tài liệu không còn tồn tại hoặc đã bị xóa.";
  const noAccess = "Bạn không có quyền truy cập tài liệu này.";

  it("reads a notice whose row says the document was deleted as gone, with no request button", async () => {
    answer(() => Promise.resolve({ notifications: [noticeRow({ resource_deleted: true })], next_before: "" }));
    renderPage("comment=c1");
    const heading = await screen.findByRole("heading", { level: 2, name: gone });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("link", { name: "Về Hộp việc" })).toHaveAttribute("href", "/acme/doi/inbox");
    expect(screen.queryByRole("button", { name: t("documents.access_request.send") })).toBeNull();
    expect(screen.queryByText(noAccess)).toBeNull();
  });

  it("prefers the row of the comment the link names", async () => {
    answer(() =>
      Promise.resolve({
        notifications: [
          noticeRow({ id: "n2", params: { comment_id: "c9" }, resource_access_lost: true }),
          noticeRow({ id: "n1", params: { comment_id: "c1" }, resource_deleted: true }),
        ],
        next_before: "",
      }),
    );
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: gone })).toBeInTheDocument();
  });

  it("falls back to any row of the document when none names the comment", async () => {
    answer(() => Promise.resolve({ notifications: [noticeRow({ params: { comment_id: "c9" }, resource_deleted: true })], next_before: "" }));
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: gone })).toBeInTheDocument();
  });

  // A document_changed row's resource_id is only the first document of a multi-document notice and the
  // row is never resource_deleted, so it must not stand in for the document's own comment row.
  it("does not let a newer document_changed row hide the deleted flag of an older comment row", async () => {
    answer(() =>
      Promise.resolve({
        notifications: [
          noticeRow({ id: "n3", kind: "document_changed", params: { verb: "trashed", document_count: "3" } }),
          noticeRow({ id: "n1", params: { comment_id: "c9" }, resource_deleted: true }),
        ],
        next_before: "",
      }),
    );
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: gone })).toBeInTheDocument();
    expect(screen.queryByText(noAccess)).toBeNull();
  });

  it("keeps the loading state, not the request form, while the Inbox page is fetched", async () => {
    let resolve!: (v: unknown) => void;
    answer(() => new Promise((r) => { resolve = r; }));
    renderPage("comment=c1");
    await waitFor(() => expect(notificationCalls()).toHaveLength(1));
    expect(screen.queryByRole("button", { name: t("documents.access_request.send") })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    resolve({ notifications: [noticeRow({ resource_access_lost: true })], next_before: "" });
    expect(await screen.findByRole("heading", { level: 2, name: noAccess })).toBeInTheDocument();
  });

  it("reads a lost grant as no access, with the request form", async () => {
    answer(() => Promise.resolve({ notifications: [noticeRow({ resource_access_lost: true })], next_before: "" }));
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: noAccess })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.access_request.send") })).toBeInTheDocument();
    expect(screen.queryByText(gone)).toBeNull();
  });

  it("reads a missing row (another document's notice only) as no access", async () => {
    answer(() => Promise.resolve({ notifications: [noticeRow({ resource_id: "d2", resource_deleted: true })], next_before: "" }));
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: noAccess })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.access_request.send") })).toBeInTheDocument();
  });

  it("reads a failed notifications fetch as no access", async () => {
    answer(() => Promise.reject(new ApiError("internal", "boom", 500)));
    renderPage("comment=c1");
    expect(await screen.findByRole("heading", { level: 2, name: noAccess })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.access_request.send") })).toBeInTheDocument();
  });

  it("makes no notifications request for a link that names no comment", async () => {
    answer(() => Promise.resolve({ notifications: [noticeRow({ resource_deleted: true })], next_before: "" }));
    renderPage("");
    expect(await screen.findByText(t("documents.access_request.locked_title"))).toBeInTheDocument();
    expect(notificationCalls()).toHaveLength(0);
  });

  it("refetches even when the Inbox page is already cached", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(notificationKeys.list("ws1", false), {
      notifications: [noticeRow({ resource_access_lost: true })],
      next_before: "",
    });
    answer(() => Promise.resolve({ notifications: [noticeRow({ resource_deleted: true })], next_before: "" }));
    renderPage("comment=c1", "/acme/doi/documents/d1", client);
    expect(await screen.findByRole("heading", { level: 2, name: gone })).toBeInTheDocument();
  });
});

// UNI-1389 (c): a document shared directly from a workspace the recipient is not in. The
// Inbox link falls back to the open workspace, and the page at that URL must open the document
// (GET /documents/{id} answers by the document's own access), not refuse it as an S15 state.
describe("a direct-share document opened from the Inbox in the open workspace", () => {
  const sharedNotification = {
    id: "n1", kind: "document_commented", workspace_id: "ws-other", organization_id: "o1", resource_type: "document",
    resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
    actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.document_commented",
    params: { comment_id: "c1", kind: "comment", document: "Hợp đồng" }, count: 1, created_at: "",
  } as Notification;

  it("links to the open workspace and the page opens the document without a refusal", async () => {
    // The recipient's own workspaces do not include ws-other, so the link takes the open one.
    const href = resourceHref(sharedNotification, workspace, [workspace]);
    expect(href).toBe("/acme/doi/documents/d1?comment=c1");
    const [pathname, search] = href.split("?") as [string, string];

    const shared = DocumentSchema.parse({
      id: "d1", workspace_id: "ws-other", organization_id: "o1", kind: "page", title: "Hợp đồng chung",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Điều khoản" }] }] },
      content_text: "Điều khoản", revision: "3", current_version: 1, my_level: "edit", via: "share",
      created_at: "2026-09-28T03:00:00Z", updated_at: "2026-09-28T03:00:00Z",
    });
    // Desktop rail: on a narrow window the deep link opens the comments sheet, which hides the page from role queries.
    window.innerWidth = 1400;
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.resolve({ document: shared });
      if (path.startsWith("/api/v1/documents/d1/comments")) return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:a" });
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    renderPage(search, pathname);

    expect(await screen.findByRole("textbox", { name: t("documents.page_ui.title_label") }, { timeout: 15_000 })).toHaveValue("Hợp đồng chung");
    expect(screen.queryByRole("heading", { level: 2, name: "Bạn không có quyền truy cập tài liệu này." })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Tài liệu không còn tồn tại hoặc đã bị xóa." })).toBeNull();
    expect(screen.queryByRole("link", { name: "Về Hộp việc" })).toBeNull();
    // The page asked for the document by its own id: the access decision is the document's.
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/documents/d1")).toBe(true);
  });
});

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const user = { id: "u1", display_name: "An" } as User;
const workspace = { id: "ws1", slug: "doi", organization_id: "o1", organization_slug: "acme" } as Workspace;

function renderPage(search: string) {
  const nav = fakeNav("/acme/doi/documents/d1");
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
    ["gone (404)", new ApiError("not_found", "not found", 404), "Tài liệu không còn tồn tại hoặc đã bị xóa."],
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

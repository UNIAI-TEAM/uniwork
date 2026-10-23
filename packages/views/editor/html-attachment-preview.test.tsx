// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { HtmlAttachmentPreview } from "./html-attachment-preview";

// The component and its body both read the attachment text through this one
// hook; mocking it keeps the render synchronous and off the network.
vi.mock("./hooks/use-attachment-html-text", () => ({
  useAttachmentHtmlText: () => ({
    isLoading: false,
    error: null,
    data: "<html><body>chart</body></html>",
  }),
}));

const workspace: Workspace = {
  id: "ws1",
  slug: "doi",
  name: "Đội",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function wrap(ui: React.ReactElement) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}
    >
      {ui}
    </QueryClientProvider>
  );
}

function renderPreview() {
  return render(
    wrap(
      <HtmlAttachmentPreview
        attachmentId="a1"
        filename="chart.html"
        onPreview={vi.fn()}
        onDownload={vi.fn()}
      />,
    ),
  );
}

describe("HtmlAttachmentPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without a NavigationProvider (desktop Office shell mounts none)", () => {
    // Regression: the desktop shell has no NavigationProvider, so a plain
    // useNavigation() here threw and took the editor down with it.
    renderPreview();

    expect(screen.getByTitle("chart.html")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem trước" })).toBeInTheDocument();
  });

  it("still navigates through the adapter when a NavigationProvider is present", () => {
    const getShareableUrl = vi.fn((path: string) => `https://uniwork.test${path}`);
    const adapter: NavigationAdapter = {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      pathname: "/acme/doi",
      searchParams: new URLSearchParams(),
      getShareableUrl,
    };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      wrap(
        <WorkspaceProvider workspace={workspace} user={user}>
          <NavigationProvider value={adapter}>
            <HtmlAttachmentPreview
              attachmentId="a1"
              filename="chart.html"
              onPreview={vi.fn()}
              onDownload={vi.fn()}
            />
          </NavigationProvider>
        </WorkspaceProvider>,
      ),
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Mở tab mới" }));

    expect(getShareableUrl).toHaveBeenCalledWith(
      "/api/v1/attachments/a1/content?name=chart.html",
    );
    expect(open).toHaveBeenCalledWith(
      "https://uniwork.test/api/v1/attachments/a1/content?name=chart.html",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

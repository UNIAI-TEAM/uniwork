import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import type { NavigationAdapter } from "../navigation";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingsPageView } from "./meetings-page-view";

vi.mock("@uniwork/core/realtime", () => ({ useWorkspaceEvents: () => {} }));
vi.mock("./instant-meeting-dialog", () => ({ InstantMeetingDialog: ({ trigger }: { trigger: ReactNode }) => trigger }));
vi.mock("./new-meeting-dialog", () => ({ NewMeetingDialog: ({ trigger }: { trigger: ReactNode }) => trigger }));

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

function nav(search: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/org/team/meetings",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function renderPage(adapter: NavigationAdapter) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={me}>
        <MeetingsPageView workspaceId="w1" onOpen={() => {}} onOpenRoom={() => {}} />
      </WorkspaceProvider>,
      adapter,
    ),
  );
}

const listCalls = () => requestMock.mock.calls.map((c) => String(c[0])).filter((p) => p.includes("/meetings?"));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/meetings?")) {
      return Promise.resolve({
        meetings: [
          {
            id: "m1",
            workspace_id: "w1",
            title: "Retro",
            description: "",
            starts_at: "2026-08-29T09:00:00Z",
            ends_at: "2026-08-29T09:30:00Z",
            room_name: "r",
            created_by: "u-host",
            status: "ENDED",
          },
        ],
        total: 45,
      });
    }
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
});

describe("MeetingsPageView URL state", () => {
  it("reads status, search and page from the URL so Back restores them", async () => {
    renderPage(nav("status=ENDED&q=retro&page=2"));
    expect(await screen.findByText("Retro")).toBeInTheDocument();
    expect(listCalls()[0]).toContain("status=ENDED");
    expect(listCalls()[0]).toContain("q=retro");
    expect(listCalls()[0]).toContain("offset=20");
    expect(screen.getByRole("searchbox")).toHaveValue("retro");
    expect(screen.getByRole("button", { name: /Đã kết thúc/, pressed: true })).toBeInTheDocument();
    expect(screen.getByText("Trang 2 / 3")).toBeInTheDocument();
  });

  it("writes a chip change to the URL and goes back to page one", async () => {
    const adapter = nav("q=retro&page=2");
    renderPage(adapter);
    await screen.findByText("Retro");
    fireEvent.click(screen.getByRole("button", { name: /Đã hủy/ }));
    expect(adapter.replace).toHaveBeenLastCalledWith("/org/team/meetings?q=retro&status=CANCELED");
  });

  it("writes the next page to the URL", async () => {
    const adapter = nav("status=ENDED");
    renderPage(adapter);
    await screen.findByText("Retro");
    fireEvent.click(screen.getByRole("button", { name: "Sau" }));
    expect(adapter.replace).toHaveBeenLastCalledWith("/org/team/meetings?status=ENDED&page=2");
  });

  it("writes the search to the URL once typed", async () => {
    const adapter = nav("status=ENDED&page=3");
    renderPage(adapter);
    await screen.findByText("Retro");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "plan" } });
    await waitFor(() => expect(adapter.replace).toHaveBeenLastCalledWith("/org/team/meetings?status=ENDED&q=plan"));
  });

  it("ignores a status the list does not know", async () => {
    renderPage(nav("status=BOGUS"));
    await screen.findByText("Retro");
    expect(listCalls()[0]).not.toContain("status=");
  });
});

describe("MeetingsPageView error", () => {
  it("says the list did not load and offers a retry", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).includes("/meetings?") ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    renderPage(nav(""));
    expect(await screen.findByText("Chưa tải được danh sách cuộc họp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

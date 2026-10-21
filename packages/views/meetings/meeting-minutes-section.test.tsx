import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingMinutesSection } from "./meeting-minutes-section";

beforeAll(() => {
  initI18n();
});

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};
const user = { id: "u-host", email: "host@x.com", display_name: "Host" } as User;

const draft = { document_id: "d1", finalized: false, edited_since_finalized: false, can_edit: true };
const finalized = {
  ...draft,
  finalized: true,
  finalized_at: "2026-10-20T03:00:00Z",
  finalized_by: "u-mai",
  finalized_version_id: "v2",
  finalized_version: 2,
};

/** Answers GET minutes with the current state; each command moves it to what `after` names. */
function respond(minutes: unknown, after: Record<string, unknown> = {}) {
  let current = minutes;
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
      });
    }
    if (init?.method === "POST") {
      const command = p.split("/minutes")[1]?.replace("/", "") || "create";
      current = after[command] ?? null;
      return Promise.resolve({ minutes: current });
    }
    if (p.endsWith("/minutes")) return Promise.resolve({ minutes: current });
    return Promise.resolve({});
  });
}

function renderSection(canClerk = true, nav = fakeNav()) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <MeetingMinutesSection workspaceId="w1" meetingId="m1" canClerk={canClerk} />
      </WorkspaceProvider>,
      nav,
    ),
  );
}

function posted(): string[] {
  return requestMock.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST")
    .map(([path]) => String(path));
}

describe("MeetingMinutesSection", () => {
  it("lets a clerk make the minutes in the reader's language, then opens the page", async () => {
    respond(null, { create: draft });
    const nav = fakeNav();
    renderSection(true, nav);
    await userEvent.click(await screen.findByRole("button", { name: "Lập biên bản" }));
    await waitFor(() => expect(posted()).toEqual(["/api/v1/meetings/m1/minutes"]));
    const create = requestMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    expect((create?.[1] as { body?: unknown }).body).toEqual({ locale: "vi" });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/org/team/documents/d1"));
  });

  it("names no page to a member it is closed to", async () => {
    respond({ ...finalized, document_id: null, finalized_version_id: null, finalized_version: null, can_edit: false });
    renderSection(true);
    expect(await screen.findByText("Đã chốt")).toBeInTheDocument();
    expect(screen.getByText("Bạn không có quyền xem UniNote biên bản.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mở biên bản" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem bản đã chốt/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Cần quyền chỉnh sửa UniNote biên bản để chốt hoặc bỏ chốt")).not.toBeInTheDocument();
  });

  it("says why the finalized version cannot open when its page cannot be read", async () => {
    respond(finalized);
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      String(path) === "/api/v1/documents/d1" ? Promise.reject(new Error("gone")) : base(path, init),
    );
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Xem bản đã chốt (phiên bản 2)" }));
    // Said in the card, not in a dialog opened only to say so.
    expect(await screen.findByText(/^Không mở được bản đã chốt/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the date alone, not a former member, while members load", async () => {
    respond(finalized);
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      String(path).endsWith("/members") ? new Promise(() => {}) : base(path, init),
    );
    renderSection();
    expect(await screen.findByText(/^Chốt ngày Thứ Ba, 20 tháng 10$/)).toBeInTheDocument();
    expect(screen.queryByText(/Thành viên đã rời/)).not.toBeInTheDocument();
  });

  it("says the minutes did not load and retries", async () => {
    respond(null);
    const base = requestMock.getMockImplementation()!;
    let fail = true;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      fail && String(path).endsWith("/minutes") ? Promise.reject(new ApiError("down", "forbidden", 403)) : base(path, init),
    );
    renderSection();
    expect(await screen.findByText("Không tải được biên bản.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("button", { name: "Lập biên bản" })).toBeInTheDocument();
  });

  it("shows a draft with its page and the finalize action", async () => {
    respond(draft, { finalize: finalized });
    renderSection();
    expect(await screen.findByText("Nháp")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở biên bản" })).toHaveAttribute("href", "/org/team/documents/d1");
    expect(screen.queryByRole("button", { name: "Bỏ chốt" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chốt biên bản" }));
    await waitFor(() => expect(posted()).toEqual(["/api/v1/meetings/m1/minutes/finalize"]));
    expect(await screen.findByText("Đã chốt")).toBeInTheDocument();
  });

  it("shows who finalized which version, warns about a later edit and reopens", async () => {
    respond({ ...finalized, edited_since_finalized: true }, { reopen: draft });
    renderSection();
    expect(await screen.findByText("Đã chốt")).toBeInTheDocument();
    expect(await screen.findByText("Chốt ngày Thứ Ba, 20 tháng 10 · Mai Anh")).toBeInTheDocument();
    // A soft state chip, and reopening is the quietest action.
    expect(screen.getByText("Đã chốt")).toHaveAttribute("data-tone", "success");
    expect(screen.getByRole("button", { name: "Xem bản đã chốt (phiên bản 2)" })).toBeInTheDocument();
    expect(screen.getByText("Đã sửa sau khi chốt. Chốt lại để ghi nhận bản mới.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chốt lại" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bỏ chốt" }));
    await waitFor(() => expect(posted()).toEqual(["/api/v1/meetings/m1/minutes/reopen"]));
    expect(await screen.findByText("Nháp")).toBeInTheDocument();
  });

  it("keeps the commands from a clerk without edit on the page, and from everyone else", async () => {
    respond({ ...finalized, can_edit: false });
    const { unmount } = renderSection(true);
    expect(await screen.findByText("Đã chốt")).toBeInTheDocument();
    expect(screen.getByText("Cần quyền chỉnh sửa UniNote biên bản để chốt hoặc bỏ chốt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ chốt" })).not.toBeInTheDocument();
    unmount();

    respond(null);
    renderSection(false);
    expect(await screen.findByText("Chưa có biên bản.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lập biên bản" })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDetailRoster } from "./meeting-detail-aside";
import { MeetingParticipantsSection } from "./meeting-participants-section";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  starts_at: "2026-09-22T02:00:00Z",
  ends_at: "2026-09-22T02:30:00Z",
  status: "SCHEDULED",
  host_user_id: "u-host",
} as Meeting;

function participantsRespond(participants: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/participants")) return participants();
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
}

const EMPTY = "Chưa có ai trong phòng.";

function renderSection() {
  render(
    wrapWithNav(
      <MeetingParticipantsSection workspaceId="w1" meeting={meeting} invitations={[]} canManage={false} />,
    ),
  );
}

describe("MeetingParticipantsSection", () => {
  it("shows a loading skeleton, not the empty copy, while participants load", () => {
    participantsRespond(() => new Promise(() => {}));
    renderSection();

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    participantsRespond(() => Promise.resolve({ participants: [] }));
    renderSection();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when participants fail", async () => {
    participantsRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderSection();

    expect(await screen.findByText("Không tải được danh sách người tham dự.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    participantsRespond(() => Promise.resolve({ participants: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  function rosterRespond() {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", display_name_snapshot: "Me", role: "HOST", status: "ACTIVE" },
            { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Lan Anh", role: "ATTENDEE", status: "ACTIVE" },
            { id: "p-guest", meeting_id: "m1", principal_type: "GUEST", guest_id: "g1", display_name_snapshot: "Khách Hà", role: "ATTENDEE", status: "ACTIVE" },
          ],
        });
      }
      if (p.endsWith("/members")) {
        return Promise.resolve({
          members: [
            { workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" },
            { workspace_id: "w1", user_id: "u-lan", role: "member", email: "lan@x.com", display_name: "Lan Anh" },
            { workspace_id: "w1", user_id: "u-tuan", role: "member", email: "tuan@x.com", display_name: "Tuấn" },
          ],
        });
      }
      return Promise.resolve({});
    });
  }

  function renderManaged() {
    render(
      wrapWithNav(
        <MeetingParticipantsSection workspaceId="w1" meeting={meeting} invitations={[]} canManage showTransferHost />,
      ),
    );
  }

  it("hands the host role over from the attendee's row menu, after a plain confirm", async () => {
    rosterRespond();
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Lan Anh" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chuyển chủ trì…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Lan Anh sẽ trở thành chủ trì/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Chuyển/ }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1/host-transfer",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("labels secretaries and observers beside their names", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Lan Anh", role: "ATTENDEE", status: "ACTIVE", standing: "MEMBER", is_secretary: true },
            { id: "p-tuan", meeting_id: "m1", principal_type: "USER", user_id: "u-tuan", display_name_snapshot: "Tuấn", role: "ATTENDEE", status: "ACTIVE", standing: "OBSERVER", is_secretary: false },
          ],
        });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
    renderSection();

    const lan = (await screen.findByText("Lan Anh")).closest("li")!;
    expect(within(lan).getByText("Thư ký")).toBeInTheDocument();
    const tuan = screen.getByText("Tuấn").closest("li")!;
    expect(within(tuan).getByText("Dự thính")).toBeInTheDocument();
  });

  it("sets roles from the row menu", async () => {
    rosterRespond();
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Lan Anh" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Giao vai thư ký" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1/participants/p-lan",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("never offers the host role to a guest", async () => {
    rosterRespond();
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Khách Hà" }));
    expect(await screen.findByRole("menuitem", { name: "Gỡ" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
  });

  it("gives the host's own row its standing only, plus lifting a secretary role", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", display_name_snapshot: "Me", role: "HOST", status: "ACTIVE", standing: "MEMBER", is_secretary: true },
          ],
        });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({ participant: { id: "p-host", meeting_id: "m1", principal_type: "USER", role: "HOST", status: "ACTIVE" } });
    });
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Me" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chuyển sang dự thính" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p-host", {
        method: "PATCH",
        body: { standing: "OBSERVER" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Thao tác với Me" }));
    expect(await screen.findByRole("menuitem", { name: "Bỏ vai thư ký" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Chuyển sang dự thính", "Bỏ vai thư ký"]);
  });

  it("never hands the host the secretary role, and locks standing once the roll is finalized", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/participants")) {
        return Promise.resolve({
          participants: [
            { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", display_name_snapshot: "Me", role: "HOST", status: "ACTIVE", standing: "OBSERVER" },
          ],
        });
      }
      if (p.endsWith("/attendance")) {
        return Promise.resolve({
          finalized_at: "2026-09-22T02:20:00Z",
          summary: { members: 0, present: 0, late: 0, excused: 0, absent: 0 },
          rows: [],
        });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
    render(
      wrapWithNav(
        <MeetingParticipantsSection workspaceId="w1" meeting={{ ...meeting, status: "IN_PROGRESS" }} invitations={[]} canManage />,
      ),
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance"));
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Me" }));
    const standing = await screen.findByRole("menuitem", { name: "Chuyển về thành viên" });
    await waitFor(() => expect(standing).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByText("Mở lại điểm danh để đổi tư cách")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Giao vai thư ký" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gỡ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
  });

  it("never offers the host role to an account outside the workspace", async () => {
    rosterRespond();
    const roster = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
      String(path).endsWith("/participants")
        ? Promise.resolve({
            participants: [
              { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Lan Anh", role: "ATTENDEE", status: "ACTIVE" },
              // Signed in, came by link: a USER the workspace does not list.
              { id: "p-out", meeting_id: "m1", principal_type: "USER", user_id: "u-out", display_name_snapshot: "Đối tác", role: "ATTENDEE", status: "ACTIVE", standing: "OBSERVER" },
            ],
          })
        : roster?.(path, ...rest),
    );
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Đối tác" }));
    expect(await screen.findByRole("menuitem", { name: "Gỡ" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
  });

  describe("after the meeting ends", () => {
    function rosterAfter(status: Meeting["status"]) {
      rosterRespond();
      const roster = requestMock.getMockImplementation();
      requestMock.mockImplementation((path: unknown, ...rest: unknown[]) =>
        String(path).endsWith("/attendance")
          ? Promise.resolve({ summary: { members: 1, present: 1, late: 0, excused: 0, absent: 0 }, rows: [] })
          : roster?.(path, ...rest),
      );
      render(
        wrapWithNav(
          <MeetingDetailRoster workspaceId="w1" meeting={{ ...meeting, status }} invitations={[]} canHost />,
        ),
      );
    }

    it("still lets the host hand out the secretary role and standing, but not change who is on it", async () => {
      rosterAfter("ENDED");
      fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Lan Anh" }));
      expect(await screen.findByRole("menuitem", { name: "Giao vai thư ký" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Chuyển sang dự thính" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Gỡ" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Thêm người" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("menuitem", { name: "Giao vai thư ký" }));
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p-lan", {
          method: "PATCH",
          body: { is_secretary: true },
        }),
      );
    });

    it("offers nothing on a canceled meeting", async () => {
      rosterAfter("CANCELED");
      await screen.findByText("Lan Anh");
      expect(screen.queryByRole("button", { name: "Thao tác với Lan Anh" })).not.toBeInTheDocument();
    });
  });

  it("does not fetch the roll for a meeting that has not started", async () => {
    rosterRespond();
    renderManaged();
    await screen.findByText("Lan Anh");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/attendance");
  });

  it("invites from the panel header instead of a picker that grabs focus on load", async () => {
    rosterRespond();
    renderManaged();

    await screen.findByText("Lan Anh");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm người" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows an attendee's email under their name, not the panel title again", async () => {
    rosterRespond();
    renderManaged();

    const row = (await screen.findByText("Lan Anh")).closest("li")!;
    expect(within(row).getByText("lan@x.com")).toBeInTheDocument();
    expect(within(row).queryByText("Người tham dự")).not.toBeInTheDocument();
  });
});

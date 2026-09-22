import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
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

  it("never offers the host role to a guest", async () => {
    rosterRespond();
    renderManaged();

    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Khách Hà" }));
    expect(await screen.findByRole("menuitem", { name: "Gỡ" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chuyển chủ trì…" })).not.toBeInTheDocument();
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

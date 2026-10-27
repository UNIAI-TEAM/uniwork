import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import type { RoomExit } from "./exit-model";
import { MeetingExitScreen } from "./meeting-exit-screen";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const me: User = {
  id: "u-host",
  email: "host@x.com",
  display_name: "Demo UniChat",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Tổng kết dự án Sao Mai",
  description: "",
  starts_at: "2026-10-27T08:40:00Z",
  ends_at: "2026-10-27T09:40:00Z",
  actual_start_at: "2026-10-27T08:40:00Z",
  status: "IN_PROGRESS",
  host_user_id: "u-host",
  room_name: "uw_mtg_m1",
  created_by: "u-host",
} as Meeting;

const person = (id: string, name: string, inRoom: boolean, extra: object = {}) => ({
  id, meeting_id: "m1", principal_type: "USER", user_id: `u-${id}`, display_name_snapshot: name,
  role: "ATTENDEE", status: "ACTIVE", in_room: inRoom, ...extra,
});
const participants = [
  person("host", "Demo UniChat", false),
  person("minh", "Võ Minh", true),
  person("lan", "Hoàng Lan", true, { is_secretary: true }),
];

let pending: unknown[] = [];
let recordings: unknown[] = [];
let transfer: () => Promise<unknown> = () => Promise.resolve({ meeting });
const calls = (suffix: string) => requestMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  pending = [];
  recordings = [];
  transfer = () => Promise.resolve({ meeting });
  vi.mocked(toast.error).mockClear();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/participants")) return Promise.resolve({ participants });
    if (path.endsWith("/join-requests")) return Promise.resolve({ join_requests: pending });
    if (path.endsWith("/recordings")) return Promise.resolve({ recordings });
    if (path.endsWith("/host-transfer")) return transfer();
    return Promise.resolve({});
  });
});

function renderExit(exit: RoomExit) {
  const handlers = { onRejoin: vi.fn(), onBackToMeeting: vi.fn(), onEndForAll: vi.fn(), onExitChange: vi.fn() };
  render(
    wrapWithNav(
      <MeetingExitScreen
        exit={exit}
        meetingId="m1"
        meeting={meeting}
        workspaceId="w1"
        meetingsHref="/demo/team/meetings"
        selfParticipantId="host"
        {...handlers}
      />,
    ),
  );
  return handlers;
}

const media = { audio: true, video: false };

describe("leave screen B: the host stepped out", () => {
  it("says the viewer still runs the room and lets them admit and stop the recording from outside", async () => {
    pending = [
      { id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Trần Nam" },
      { id: "jr2", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Khách Hà" },
    ];
    recordings = [{ id: "r1", meeting_id: "m1", status: "ACTIVE", started_at: "2026-10-27T08:45:00Z" }];
    renderExit({ kind: "leftHost", media });
    expect(await screen.findByText("Bạn vẫn là chủ trì")).toBeInTheDocument();
    const waiting = await screen.findByRole("region", { name: "Đang chờ bạn" });
    expect(within(waiting).getByText("2 người xin vào")).toBeInTheDocument();
    expect(await within(waiting).findByText("Đang ghi hình")).toBeInTheDocument();

    fireEvent.click(within(waiting).getByRole("button", { name: "Cho vào" }));
    await waitFor(() => expect(calls("/meeting-join-requests/jr2/approve")).toHaveLength(1));
    expect(calls("/meeting-join-requests/jr1/approve")).toHaveLength(1);
    fireEvent.click(within(waiting).getByRole("button", { name: "Dừng ghi" }));
    await waitFor(() => expect(calls("/recording/stop")).toHaveLength(1));
  });

  it("shows no waiting card when nothing waits", async () => {
    renderExit({ kind: "leftHost", media });
    await screen.findByText("Bạn vẫn là chủ trì");
    await screen.findByText("2 người vẫn đang họp");
    expect(screen.queryByRole("region", { name: "Đang chờ bạn" })).not.toBeInTheDocument();
  });

  it("hands the room to someone still in it and turns into the handover screen", async () => {
    const { onExitChange } = renderExit({ kind: "leftHost", media });
    fireEvent.click(await screen.findByRole("button", { name: "Chuyển quyền…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Võ Minh/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Chuyển cho Võ Minh" }));
    await waitFor(() =>
      expect(onExitChange).toHaveBeenCalledExactlyOnceWith({ kind: "handedOver", media, toUserId: "u-minh", toName: "Võ Minh" }),
    );
    expect(calls("/host-transfer")[0]?.[1]).toMatchObject({ method: "POST", body: { new_host_user_id: "u-minh" } });
  });

  it("stays on B and refreshes the roster when the pick already left", async () => {
    transfer = () => Promise.reject(new ApiError("left", "invalid_host_transferee", 409));
    const { onExitChange } = renderExit({ kind: "leftHost", media });
    fireEvent.click(await screen.findByRole("button", { name: "Chuyển quyền…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("radio", { name: /Hoàng Lan/ });
    const before = calls("/participants").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Chuyển cho Hoàng Lan" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onExitChange).not.toHaveBeenCalled();
    await waitFor(() => expect(calls("/participants").length).toBeGreaterThan(before));
  });

  it("ends the meeting for everyone through the room", async () => {
    const { onEndForAll } = renderExit({ kind: "leftHost", media });
    fireEvent.click(await screen.findByRole("button", { name: "Kết thúc cho mọi người" }));
    expect(onEndForAll).toHaveBeenCalledOnce();
  });
});

describe("leave screen C: the host handed the room over", () => {
  it("names who runs the room now and rejoins as a participant", async () => {
    const { onRejoin } = renderExit({ kind: "handedOver", media, toUserId: "u-minh", toName: "Võ Minh" });
    expect(await screen.findByRole("heading", { name: "Võ Minh đang chủ trì" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Quyền chủ trì chuyển từ bạn sang Võ Minh" })).toBeInTheDocument();
    expect(screen.getByText("Vào lại với vai người tham dự")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vào lại" }));
    expect(onRejoin).toHaveBeenCalledExactlyOnceWith(media);
  });
});

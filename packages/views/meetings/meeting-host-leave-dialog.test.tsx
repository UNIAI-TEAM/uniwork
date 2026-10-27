import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingHostLeaveDialog } from "./meeting-host-leave-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const room = vi.hoisted(() => ({
  people: [] as { identity: string; name: string; isLocal: boolean }[],
}));
vi.mock("@livekit/components-react", () => ({ useParticipants: () => room.people }));

const user = (id: string): User => ({
  id,
  email: `${id}@x.com`,
  display_name: id,
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Giao ban",
  description: "",
  starts_at: "2026-10-27T09:00:00Z",
  ends_at: "2026-10-27T10:00:00Z",
  status: "IN_PROGRESS",
  host_user_id: "u-host",
} as Meeting;

const participants = [
  { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", display_name_snapshot: "Chủ", role: "MODERATOR", status: "ACTIVE" },
  { id: "p-minh", meeting_id: "m1", principal_type: "USER", user_id: "u-minh", display_name_snapshot: "Minh", role: "ATTENDEE", status: "ACTIVE" },
  { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Lan", role: "ATTENDEE", status: "ACTIVE", is_secretary: true },
  { id: "p-guest", meeting_id: "m1", principal_type: "GUEST", display_name_snapshot: "Khách", role: "ATTENDEE", status: "ACTIVE" },
];

const seat = (id: string, name: string, isLocal = false) => ({ identity: `uw_participant_${id}`, name, isLocal });

function serve(joinRequests: unknown[] = []) {
  requestMock.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path.endsWith("/participants")) return Promise.resolve({ participants });
    if (path.endsWith("/join-requests")) return Promise.resolve({ join_requests: joinRequests });
    if (path.endsWith("/host-transfer") || path.endsWith("/end")) return Promise.resolve({ meeting });
    return Promise.resolve({});
  });
}

const calls = (suffix: string) => requestMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix));

const media = { audio: true, video: false };

function renderDialog(recording = false) {
  const onExit = vi.fn();
  const onEndForAll = vi.fn();
  render(
    wrapWithNav(
      <MeetingHostLeaveDialog
        open
        onOpenChange={() => {}}
        meeting={meeting}
        workspaceId="w1"
        recording={recording}
        media={media}
        onExit={onExit}
        onEndForAll={onEndForAll}
      />,
    ),
  );
  return { onExit, onEndForAll };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockClear();
  setSessionUser(user("u-host"));
  room.people = [seat("p-host", "Chủ", true), seat("p-minh", "Minh"), seat("p-lan", "Lan"), seat("p-guest", "Khách")];
  serve();
});

describe("MeetingHostLeaveDialog", () => {
  it("hands the room to the secretary by default, then leaves", async () => {
    const { onExit } = renderDialog();
    // Guests cannot take the host role, so only the two members are offered, the secretary first.
    const lan = await screen.findByRole("radio", { name: /Lan/ });
    expect(lan).toBeChecked();
    expect(screen.getByRole("radio", { name: /Minh/ })).not.toBeChecked();
    expect(screen.queryByRole("radio", { name: /Khách/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Chuyển quyền rồi rời/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Minh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Chuyển cho Minh và rời" }));

    await waitFor(() =>
      expect(onExit).toHaveBeenCalledExactlyOnceWith({ kind: "handedOver", media, toUserId: "u-minh", toName: "Minh" }),
    );
    expect(calls("/host-transfer")).toHaveLength(1);
    expect(calls("/host-transfer")[0]?.[1]).toMatchObject({ method: "POST", body: { new_host_user_id: "u-minh" } });
    // The handover screen says it; no toast on top.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("hands ending for everyone to the room, which shows the wait", async () => {
    const { onEndForAll, onExit } = renderDialog();
    await screen.findByRole("radio", { name: /Lan/ });
    fireEvent.click(screen.getByRole("radio", { name: /Kết thúc cho mọi người/ }));
    fireEvent.click(screen.getByRole("button", { name: "Kết thúc họp" }));
    expect(onEndForAll).toHaveBeenCalledOnce();
    expect(onExit).not.toHaveBeenCalled();
    expect(calls("/end")).toHaveLength(0);
    expect(calls("/host-transfer")).toHaveLength(0);
  });

  it("just leaves, and shows what keeps going without the host", async () => {
    serve([{ id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Người lạ" }]);
    const { onExit } = renderDialog(true);
    expect(await screen.findByText("1 người đang chờ vào")).toBeInTheDocument();
    expect(screen.getByText("Ghi hình vẫn chạy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Chỉ rời phòng/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rời ngay" }));
    expect(onExit).toHaveBeenCalledExactlyOnceWith({ kind: "leftHost", media });
    expect(calls("/host-transfer")).toHaveLength(0);
    expect(calls("/end")).toHaveLength(0);
  });

  it("offers ending first to a host alone in the room, and no one to hand over to", async () => {
    room.people = [seat("p-host", "Chủ", true)];
    renderDialog();
    expect(await screen.findByRole("radio", { name: /Kết thúc cho mọi người/ })).toBeChecked();
    // Base UI's radio is a span: disabled reads as aria-disabled.
    expect(screen.getByRole("radio", { name: /Chuyển quyền rồi rời/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Chưa có thành viên nào khác trong phòng")).toBeInTheDocument();
  });

  it("gives a workspace admin who is not the host only end or leave", async () => {
    setSessionUser(user("u-admin"));
    renderDialog();
    expect(await screen.findByRole("radio", { name: /Chỉ rời phòng/ })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Chuyển quyền rồi rời/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rời cuộc họp?" })).toBeInTheDocument();
  });
});

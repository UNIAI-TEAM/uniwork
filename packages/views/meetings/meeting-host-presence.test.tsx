import { QueryClient } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingHostAwayChip, MeetingHostChangeToasts } from "./meeting-host-presence";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const room = vi.hoisted(() => ({ people: [] as { identity: string; name: string; isLocal: boolean }[] }));
vi.mock("@livekit/components-react", () => ({
  useParticipants: () => room.people,
  useConnectionState: () => "connected",
}));

const me: User = {
  id: "u-me",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const meeting = (host: string) =>
  ({ id: "m1", workspace_id: "w1", title: "Giao ban", status: "IN_PROGRESS", host_user_id: host }) as Meeting;

const participants = [
  { id: "p-me", meeting_id: "m1", principal_type: "USER", user_id: "u-me", display_name_snapshot: "Me", role: "ATTENDEE", status: "ACTIVE" },
  { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Lan", role: "MODERATOR", status: "ACTIVE" },
  { id: "p-minh", meeting_id: "m1", principal_type: "USER", user_id: "u-minh", display_name_snapshot: "Minh", role: "ATTENDEE", status: "ACTIVE" },
];

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ participants });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
  setSessionUser(me);
  room.people = [{ identity: "uw_participant_p-me", name: "Me", isLocal: true }];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingHostChangeToasts", () => {
  it("tells the new host, then everyone else who holds the room now", async () => {
    // One client across rerenders: the names come from the cached participants.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nav = fakeNav();
    const at = (host: string) => wrapWithNav(<MeetingHostChangeToasts meeting={meeting(host)} />, nav, client);
    const { rerender } = render(at("u-lan"));
    await vi.waitFor(() => expect(client.getQueryData(["meeting-participants", "m1"])).toBeDefined());
    expect(toast.success).not.toHaveBeenCalled();

    rerender(at("u-me"));
    expect(toast.success).toHaveBeenCalledWith("Bạn là chủ trì", expect.objectContaining({ position: "top-center" }));

    // Handed on by me: my own dialog already said so.
    rerender(at("u-minh"));
    expect(toast.info).not.toHaveBeenCalled();

    rerender(at("u-lan"));
    expect(toast.info).toHaveBeenCalledWith("Lan giờ là chủ trì", expect.anything());
  });
});

describe("MeetingHostAwayChip", () => {
  it("appears once the room settles without the host, and not while they are in it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nav = fakeNav();
    const chip = () => wrapWithNav(<MeetingHostAwayChip meeting={meeting("u-lan")} canHost={false} />, nav, client);
    const { rerender } = render(chip());
    expect(screen.queryByTestId("meeting-host-away-chip")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(await screen.findByTestId("meeting-host-away-chip")).toHaveAccessibleName("Chủ trì vắng mặt");

    room.people = [...room.people, { identity: "uw_participant_p-lan", name: "Lan", isLocal: false }];
    rerender(chip());
    expect(screen.queryByTestId("meeting-host-away-chip")).not.toBeInTheDocument();
  });
});

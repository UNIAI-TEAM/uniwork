// The calls tab's row and chips, as a person hears them: who, which way, how
// it went and when; calling back follows the server's kill switch.
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { callEngine } from "@/data/calls/call-store";
import type { CallLog } from "@/data/queries/call-logs";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "@/data/remote-config";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { render, viText } from "@/test/render";
import { CallLogFilters } from "./call-log-filters";
import { CallLogRow, CallLogSeparator } from "./call-log-row";

// The permission gate grants everything here: this test is about its caller. The gate itself, on the
// expo permission modules, is components/ui/permission-gate.test.tsx.
jest.mock("@/components/ui/permission-gate", () => ({
  permissionGate: { ensure: jest.fn(async () => true) },
  ensureCallPermissions: jest.fn(async () => undefined),
}));

jest.mock("@/data/calls/call-store", () => ({ callEngine: { startCall: jest.fn(async () => undefined) } }));

const log = (extra: Partial<CallLog> = {}): CallLog => ({
  message_id: "m1",
  room_id: "r1",
  room_kind: "dm",
  room_name: "",
  peer_user_id: "u2",
  call_id: "c1",
  outcome: "completed",
  video: false,
  caller_id: "u1",
  caller_name: "An",
  duration_seconds: 65,
  ended_at: "2026-10-20T09:05:00Z",
  participants: [],
  ...extra,
});

function withCalls(on: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  queryClient.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_calls: on } });
  return { queryClient };
}

beforeEach(() => jest.clearAllMocks());

describe("CallLogRow", () => {
  it("names the person, the direction and the outcome, opens the room, and calls back by voice", async () => {
    const open = jest.fn();
    await render(<CallLogRow log={log()} userId="u1" nicknames={{ u2: "Bình" }} onPress={open} />, withCalls(true));
    const row = screen.getByRole("button", { name: new RegExp(`^Bình, ${viText("mobile.calls.outgoing")}, `) });
    await fireEvent.press(row);
    expect(open).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.voice_call_call_back")} Bình` }));
    await waitFor(() => expect(callEngine.startCall).toHaveBeenCalledWith("r1", "Bình", "dm", { withCamera: false }));
    expect(ensureCallPermissions).toHaveBeenCalledWith(false);
  });

  it("marks a group's missed video call, and calls back with the camera", async () => {
    await render(
      <CallLogRow log={log({ room_kind: "group", room_name: "Thiết kế", caller_id: "u2", outcome: "unanswered", video: true, peer_user_id: undefined })} userId="u1" nicknames={{}} onPress={jest.fn()} />,
      withCalls(true),
    );
    expect(screen.getByText(viText("chat.video_call_log_missed"))).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: new RegExp(`^Thiết kế, ${viText("mobile.calls.incoming")}, `) })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.voice_call_call_back")} Thiết kế` }));
    await waitFor(() => expect(callEngine.startCall).toHaveBeenCalledWith("r1", "Thiết kế", "group", { withCamera: true }));
  });

  it("keeps the history but offers no call back while the server has calling off", async () => {
    await render(<CallLogRow log={log({ peer_user_id: undefined })} userId="u1" nicknames={{}} onPress={jest.fn()} />, withCalls(false));
    expect(screen.queryByTestId("calls-row-callback")).toBeNull();
  });

  it("is separated past the avatar", async () => {
    await render(<CallLogSeparator />);
    expect(screen.toJSON()).not.toBeNull();
  });
});

describe("CallLogFilters", () => {
  it("picks a filter and says how many missed calls are loaded, capped at 99+", async () => {
    const pick = jest.fn();
    const view = await render(<CallLogFilters value="all" onChange={pick} missedCount={3} />);
    expect(screen.getByRole("button", { name: viText("chat.filter_all"), selected: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: `${viText("mobile.calls.filter_missed")}, 3` }));
    expect(pick).toHaveBeenCalledWith("missed");
    await view.rerender(<CallLogFilters value="missed" onChange={pick} missedCount={120} />);
    expect(screen.getByRole("button", { name: `${viText("mobile.calls.filter_missed")}, 120`, selected: true })).toBeOnTheScreen();
    expect(screen.getByText("99+")).toBeOnTheScreen();
    await view.rerender(<CallLogFilters value="missed" onChange={pick} missedCount={0} />);
    expect(screen.getByRole("button", { name: viText("mobile.calls.filter_missed") })).toBeOnTheScreen();
    expect(screen.queryByText("0")).toBeNull();
  });
});

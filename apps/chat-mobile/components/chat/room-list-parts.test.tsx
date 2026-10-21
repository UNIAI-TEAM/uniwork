// The chat list's own controls (room-list-parts.tsx) on Android: each reaches
// 48 dp of target (chips and tabs side by side only grow up and down, so a tap
// never lands on the neighbour) and answers a press with a ripple.
import { screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { render, viText } from "@/test/render";
import { FilterChips, RoomListEmpty, RoomListError, ScopeSwitch, WorkspacePill } from "./room-list-parts";

beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));
afterEach(() => jest.restoreAllMocks());

const ripple = expect.objectContaining({ type: "RippleAndroid" });
const control = (role: "button" | "tab", name: string | RegExp) => screen.getByRole(role, { name });

describe("room list controls on Android", () => {
  it("grows the workspace pill and the retry button to 48 dp, with a ripple", async () => {
    await render(
      <>
        <WorkspacePill name="HQ" onPress={jest.fn()} />
        <RoomListError onRetry={jest.fn()} />
      </>,
    );
    for (const name of [viText("chat.mobile.workspace_pill_aria_quiet", { name: "HQ" }), new RegExp(viText("common.retry"))]) {
      expect(control("button", name).props.hitSlop).toBe(2);
      expect(control("button", name).props.nativeBackgroundAndroid).toEqual(ripple);
    }
  });

  it("grows the 34 pt filter chips and the scope tabs up and down only", async () => {
    await render(
      <>
        <FilterChips value="all" onChange={jest.fn()} mentionRooms={0} />
        <ScopeSwitch value="messages" onChange={jest.fn()} workspaceName="HQ" workspaceSeed="w1" messages={undefined} channels={undefined} />
      </>,
    );
    const chip = control("button", viText("chat.filter_unread"));
    expect(chip.props.hitSlop).toEqual({ top: 7, bottom: 7 });
    expect(chip.props.nativeBackgroundAndroid).toEqual(ripple);
    const tab = control("tab", new RegExp(viText("chat.scope.channels_tab")));
    expect(tab.props.hitSlop).toEqual({ top: 2, bottom: 2 });
    expect(tab.props.nativeBackgroundAndroid).toEqual(ripple);
  });

  it("ripples on the empty list's 48 dp buttons", async () => {
    await render(<RoomListEmpty searching={false} filter="all" onStartDm={jest.fn()} onBrowseChannels={jest.fn()} />);
    expect(control("button", new RegExp(viText("chat.start_dm_title"))).props.nativeBackgroundAndroid).toEqual(ripple);
  });
});

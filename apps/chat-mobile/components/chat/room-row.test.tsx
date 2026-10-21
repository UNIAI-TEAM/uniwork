import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { RoomRow, type RoomRowProps } from "./room-row";

const props = (extra: Partial<RoomRowProps> = {}): RoomRowProps => ({
  title: "Bình",
  mark: { kind: "dm", label: "Bình", online: false },
  seed: "dm1",
  prefix: null,
  subtitle: "Mai họp nhé",
  typing: false,
  time: "09:41",
  unread: 0,
  mentionUnread: 0,
  muted: false,
  pinned: false,
  onPress: jest.fn(),
  onLongPress: jest.fn(),
  testID: "room-row-dm1",
  ...extra,
});

describe("RoomRow", () => {
  it("reads the whole row as one button: name, last message, time", async () => {
    await render(<RoomRow {...props()} />);
    const row = screen.getByRole("button", { name: "Bình, Mai họp nhé, 09:41" });
    expect(row).toHaveProp("testID", "room-row-dm1");
    expect(screen.getByText("Mai họp nhé")).toBeOnTheScreen();
  });

  it("reads a group's sender prefix with its message", async () => {
    await render(<RoomRow {...props({ title: "Thiết kế", mark: { kind: "group", label: "Thiết kế" }, prefix: "An: ", subtitle: "ok" })} />);
    expect(screen.getByRole("button", { name: "Thiết kế, An: ok, 09:41" })).toBeOnTheScreen();
  });

  it("says seen, mentions, unread, muted and pinned in that order", async () => {
    await render(<RoomRow {...props({ seen: true, unread: 4, mentionUnread: 1, muted: true, pinned: true })} />);
    const name = [
      "Bình",
      "Mai họp nhé",
      "09:41",
      viText("chat.sidebar_seen_aria"),
      viText("chat.mention_unread_badge_aria", { count: 1 }),
      viText("chat.unread_badge_aria", { count: 4 }),
      viText("chat.sidebar_conversation_muted_aria"),
      viText("chat.sidebar_conversation_pinned_aria"),
    ].join(", ");
    expect(screen.getByRole("button", { name })).toBeOnTheScreen();
    expect(screen.getByText("@")).toBeOnTheScreen();
    expect(screen.getByText("4")).toBeOnTheScreen();
  });

  it("caps the unread badge at 99+ but reads the real count", async () => {
    await render(<RoomRow {...props({ unread: 120 })} />);
    expect(screen.getByText("99+")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: `Bình, Mai họp nhé, 09:41, ${viText("chat.unread_badge_aria", { count: 120 })}` })).toBeOnTheScreen();
  });

  it("shows a message waiting for the network instead of the last one", async () => {
    await render(<RoomRow {...props({ queued: true })} />);
    expect(screen.getByText(viText("chat.mobile.send_queued"))).toBeOnTheScreen();
    expect(screen.queryByText("Mai họp nhé")).toBeNull();
    expect(screen.getByRole("button", { name: `Bình, ${viText("chat.mobile.send_queued")}, 09:41` })).toBeOnTheScreen();
  });

  it("reads a room with no message and no time by its name alone", async () => {
    await render(<RoomRow {...props({ subtitle: null, time: null })} />);
    expect(screen.getByRole("button", { name: "Bình" })).toBeOnTheScreen();
  });

  it("opens on a press, and manages on a long press or the screen reader's action", async () => {
    const p = props();
    await render(<RoomRow {...p} />);
    const row = screen.getByRole("button", { name: "Bình, Mai họp nhé, 09:41" });
    await fireEvent.press(row);
    expect(p.onPress).toHaveBeenCalledTimes(1);
    const haptics = jest.requireMock<{ impactAsync: jest.Mock }>("expo-haptics");
    haptics.impactAsync.mockClear();
    await fireEvent(row, "longPress");
    // A long press is felt; the screen reader's action is not a touch.
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
    expect(p.onLongPress).toHaveBeenCalledTimes(2);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(row.props.accessibilityActions).toEqual([{ name: "longpress", label: viText("chat.settings_manage_room") }]);
  });

  it("shows a draft left unsent in place of the last message, and reads it so", async () => {
    await render(<RoomRow {...props({ draft: "Mai họp lúc 9 giờ", prefix: "Bạn: " })} />);
    expect(screen.getByText(viText("chat.sidebar_draft_label"))).toBeOnTheScreen();
    expect(screen.queryByText("Mai họp nhé")).toBeNull();
    expect(screen.getByRole("button", { name: `Bình, ${viText("chat.sidebar_draft_label")} Mai họp lúc 9 giờ, 09:41` })).toBeOnTheScreen();
  });
});

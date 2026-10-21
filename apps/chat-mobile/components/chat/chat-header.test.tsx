// A pushed chat screen's header (chat-header.tsx): back goes back and says
// what waits elsewhere, Android's back is its arrow and 48 dp of target, and
// a conversation's title opens its details.
import { fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Platform, Text } from "react-native";
import { render, viText } from "@/test/render";
import { ChatHeader } from "./chat-header";

const os = Platform.OS;
afterEach(() => {
  Platform.OS = os;
  jest.clearAllMocks();
});

const backButton = () => screen.getByRole("button", { name: new RegExp(`^${viText("common.back")}`) });

describe("ChatHeader", () => {
  it("goes back, and reads the unread waiting elsewhere with the back button", async () => {
    await render(<ChatHeader title="Thiết kế" subtitle="3 thành viên" backBadge={120} />);
    expect(screen.getByText("99+", { includeHiddenElements: true })).toBeTruthy();
    expect(backButton().props.accessibilityLabel).toBe(`${viText("common.back")}, ${viText("chat.unread_badge_aria", { count: 120 })}`);
    await fireEvent.press(backButton());
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("gives Android's back 48 dp of target and iOS's 44 pt", async () => {
    Platform.OS = "android";
    const { unmount } = await render(<ChatHeader title="Chủ đề" backLabel={viText("common.back")} />);
    expect(backButton().props.hitSlop).toBe(2);
    await unmount();
    Platform.OS = "ios";
    await render(<ChatHeader title="Chủ đề" />);
    expect(backButton().props.hitSlop).toBe(0);
  });

  it("opens a conversation's details from its title, and reads who is typing", async () => {
    const onPressTitle = jest.fn();
    await render(<ChatHeader title="Bình" subtitle="đang nhập…" typing avatar={<Text>B</Text>} onPressTitle={onPressTitle} titleActionLabel="Thông tin" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bình, đang nhập…, Thông tin" }));
    expect(onPressTitle).toHaveBeenCalledTimes(1);
  });
});

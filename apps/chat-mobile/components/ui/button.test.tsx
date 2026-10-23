// The Button primitive's touch contract (audit UX P2): every size reaches the
// platform's minimum target (44 pt on iOS, 48 dp on Android), the small one
// through hit slop, and Android answers a press with a ripple.
import { fireEvent, screen } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { render } from "@/test/render";
import { Button } from "./button";

const os = Platform.OS;
afterEach(() => {
  Platform.OS = os;
});

describe("Button", () => {
  it.each([
    ["ios", "sm", 4],
    ["android", "sm", 6],
    ["ios", "default", 0],
    ["android", "default", 2],
    ["android", "lg", 0],
    ["android", "icon", 2],
  ] as const)("on %s, a %s button gets the hit slop that makes up the minimum target", async (platform, size, slop) => {
    Platform.OS = platform;
    await render(
      <Button size={size} accessibilityLabel="Lưu">
        <Text>Lưu</Text>
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Lưu" }).props.hitSlop).toBe(slop);
  });

  it("keeps a caller's own hit slop and press", async () => {
    const onPress = jest.fn();
    await render(
      <Button size="icon" hitSlop={10} onPress={onPress} accessibilityLabel="Thêm">
        <Text>+</Text>
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Thêm" });
    expect(button.props.hitSlop).toBe(10);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("dims when disabled", async () => {
    await render(
      <Button disabled accessibilityLabel="Gửi">
        <Text>Gửi</Text>
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
  });
});

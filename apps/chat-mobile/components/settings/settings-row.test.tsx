// A Settings row (settings-row.tsx): one line with its value on the right, or
// at the accessibility text sizes a label that wraps with the value under it.
import { fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { render } from "@/test/render";
import { SettingsRow } from "./settings-row";

afterEach(() => jest.restoreAllMocks());

describe("SettingsRow", () => {
  it("reads its label and value as one button and keeps one line at the default size", async () => {
    const onPress = jest.fn();
    await render(<SettingsRow icon="language-outline" label="Ngôn ngữ" value="Tiếng Việt" onPress={onPress} first />);
    await fireEvent.press(screen.getByRole("button", { name: "Ngôn ngữ, Tiếng Việt" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ngôn ngữ").props.numberOfLines).toBe(1);
  });

  it("wraps the label and moves the value under it at the accessibility text sizes", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2 });
    await render(<SettingsRow icon="open-outline" label="Điều khoản sử dụng" value="Web" external destructive onPress={jest.fn()} />);
    expect(screen.getByRole("link", { name: "Điều khoản sử dụng, Web" })).toBeOnTheScreen();
    expect(screen.getByText("Điều khoản sử dụng").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("Web")).toBeOnTheScreen();
  });
});

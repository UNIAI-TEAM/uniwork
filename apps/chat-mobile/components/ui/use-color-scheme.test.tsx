// The app's colour scheme (use-color-scheme.ts): the saved choice is read once
// at boot, the splash waits until it is known, and a choice made in Settings
// applies at once.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { render } from "@/test/render";
import { loadThemePreference, useColorScheme, useThemeReady } from "./use-color-scheme";

jest.mock("@/data/device-preferences", () => ({
  readDevicePreference: jest.fn(async () => "dark"),
  writeDevicePreference: jest.fn(async () => undefined),
}));

function Probe() {
  const ready = useThemeReady();
  const { colorScheme, preference, setPreference } = useColorScheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => setPreference("light")}>
      <Text>{`${ready ? "ready" : "waiting"} ${preference} ${colorScheme}`}</Text>
    </Pressable>
  );
}

describe("useThemeReady and useColorScheme", () => {
  it("waits for the saved choice, applies it, then follows a choice made in Settings", async () => {
    await render(<Probe />);
    expect(screen.getByText(/^waiting system/)).toBeOnTheScreen();
    await act(async () => loadThemePreference());
    expect(screen.getByText("ready dark dark")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button"));
    expect(screen.getByText("ready light light")).toBeOnTheScreen();
  });
});

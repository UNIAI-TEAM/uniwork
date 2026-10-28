import { act, fireEvent, screen } from "@testing-library/react-native";
import { colorScheme } from "nativewind";
import { Dimensions } from "react-native";
import { render, viText } from "@/test/render";
import { AppleSignInButton } from "./apple-sign-in-button";

// Apple's system button is a native view: a pressable stand-in that shows the props it was given.
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress: () => void; buttonStyle: number; buttonType: number; cornerRadius: number; style: object }) => (
      <Pressable accessibilityRole="button" testID="apple-native-button" onPress={props.onPress} style={props.style}>
        <Text>{`style ${props.buttonStyle} type ${props.buttonType} radius ${props.cornerRadius}`}</Text>
      </Pressable>
    ),
  };
});

afterEach(() => act(() => colorScheme.set("light")));

describe("AppleSignInButton", () => {
  it("shows Apple's black Continue button, as round as the buttons beside it, and signs in on a tap", async () => {
    const onPress = jest.fn();
    await render(<AppleSignInButton disabled={false} onPress={onPress} />);
    expect(screen.getByText("style 2 type 1 radius 24")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("apple-native-button"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("apple-sign-in").props.pointerEvents).toBe("auto");
  });

  it("says Sign up on the register screen", async () => {
    await render(<AppleSignInButton signUp disabled={false} onPress={jest.fn()} />);
    expect(screen.getByText("style 2 type 2 radius 24")).toBeOnTheScreen();
  });

  it("is white on the dark screen, and dimmed while another sign-in runs, said so to a screen reader", async () => {
    await act(() => colorScheme.set("dark"));
    await render(<AppleSignInButton disabled onPress={jest.fn()} />);
    expect(screen.getByText("style 0 type 1 radius 24", { includeHiddenElements: true })).toBeTruthy();
    const wrapper = screen.getByTestId("apple-sign-in");
    expect(wrapper.props.pointerEvents).toBe("none");
    // The native button cannot carry a disabled state: the wrapper is the one element VoiceOver and TalkBack meet.
    expect(wrapper.props).toMatchObject({
      accessible: true,
      accessibilityRole: "button",
      accessibilityLabel: viText("auth.social.continueWithApple"),
      accessibilityState: { disabled: true, busy: false },
      style: { opacity: 0.5 },
    });
  });

  it("keeps Apple's own button while its sign-in runs, with a spinner at its end, and takes no second tap", async () => {
    const onPress = jest.fn();
    await render(<AppleSignInButton signUp disabled={false} busy onPress={onPress} />);
    expect(screen.getByText("style 2 type 2 radius 24", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("apple-sign-in").props).toMatchObject({
      accessibilityLabel: viText("auth.social.signingIn"),
      accessibilityState: { disabled: false, busy: true },
      pointerEvents: "none",
    });
    expect(screen.getByTestId("apple-sign-in-busy", { includeHiddenElements: true })).toBeTruthy();
  });

  it("grows with the text size as the Google button beside it does, since its title only follows its height", async () => {
    const window = Dimensions.get("window");
    jest.spyOn(Dimensions, "get").mockReturnValue({ ...window, fontScale: 1.6 });
    await render(<AppleSignInButton disabled={false} onPress={jest.fn()} />);
    expect(screen.getByText("style 2 type 1 radius 38.5")).toBeOnTheScreen();
    expect(screen.getByTestId("apple-native-button").props.style).toMatchObject({ height: 77 });
    jest.restoreAllMocks();
  });
});

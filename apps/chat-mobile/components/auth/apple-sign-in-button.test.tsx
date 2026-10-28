import { act, fireEvent, screen } from "@testing-library/react-native";
import { colorScheme } from "nativewind";
import { render } from "@/test/render";
import { AppleSignInButton } from "./apple-sign-in-button";

// Apple's system button is a native view: a pressable stand-in that shows the props it was given.
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress: () => void; buttonStyle: number; buttonType: number; cornerRadius: number }) => (
      <Pressable accessibilityRole="button" testID="apple-native-button" onPress={props.onPress}>
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

  it("is white on the dark screen and ignores taps while a sign-in runs", async () => {
    await act(() => colorScheme.set("dark"));
    await render(<AppleSignInButton disabled onPress={jest.fn()} />);
    expect(screen.getByText("style 0 type 1 radius 24")).toBeOnTheScreen();
    expect(screen.getByTestId("apple-sign-in").props.pointerEvents).toBe("none");
    expect(screen.getByTestId("apple-sign-in").props.style).toMatchObject({ opacity: 0.5 });
  });
});

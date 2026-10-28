import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { signInOffer } from "@/data/auth/flow";
import { render, viText } from "@/test/render";
import { ProviderButton, ProviderButtons } from "./provider-buttons";

// The auth store behind the offer's query reads NetInfo; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("@/data/auth/flow", () => ({ signInOffer: jest.fn(async () => ({ apple: "native", google: "native" })) }));
// Apple's system button is a native view: a stand-in that shows its height.
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress: () => void; style: { height: number } }) => (
      <Pressable accessibilityRole="button" testID="apple-native-button" onPress={props.onPress}>
        <Text>{`apple ${props.style.height}`}</Text>
      </Pressable>
    ),
  };
});

afterEach(() => jest.restoreAllMocks());

describe("ProviderButton", () => {
  it("keeps Google's mark and words while its sign-in runs, with a spinner at its end, and says it is signing in", async () => {
    const onPress = jest.fn();
    await render(
      <ProviderButton provider="google" label="Tiếp tục với Google" busyLabel="Đang đăng nhập…" busy disabled={false} onPress={onPress} testID="g" />,
    );
    const pill = screen.getByTestId("g");
    expect(pill.props.accessibilityLabel).toBe("Đang đăng nhập…");
    expect(pill.props.accessibilityState).toEqual({ busy: true, disabled: false });
    expect(screen.getByText("Tiếp tục với Google")).toBeTruthy();
    expect(screen.queryByText("Đang đăng nhập…")).toBeNull();
    expect(screen.getByTestId("g-busy", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => fireEvent.press(pill));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("grows to the one provider height with the text, and keeps its label to one line", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ ...Dimensions.get("window"), fontScale: 1.6 });
    await render(<ProviderButton provider="google" label="Tiếp tục với Google" busyLabel="…" busy={false} disabled={false} onPress={jest.fn()} testID="g" />);
    expect(screen.getByTestId("g").props.style).toMatchObject({ minHeight: 77 });
    expect(screen.getByText("Tiếp tục với Google").props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, maxFontSizeMultiplier: 1.6 });
  });
});

describe("ProviderButtons", () => {
  it("keeps Apple's own button while Apple's sign-in runs, as tall as Google's, and dims Google's", async () => {
    jest.mocked(signInOffer).mockResolvedValue({ apple: "native", google: "native" });
    jest.spyOn(Dimensions, "get").mockReturnValue({ ...Dimensions.get("window"), fontScale: 1.235 });
    await render(<ProviderButtons busy="apple" onStart={jest.fn()} />);
    expect(await screen.findByText("apple 59", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("apple-sign-in").props.accessibilityLabel).toBe(viText("auth.social.signingIn"));
    expect(screen.getByTestId("google-sign-in").props.style).toMatchObject({ minHeight: 59 });
    expect(screen.getByTestId("google-sign-in")).toBeDisabled();
  });

  describe("while the keyboard is up", () => {
    const keyboard = (up: boolean) => jest.mocked(useKeyboardState).mockImplementation(() => up as never);
    afterEach(() => keyboard(false));

    it("keeps the place an offer that came back with nothing held, until the keyboard goes", async () => {
      keyboard(true);
      jest.mocked(signInOffer).mockResolvedValue({ apple: null, google: null });
      const { rerender } = await render(<ProviderButtons busy={null} onStart={jest.fn()} />);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      // Someone is typing below: the form does not jump up under them.
      expect(screen.getByTestId("provider-buttons-loading", { includeHiddenElements: true })).toBeTruthy();
      keyboard(false);
      await rerender(<ProviderButtons busy={null} onStart={jest.fn()} />);
      expect(screen.queryByTestId("provider-buttons-loading", { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByTestId("provider-buttons")).toBeNull();
    });

    it("draws the buttons in the place their outline held", async () => {
      keyboard(true);
      jest.mocked(signInOffer).mockResolvedValue({ apple: "browser", google: "native" });
      await render(<ProviderButtons busy={null} onStart={jest.fn()} />);
      expect(await screen.findByTestId("google-sign-in")).toBeTruthy();
      expect(screen.getByTestId("apple-browser-sign-in")).toBeTruthy();
    });
  });
});

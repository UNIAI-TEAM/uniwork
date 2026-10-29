import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { render, viText } from "@/test/render";
import { ChoiceRow, IdentityCard } from "./choice-parts";

afterEach(() => jest.restoreAllMocks());

describe("IdentityCard", () => {
  it("reads as one element naming the provider, the name and the address; the address leads without a name", async () => {
    const { rerender } = await render(<IdentityCard identity={{ provider: "google", email: "an@gmail.com", name: "An", private_relay: false }} />);
    expect(screen.getByTestId("choice-identity").props.accessibilityLabel).toBe(`${viText("auth.continue.identityLabel", { provider: "Google" })}, An, an@gmail.com`);
    await rerender(<IdentityCard identity={{ provider: "apple", email: "q@privaterelay.appleid.com", name: "", private_relay: true }} />);
    expect(screen.getByTestId("choice-identity").props.accessibilityLabel).toBe(
      `${viText("auth.continue.identityLabel", { provider: "Apple" })}, ${viText("auth.apple.relayEmail")}`,
    );
  });
});

describe("ChoiceRow", () => {
  it("is one button with its title and line, a labelled spinner while its step runs, and dims while another runs", async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<ChoiceRow icon="mail-outline" title="Mời" body="Dùng email" onPress={onPress} testID="row" />);
    expect(screen.getByTestId("row").props.accessibilityLabel).toBe("Mời. Dùng email");
    await act(async () => fireEvent.press(screen.getByTestId("row")));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<ChoiceRow icon="mail-outline" title="Mời" body="Dùng email" busy onPress={onPress} testID="row" />);
    expect(screen.getByLabelText("Mời")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("row")));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<ChoiceRow icon="mail-outline" title="Mời" body="Dùng email" disabled onPress={onPress} testID="row" />);
    expect(screen.getByTestId("row")).toBeDisabled();
  });

  it("stacks its icon above its words at the accessibility text sizes, and opens what was chosen under it", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 2.5 });
    await render(
      <ChoiceRow icon="mail-outline" title="Mời" body="Dùng email" busy busyLabel="Đang tạo" onPress={jest.fn()} testID="row">
        <></>
      </ChoiceRow>,
    );
    expect(screen.getByLabelText("Đang tạo")).toBeTruthy();
    expect(screen.getByTestId("row").props.className ?? "").not.toContain("flex-row");
  });
});

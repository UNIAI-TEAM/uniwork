import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { AboutSection } from "./about-section";

const mockInfo = {
  version: "0.3.0",
  build: "42",
  channel: "production",
  updateId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" as string | null,
  runtimeVersion: "fp1",
  appId: "com.uniworkos.chat",
  os: "android",
};
jest.mock("@/data/build-info", () => ({ buildInfo: () => mockInfo }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

afterEach(async () => {
  await act(() => useToastStore.getState().clear());
  Object.assign(mockInfo, { build: "42", channel: "production", updateId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
});

describe("AboutSection", () => {
  it("names the version, the build, the channel and the update it runs", async () => {
    await render(<AboutSection />);
    expect(screen.getByRole("header", { name: viText("mobile.about.title") })).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.version")}: 0.3.0`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.build")}: 42`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.channel")}: production`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.update")}: 0193a1b2`)).toBeOnTheScreen();
  });

  it("says when the embedded bundle runs outside any channel", async () => {
    Object.assign(mockInfo, { build: "", channel: "", updateId: null });
    await render(<AboutSection />);
    expect(screen.getByLabelText(`${viText("mobile.about.build")}: ${viText("mobile.about.none")}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.channel")}: ${viText("mobile.about.none")}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("mobile.about.update")}: ${viText("mobile.about.embedded")}`)).toBeOnTheScreen();
  });

  it("copies the full details for support and confirms in a toast", async () => {
    await render(<AboutSection />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.about.copy") }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("UniChat 0.3.0 (42) · android · production · 0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b · fp1");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("mobile.about.copied")]);
    Object.assign(mockInfo, { build: "", channel: "", updateId: null, runtimeVersion: "" });
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.about.copy") }));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith("UniChat 0.3.0 (-) · android · - · embedded · -");
    mockInfo.runtimeVersion = "fp1";
  });
});

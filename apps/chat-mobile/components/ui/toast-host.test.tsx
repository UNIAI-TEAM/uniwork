import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { toast, useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { ToastHost } from "./toast-host";

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
  jest.restoreAllMocks();
});

describe("ToastHost", () => {
  it("draws nothing without a toast", async () => {
    await render(<ToastHost />);
    expect(screen.toJSON()).toBeNull();
  });

  it("shows each toast as an alert, announces it once, and a tap dismisses it", async () => {
    await render(<ToastHost />);
    await act(() => {
      toast.error("Không gửi được");
      toast.info("Đã chép");
    });
    const error = screen.getByRole("alert", { name: "Không gửi được" });
    expect(error).toBeOnTheScreen();
    expect(error.props.accessibilityHint).toBe(viText("mobile.toast.dismiss"));
    expect(screen.getByTestId("toast-info")).toBeOnTheScreen();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Không gửi được");

    await act(() => {
      toast.success("Đã lưu");
    });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(3);

    await fireEvent.press(error);
    expect(screen.queryByRole("alert", { name: "Không gửi được" })).toBeNull();
    expect(screen.getByTestId("toast-success")).toBeOnTheScreen();
  });

  it("leaves TalkBack to the toast's live region, so it is read once", async () => {
    const os = Platform.OS;
    Platform.OS = "android";
    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    try {
      await render(<ToastHost />);
      await act(() => {
        toast.error("Không gửi được");
      });
      expect(screen.getByRole("alert", { name: "Không gửi được" }).props.accessibilityLiveRegion).toBe("polite");
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    } finally {
      Platform.OS = os;
    }
  });
});

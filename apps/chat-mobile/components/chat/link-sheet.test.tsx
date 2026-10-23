// A message's link sheet (link-sheet.tsx): the address heads it, and it opens,
// copies or shares the link; a link the browser cannot open says so.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { Platform, Share } from "react-native";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { LinkSheet } from "./link-sheet";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const URL = "https://docs.example.com/a";
const os = Platform.OS;

// Android runs a sheet's choice at once; iOS waits for the closed modal's onDismiss (action-sheet.tsx › useAfterDismiss).
beforeAll(() => {
  Platform.OS = "android";
});
afterAll(() => {
  Platform.OS = os;
});

beforeEach(() => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  jest.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({ type: "dismiss" } as never);
  useToastStore.getState().clear();
});

const toasts = () => useToastStore.getState().toasts.map((toast) => [toast.tone, toast.message]);

describe("LinkSheet", () => {
  it("is closed without a link", async () => {
    await render(<LinkSheet url={null} onClose={jest.fn()} />);
    expect(screen.queryByText(viText("mobile.conversation.link_open"))).toBeNull();
  });

  it("names the address and opens it in the in-app browser", async () => {
    const onClose = jest.fn();
    await render(<LinkSheet url={URL} onClose={onClose} />);
    expect(screen.getByText("docs.example.com/a")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.conversation.link_open") }));
    expect(onClose).toHaveBeenCalled();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(URL);
  });

  it("says so when the browser cannot open the link", async () => {
    jest.mocked(WebBrowser.openBrowserAsync).mockRejectedValue(new Error("no browser"));
    await render(<LinkSheet url={URL} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.conversation.link_open") }));
    await waitFor(() => expect(toasts()).toEqual([["error", viText("mobile.conversation.link_open_failed")]]));
  });

  it("copies the link and says it did, or that it could not", async () => {
    await render(<LinkSheet url={URL} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.conversation.link_copy") }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(URL);
    await waitFor(() => expect(toasts()).toEqual([["success", viText("mobile.conversation.link_copied")]]));
    jest.mocked(Clipboard.setStringAsync).mockRejectedValue(new Error("denied"));
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.conversation.link_copy") }));
    await waitFor(() => expect(toasts()).toContainEqual(["error", viText("common.error")]));
  });

  it("shares the link through the system sheet", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "dismissedAction" });
    await render(<LinkSheet url={URL} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.conversation.link_share") }));
    expect(share).toHaveBeenCalledWith({ url: URL, message: URL });
  });
});

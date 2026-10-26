import { fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { i18n } from "@/lib/i18n/singleton";
import { render, viText } from "@/test/render";
import { SignInLegalNote } from "./sign-in-legal-note";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

beforeEach(() => configureRuntime({ appUrl: "https://app.example" }));
afterEach(async () => {
  resetRuntimeConfig();
  await i18n.changeLanguage("vi");
  jest.clearAllMocks();
});

describe("SignInLegalNote", () => {
  // Apple 1.2: signing in is agreeing to terms that forbid objectionable content.
  it("says signing in agrees to the terms, and opens each page in the reader's language", async () => {
    await render(<SignInLegalNote />);
    expect(screen.getByText(`${viText("mobile.legal.agree_prefix")} ${viText("mobile.legal.terms")} ${viText("mobile.legal.agree_and")} ${viText("mobile.legal.privacy")}.`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.legal.terms") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/vi/terms");
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.legal.privacy") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://app.example/vi/privacy");
  });

  it("opens the English pages for an English reader", async () => {
    await i18n.changeLanguage("en");
    await render(<SignInLegalNote />);
    await fireEvent.press(screen.getByTestId("login-terms"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/terms");
  });
});

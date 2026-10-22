import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo } from "react-native";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { useToastStore } from "@/data/stores/toast-store";
import { AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { render, viText } from "@/test/render";
import { LegalSection } from "./legal-section";

jest.mock("@/data/account-api", () => ({ accountApi: { setAiConsent: jest.fn(), withdrawAiConsent: jest.fn() } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create<{ user: unknown; setUser: (user: unknown) => void }>((set) => ({ user: null, setUser: (user) => set({ user }) })) };
});
jest.mock("@/data/build-info", () => ({ buildInfo: () => ({ version: "0.3.0" }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(async () => true) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

const user = { id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {}, locale: "vi" };
const messages = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  useAuthStore.setState({ user });
});
afterEach(async () => {
  resetRuntimeConfig();
  await act(() => useToastStore.getState().clear());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("LegalSection", () => {
  it("opens the privacy policy and the terms of use in the reader's language", async () => {
    await render(<LegalSection />);
    expect(screen.getByRole("header", { name: viText("mobile.legal.title") })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("legal-privacy"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/vi/privacy");
    await fireEvent.press(screen.getByTestId("legal-terms"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://app.example/vi/terms");
  });

  it("writes to support with the version in the subject, and copies the address when there is no mail app", async () => {
    await render(<LegalSection />);
    await fireEvent.press(screen.getByTestId("legal-support"));
    expect(Linking.openURL).toHaveBeenCalledWith(`mailto:contact@unicomhub.com?subject=${encodeURIComponent(viText("mobile.legal.support_subject", { version: "0.3.0" }))}`);
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no handler"));
    await fireEvent.press(screen.getByTestId("legal-support"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("contact@unicomhub.com");
    expect(messages()).toEqual([viText("mobile.legal.support_copied", { email: "contact@unicomhub.com" })]);
  });

  it("opens the licenses screen", async () => {
    await render(<LegalSection />);
    await fireEvent.press(screen.getByTestId("legal-licenses"));
    expect(router.push).toHaveBeenCalledWith("/licenses");
  });

  it("shows the AI answer on file and lets the reader agree from Settings", async () => {
    jest.mocked(accountApi.setAiConsent).mockResolvedValueOnce({ ...user, ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T08:00:00Z" });
    await render(<LegalSection />);
    expect(screen.getByRole("button", { name: `${viText("mobile.legal.ai")}, ${viText("mobile.legal.ai_off")}` })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("legal-ai"));
    expect(screen.getByRole("header", { name: viText("mobile.ai_consent.title") })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    expect(accountApi.setAiConsent).toHaveBeenCalledWith(AI_CONSENT_VERSION);
    expect(screen.getByRole("button", { name: `${viText("mobile.legal.ai")}, ${viText("mobile.legal.ai_on")}` })).toBeOnTheScreen();
  });

  it("says so when a page cannot open: a build without a web origin, or the browser failing", async () => {
    configureRuntime({ appUrl: "" });
    await render(<LegalSection />);
    await fireEvent.press(screen.getByTestId("legal-privacy"));
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(messages()).toEqual([viText("mobile.legal.open_failed")]);

    await act(() => useToastStore.getState().clear());
    configureRuntime({ appUrl: "https://app.example" });
    jest.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(new Error("no browser"));
    await render(<LegalSection />);
    await fireEvent.press(screen.getByTestId("legal-privacy"));
    // The browser's refusal settles after the press.
    await act(async () => {});
    expect(messages()).toEqual([viText("mobile.legal.open_failed")]);
  });
});

import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo } from "react-native";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { useToastStore } from "@/data/stores/toast-store";
import { AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { i18n } from "@/lib/i18n/singleton";
import { render, viText } from "@/test/render";
import { AiConsentActions, AiConsentSheet } from "./ai-consent-notice";

jest.mock("@/data/account-api", () => ({ accountApi: { setAiConsent: jest.fn(), withdrawAiConsent: jest.fn() } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create<{ user: unknown; setUser: (user: unknown) => void }>((set) => ({ user: null, setUser: (user) => set({ user }) })) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const user = { id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {}, locale: "vi" };
const agreed = { ...user, ai_consent_version: AI_CONSENT_VERSION, ai_consent_at: "2026-10-21T08:00:00Z" };

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

describe("AI consent notice", () => {
  it("names the provider and what is sent, and links the privacy policy", async () => {
    await render(<AiConsentSheet visible onClose={jest.fn()} />);
    expect(screen.getByText(viText("mobile.ai_consent.body", { provider: "Anthropic" }))).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.ai_consent.point_on_request"))).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.ai_consent.point_no_training"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.ai_consent.learn_more") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/vi/privacy");
  });

  it("records agreement, and keeps the notice with the reason when the save fails", async () => {
    const onAgreed = jest.fn();
    const onDecline = jest.fn();
    jest.mocked(accountApi.setAiConsent).mockRejectedValueOnce(new Error("offline"));
    await render(<AiConsentActions onDecline={onDecline} onAgreed={onAgreed} />);
    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.ai_consent.failed"));
    expect(onAgreed).not.toHaveBeenCalled();

    jest.mocked(accountApi.setAiConsent).mockResolvedValueOnce(agreed);
    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    expect(onAgreed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.ai_consent.decline") }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("agree without a follow-up closes nothing; a second tap while saving is ignored", async () => {
    let finish: (u: unknown) => void = () => {};
    jest.mocked(accountApi.setAiConsent).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);
    await render(<AiConsentActions onDecline={jest.fn()} />);
    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    await fireEvent.press(screen.getByTestId("ai-consent-agree"));
    expect(accountApi.setAiConsent).toHaveBeenCalledTimes(1);
    await act(async () => finish(agreed));
    expect(useAuthStore.getState().user).toEqual(agreed);
  });

  it("shows when the reader agreed and lets them withdraw", async () => {
    useAuthStore.setState({ user: agreed });
    const onClose = jest.fn();
    jest.mocked(accountApi.withdrawAiConsent).mockRejectedValueOnce(new Error("offline"));
    await render(<AiConsentSheet visible onClose={onClose} />);
    expect(screen.getByText(viText("mobile.ai_consent.agreed_on", { date: new Date(agreed.ai_consent_at).toLocaleDateString("vi-VN") }))).toBeOnTheScreen();
    const withdraw = screen.getByRole("button", { name: viText("mobile.ai_consent.withdraw") });
    await fireEvent.press(withdraw);
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.ai_consent.failed"));
    expect(onClose).not.toHaveBeenCalled();

    jest.mocked(accountApi.withdrawAiConsent).mockResolvedValueOnce({ ...user, ai_consent_version: null, ai_consent_at: null });
    await fireEvent.press(withdraw);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("mobile.ai_consent.withdrawn")]);
  });

  it("leaves the date out when the one on file is unreadable, and ignores a second withdraw tap", async () => {
    useAuthStore.setState({ user: { ...agreed, ai_consent_at: "not a date" } });
    let finish: (u: unknown) => void = () => {};
    jest.mocked(accountApi.withdrawAiConsent).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);
    await render(<AiConsentSheet visible onClose={jest.fn()} />);
    expect(screen.queryByText(/2026/)).toBeNull();
    const withdraw = screen.getByRole("button", { name: viText("mobile.ai_consent.withdraw") });
    await fireEvent.press(withdraw);
    await fireEvent.press(withdraw);
    expect(accountApi.withdrawAiConsent).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...user, ai_consent_version: null }));
  });

  // Apple 5.1.2(i): saying no is an answer too, and the server then keeps what this person writes out of every AI
  // request, whoever makes it; the sheet says so instead of offering it again.
  it("lets the reader say no, and then says what that means", async () => {
    const onClose = jest.fn();
    jest.mocked(accountApi.withdrawAiConsent).mockRejectedValueOnce(new Error("offline"));
    const { rerender } = await render(<AiConsentSheet visible onClose={onClose} />);
    expect(screen.queryByText(viText("mobile.ai_consent.refused_note"))).toBeNull();
    await fireEvent.press(screen.getByTestId("ai-consent-refuse"));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.ai_consent.failed"));
    expect(onClose).not.toHaveBeenCalled();

    const declined = { ...user, ai_consent_version: null, ai_consent_at: null, ai_opt_out_at: "2026-10-22T08:00:00Z" };
    jest.mocked(accountApi.withdrawAiConsent).mockResolvedValueOnce(declined);
    await fireEvent.press(screen.getByTestId("ai-consent-refuse"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("mobile.ai_consent.refused")]);

    await rerender(<AiConsentSheet visible onClose={onClose} />);
    expect(screen.getByText(viText("mobile.ai_consent.refused_note"))).toBeOnTheScreen();
    expect(screen.queryByTestId("ai-consent-refuse")).toBeNull();
    expect(screen.getByTestId("ai-consent-agree")).toBeOnTheScreen();
  });

  it("reads the notice in English with an English date", async () => {
    useAuthStore.setState({ user: agreed });
    await act(() => i18n.changeLanguage("en"));
    try {
      await render(<AiConsentSheet visible onClose={jest.fn()} />);
      expect(screen.getByText(i18n.t("mobile.ai_consent.agreed_on", { date: new Date(agreed.ai_consent_at).toLocaleDateString("en-GB") }))).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("link", { name: i18n.t("mobile.ai_consent.learn_more") }));
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/privacy");
    } finally {
      await act(() => i18n.changeLanguage("vi"));
    }
  });
});

// Settings › Sign-in methods on the phone (sign-in-methods-section.tsx, sign-in-method-row.tsx): the three rows and
// the web's rules, a link that proves it is you before the provider's sheet opens, Apple on Android through the
// web's Settings, an unlink that asks first and says what is left, a move out of an empty account, and a list that
// could not be read said with Retry.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { SignInMethods } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo, Alert, type AlertButton } from "react-native";
import { signInOffer } from "@/data/auth/flow";
import { linkProvider, signInMethodsApi, stepUp } from "@/data/auth/methods-api";
import { forgetStepUp, holdStepUp } from "@/data/auth/step-up-store";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { SignInMethodsSection } from "./sign-in-methods-section";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));
jest.mock("@/data/stores/toast-store", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock("@/data/auth/flow", () => ({ ...jest.requireActual("@/data/auth/flow"), signInOffer: jest.fn(async () => ({ apple: "native", google: "native" })) }));
jest.mock("@/data/auth/methods-api", () => ({
  stepUp: jest.fn(),
  stepUpWithProvider: jest.fn(),
  linkProvider: jest.fn(),
  linkPendingTicket: jest.fn(),
  signInMethodsApi: { getSignInMethods: jest.fn(), sendStepUpEmailCode: jest.fn(), setPassword: jest.fn(), unlink: jest.fn() },
}));
jest.mock("@/data/api", () => ({ api: { getMe: jest.fn(async () => null), request: jest.fn() } }));

const api = jest.mocked(signInMethodsApi);
const refusal = (code: string, status: number, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "ApiError", status, body: { error: { code, fields } } });
const methods = (over: Partial<SignInMethods> = {}): SignInMethods => ({
  password: { set: true, changed_at: "2026-10-12T08:00:00Z" },
  google: { linked: true, email: "an@gmail.com", linked_at: "2026-10-01T08:00:00Z" },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
  ...over,
});
const hold = () =>
  holdStepUp({ step_up_token: "su_1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" }, { userId: "u1", action: "set_password" });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** The confirm's buttons, pressed as the person would. */
let alerts: { title: string; body?: string; buttons: AlertButton[] }[] = [];
const press = async (text: string) => {
  const button = alerts.at(-1)?.buttons.find((b) => b.text === text);
  await act(async () => button?.onPress?.());
  await settle();
};

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  alerts = [];
  jest.spyOn(Alert, "alert").mockImplementation((title, body, buttons) => {
    alerts.push({ title, body, buttons: buttons ?? [] });
  });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An", has_password: true } as never });
  api.getSignInMethods.mockResolvedValue(methods());
});
afterEach(() => {
  forgetStepUp();
  resetRuntimeConfig();
  useAuthStore.setState({ user: null });
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("SignInMethodsSection", () => {
  it("shows the rows' outline, then the password, Google and Apple with their state", async () => {
    let answer: (m: SignInMethods) => void = () => undefined;
    api.getSignInMethods.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<SignInMethodsSection />);
    expect(screen.getByTestId("sign-in-methods-loading")).toBeOnTheScreen();
    await act(async () => answer(methods()));
    expect(screen.getByRole("header", { name: viText("settings.security.signInMethods.title") })).toBeOnTheScreen();
    expect(await screen.findByText(viText("settings.security.signInMethods.password.name"))).toBeOnTheScreen();
    expect(screen.getByText(/an@gmail\.com · /)).toBeOnTheScreen();
    expect(screen.getAllByText(viText("settings.security.signInMethods.badge.linked"))).toHaveLength(1);
    expect(screen.getByText(viText("settings.security.signInMethods.provider.notLinked", { provider: "Apple" }))).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: viText("mobile.sign_in_methods.link_named", { provider: "Apple" }) })).toBeOnTheScreen();
  });

  it("opens the password's own screen", async () => {
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-password"));
    expect(router.push).toHaveBeenCalledWith("/password");
  });

  it("says why the last way in, and Apple of a relay account, stay", async () => {
    api.getSignInMethods.mockResolvedValueOnce(
      methods({
        password: { set: false, changed_at: null },
        google: { linked: false, email: null, linked_at: null },
        apple: { linked: true, email: "x@privaterelay.appleid.com", linked_at: null, private_relay: true },
        account_email_is_relay: true,
      }),
    );
    await render(<SignInMethodsSection />);
    expect(await screen.findByText(viText("settings.security.signInMethods.reasons.relay"))).toBeOnTheScreen();
    expect(screen.getByText(`${viText("auth.apple.relayEmail")} · ${viText("settings.security.signInMethods.provider.linked")}`)).toBeOnTheScreen();
    expect(screen.getByText(viText("settings.security.signInMethods.password.unset"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("sign-in-method-action-apple"));
    expect(alerts).toHaveLength(0);
  });

  it("proves it is you before Google's sheet opens, then links and says so", async () => {
    api.getSignInMethods.mockResolvedValue(methods({ google: { linked: false, email: null, linked_at: null } }));
    jest.mocked(stepUp).mockImplementation(async (_proof, action, userId) => {
      holdStepUp({ step_up_token: "su_1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" }, { userId, action });
      return true;
    });
    jest.mocked(linkProvider).mockResolvedValueOnce({ user: null, methods: methods() });
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-google"));
    await settle();
    expect(linkProvider).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("step-up-password"), "pw");
    await fireEvent.press(screen.getByTestId("step-up-submit"));
    await settle();
    expect(linkProvider).toHaveBeenCalledWith({ provider: "google", stepUpToken: "su_1", move: false });
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.results.linked", { provider: "Google" }));
  });

  it("says nothing when the provider's sheet was closed, and the server's refusal when it took none", async () => {
    api.getSignInMethods.mockResolvedValue(methods({ google: { linked: false, email: null, linked_at: null } }));
    hold();
    jest.mocked(linkProvider).mockResolvedValueOnce(null).mockRejectedValueOnce(refusal("sign_in_method_taken", 409, { masked_email: "b•••@acme.vn" }));
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-google"));
    await settle();
    expect(toast.success).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("sign-in-method-action-google"));
    await settle();
    expect(toast.error).toHaveBeenCalledWith(viText("settings.security.signInMethods.errors.taken", { masked: "b•••@acme.vn" }));
  });

  it("moves the identity out of an empty account after a confirm that says whose", async () => {
    api.getSignInMethods.mockResolvedValue(methods({ google: { linked: false, email: null, linked_at: null } }));
    hold();
    jest
      .mocked(linkProvider)
      .mockRejectedValueOnce(refusal("sign_in_method_movable", 409, { masked_email: "a•••@gmail.com" }))
      .mockResolvedValueOnce({ user: null, methods: methods() });
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-google"));
    await settle();
    expect(alerts.at(-1)?.body).toBe(viText("settings.security.signInMethods.move.body", { provider: "Google", masked: "a•••@gmail.com" }));
    await press(viText("settings.security.signInMethods.move.confirm"));
    expect(linkProvider).toHaveBeenLastCalledWith({ provider: "google", stepUpToken: "su_1", move: true });
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.move.toast", { provider: "Google" }));
  });

  it("links Apple on Android in the web's Settings, told whose account this is", async () => {
    jest.mocked(signInOffer).mockResolvedValueOnce({ apple: "browser", google: "native" });
    await render(<SignInMethodsSection />);
    const action = await screen.findByRole("link", { name: viText("settings.security.signInMethods.provider.linkOnWeb") });
    await fireEvent.press(action);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/settings?tab=security&expect_user=u1");
  });

  it("hides a provider neither linked nor offered on this phone", async () => {
    jest.mocked(signInOffer).mockResolvedValueOnce({ apple: null, google: "native" });
    await render(<SignInMethodsSection />);
    await screen.findByTestId("sign-in-method-google");
    expect(screen.queryByTestId("sign-in-method-apple")).toBeNull();
  });

  it("asks before unlinking, says what is left and that other devices sign out, then confirms and unlinks", async () => {
    hold();
    api.unlink.mockResolvedValueOnce({ user: null, methods: methods({ google: { linked: false, email: null, linked_at: null } }) });
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-google"));
    expect(alerts.at(-1)?.title).toBe(viText("settings.security.signInMethods.unlink.title", { provider: "Google" }));
    expect(alerts.at(-1)?.body).toContain(viText("settings.security.signInMethods.unlink.remainingOne", { method: viText("settings.security.signInMethods.method.password") }));
    expect(alerts.at(-1)?.body).toContain(viText("settings.security.signInMethods.unlink.signsOutOthers"));
    await press(viText("settings.security.signInMethods.unlink.confirm"));
    expect(api.unlink).toHaveBeenCalledWith("google", "su_1");
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.unlink.toast", { provider: "Google" }));
    expect(await screen.findByText(viText("settings.security.signInMethods.provider.notLinked", { provider: "Google" }))).toBeOnTheScreen();
  });

  it("names both ways left, and says a refused unlink", async () => {
    hold();
    api.getSignInMethods.mockResolvedValue(methods({ apple: { linked: true, email: "a@icloud.com", linked_at: null, private_relay: false } }));
    api.unlink.mockRejectedValueOnce(refusal("sign_in_method_last", 409));
    await render(<SignInMethodsSection />);
    await fireEvent.press(await screen.findByTestId("sign-in-method-action-google"));
    const method = (kind: string) => viText(`settings.security.signInMethods.method.${kind}`);
    expect(alerts.at(-1)?.body).toContain(viText("settings.security.signInMethods.unlink.remainingTwo", { first: method("password"), second: method("apple") }));
    await press(viText("settings.security.signInMethods.unlink.confirm"));
    expect(toast.error).toHaveBeenCalledWith(viText("settings.security.signInMethods.reasons.last"));
  });

  it("says methods it could not read, with Retry, never a guess", async () => {
    api.getSignInMethods.mockResolvedValueOnce(null).mockResolvedValueOnce(methods());
    await render(<SignInMethodsSection />);
    expect(await screen.findByText(viText("settings.security.signInMethods.loadError"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.signInMethods.retry") }));
    expect(await screen.findByTestId("sign-in-method-google")).toBeOnTheScreen();
  });
});

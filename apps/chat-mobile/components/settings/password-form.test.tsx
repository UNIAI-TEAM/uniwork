// Setting or changing the password on the phone (password-form.tsx): a first password confirms it is you first and
// names the address it signs in with; a change takes the current password (or the second factor, through the proof
// sheet) and says other devices sign out; each refusal is said under its own field.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { SignInMethods } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as Clipboard from "expo-clipboard";
import { router, useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, BackHandler } from "react-native";
import { api } from "@/data/api";
import { signInMethodsApi, stepUp } from "@/data/auth/methods-api";
import { forgetStepUp, holdStepUp } from "@/data/auth/step-up-store";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { PasswordForm } from "./password-form";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("@/data/stores/toast-store", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock("@/data/auth/flow", () => ({ ...jest.requireActual("@/data/auth/flow"), signInOffer: jest.fn(async () => ({ apple: null, google: null })) }));
jest.mock("@/data/auth/methods-api", () => ({
  stepUp: jest.fn(),
  stepUpWithProvider: jest.fn(),
  linkProvider: jest.fn(),
  linkPendingTicket: jest.fn(),
  signInMethodsApi: { getSignInMethods: jest.fn(), sendStepUpEmailCode: jest.fn(), setPassword: jest.fn(), unlink: jest.fn() },
}));
jest.mock("@/data/api", () => ({ api: { getMe: jest.fn(async () => null), request: jest.fn() } }));

const methodsApi = jest.mocked(signInMethodsApi);
const refusal = (code: string, status: number, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "ApiError", status, body: { error: { code, fields } } });
const methods = (over: Partial<SignInMethods> = {}): SignInMethods => ({
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
  ...over,
});
const user = { id: "u1", email: "an@acme.vn", display_name: "An", has_password: true };
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const type = async (testID: string, value: string) => fireEvent.changeText(screen.getByTestId(testID), value);
const save = async () => {
  await fireEvent.press(screen.getByTestId("password-save"));
  await settle();
};

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  useAuthStore.setState({ user: user as never });
  methodsApi.getSignInMethods.mockResolvedValue(methods());
  methodsApi.setPassword.mockResolvedValue({ user: null, methods: methods() });
  jest.mocked(stepUp).mockImplementation(async (_proof, action, userId) => {
    holdStepUp({ step_up_token: "su_1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "email_code" }, { userId, action });
    return true;
  });
});
afterEach(() => {
  forgetStepUp();
  resetRuntimeConfig();
  useAuthStore.setState({ user: null });
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("PasswordForm", () => {
  const fillChange = async () => {
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
  };
  const answerLater = () => {
    let answer: () => void = () => undefined;
    methodsApi.setPassword.mockImplementationOnce(
      () => new Promise((resolve) => (answer = () => resolve({ user: null, methods: methods() }))),
    );
    return () => act(async () => answer());
  };

  it("holds back while the save runs, then goes back once", async () => {
    const answer = answerLater();
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fillChange();
    await fireEvent.press(screen.getByTestId("password-save"));
    expect(useNavigation().setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    const back = screen.getByRole("button", { name: viText("common.back") });
    expect(back).toBeDisabled();
    await fireEvent.press(back);
    expect(router.back).not.toHaveBeenCalled();
    await answer();
    await settle();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(useNavigation().setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it("goes back to the start screen when it was opened on its own", async () => {
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fireEvent.press(screen.getByRole("button", { name: viText("common.back") }));
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
  });

  it("moves no one when the screen is gone by the time the save ends", async () => {
    const answer = answerLater();
    const { unmount } = await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fillChange();
    await fireEvent.press(screen.getByTestId("password-save"));
    await unmount();
    await answer();
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.toastChanged"));
    expect(router.back).not.toHaveBeenCalled();
  });

  it("takes Android's back while the save runs, and does nothing with it", async () => {
    const answer = answerLater();
    const listen = jest.spyOn(BackHandler, "addEventListener");
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fillChange();
    await fireEvent.press(screen.getByTestId("password-save"));
    const hardwareBack = listen.mock.calls.at(-1)?.[1] as unknown as () => boolean;
    expect(hardwareBack()).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    await answer();
    await settle();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal for when the screen is in front again, without the error's feel elsewhere", async () => {
    let refuse: () => void = () => undefined;
    methodsApi.setPassword.mockImplementationOnce(() => new Promise((_, reject) => (refuse = () => reject(refusal("password_incorrect", 403)))));
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fillChange();
    await fireEvent.press(screen.getByTestId("password-save"));
    jest.mocked(useNavigation().isFocused).mockReturnValueOnce(false);
    await act(async () => refuse());
    await settle();
    expect(screen.getByText(viText("settings.security.signInMethods.password.currentIncorrect"))).toBeOnTheScreen();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it("says a save that ends once another screen is in front, and moves no one", async () => {
    const answer = answerLater();
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await fillChange();
    await fireEvent.press(screen.getByTestId("password-save"));
    // A notification opened a conversation meanwhile.
    jest.mocked(useNavigation().isFocused).mockReturnValueOnce(false);
    await answer();
    await settle();
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.toastChanged"));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("changes the password with the current one, says other devices sign out, then goes back", async () => {
    await render(<PasswordForm />);
    expect(await screen.findByRole("header", { name: viText("settings.security.signInMethods.password.changeTitle") })).toBeOnTheScreen();
    expect(screen.getByTestId("password-signs-out")).toHaveTextContent(viText("settings.security.signInMethods.password.signsOutOthers"));
    // The account's address as a read-only username, so the system knows which saved password the new one replaces.
    expect(screen.getByTestId("password-username").props).toMatchObject({ value: "an@acme.vn", readOnly: true, textContentType: "username" });
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(methodsApi.setPassword).toHaveBeenCalledWith({ new_password: "new-pass-1", current_password: "old-pass" });
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.toastChanged"));
    expect(router.back).toHaveBeenCalled();
  });

  it("checks the fields before the server: current required, the new one long enough and typed twice", async () => {
    await render(<PasswordForm />);
    await screen.findByTestId("password-current");
    await save();
    expect(screen.getByText(viText("settings.security.signInMethods.password.currentRequired"))).toBeOnTheScreen();
    await type("password-current", "old-pass");
    await type("password-new", "short");
    await save();
    expect(screen.getByText(viText("settings.security.signInMethods.password.tooShort"))).toBeOnTheScreen();
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-2");
    await save();
    expect(screen.getByText(viText("settings.security.signInMethods.password.mismatch"))).toBeOnTheScreen();
    expect(methodsApi.setPassword).not.toHaveBeenCalled();
  });

  it("says a wrong current password under its field and clears it", async () => {
    methodsApi.setPassword.mockRejectedValueOnce(refusal("password_incorrect", 403));
    await render(<PasswordForm />);
    await type("password-current", "nope");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(screen.getByText(viText("settings.security.signInMethods.password.currentIncorrect"))).toBeOnTheScreen();
    expect(screen.getByTestId("password-current").props.value).toBe("");
    // Typing again clears the refusal.
    await type("password-current", "n");
    expect(screen.queryByText(viText("settings.security.signInMethods.password.currentIncorrect"))).toBeNull();
  });

  it("asks for the proof the server now wants, then changes it with the token", async () => {
    methodsApi.setPassword.mockRejectedValueOnce(refusal("proof_required", 403, { proofs: ["email_code"] }));
    methodsApi.sendStepUpEmailCode.mockResolvedValue(true);
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    await type("step-up-email-code", "123456");
    await settle();
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-pass-1", step_up_token: "su_1" });
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.toastChanged"));
  });

  it("takes no current password from an account that confirms with its second factor", async () => {
    methodsApi.getSignInMethods.mockResolvedValue(methods({ proofs: ["totp"] }));
    await render(<PasswordForm />);
    await screen.findByTestId("password-new");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByTestId("password-current")).toBeNull();
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(screen.getByTestId("step-up-totp")).toBeOnTheScreen();
    expect(methodsApi.setPassword).not.toHaveBeenCalled();
  });

  it("sets a first password behind a proof, naming the address it signs in with", async () => {
    useAuthStore.setState({ user: { ...user, has_password: false } as never });
    methodsApi.getSignInMethods.mockResolvedValue(methods({ password: { set: false, changed_at: null }, proofs: ["email_code"] }));
    methodsApi.sendStepUpEmailCode.mockResolvedValue(true);
    await render(<PasswordForm />);
    expect(await screen.findByText(viText("settings.security.signInMethods.password.setDescription", { email: "an@acme.vn" }))).toBeOnTheScreen();
    expect(screen.queryByTestId("password-signs-out")).toBeNull();
    await type("password-new", "first-pass");
    await type("password-again", "first-pass");
    await save();
    await fireEvent.press(screen.getByTestId("step-up-send-code"));
    await settle();
    expect(methodsApi.sendStepUpEmailCode).toHaveBeenCalledWith("set_password");
    await type("step-up-email-code", "123456");
    await settle();
    expect(methodsApi.setPassword).toHaveBeenCalledWith({ new_password: "first-pass", step_up_token: "su_1" });
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.toastSet"));
  });

  // Known by its domain (either of Sign in with Apple's) before the server says so, and by the server's word for a
  // domain this build does not know yet.
  it.each([
    ["x@privaterelay.appleid.com", false],
    ["x@private.icloud.com", false],
    ["x@relay.example.com", true],
  ])("offers to copy Apple's relay address %s, which nobody types", async (relay, flagged) => {
    useAuthStore.setState({ user: { ...user, email: relay, has_password: false } as never });
    methodsApi.getSignInMethods.mockResolvedValue(
      methods({ password: { set: false, changed_at: null }, account_email_is_relay: flagged, proofs: ["apple", "email_code"] }),
    );
    await render(<PasswordForm />);
    expect(await screen.findByText(viText("settings.security.signInMethods.password.setDescriptionRelay"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("password-copy-email"));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(relay);
    expect(toast.success).toHaveBeenCalledWith(viText("settings.security.signInMethods.password.emailCopied"));
  });

  it("keeps the user the answer brings, and reads it again from /me when the answer had none", async () => {
    const changed = { ...user, has_password: true, display_name: "An mới" };
    methodsApi.setPassword.mockResolvedValueOnce({ user: changed as never, methods: null });
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(useAuthStore.getState().user).toMatchObject({ display_name: "An mới" });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it("says a refusal about no one field above the button", async () => {
    methodsApi.setPassword.mockRejectedValueOnce(refusal("unexpected", 409));
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(screen.getByTestId("password-error")).toBeOnTheScreen();
    expect(screen.getByText(viText("settings.security.signInMethods.errors.generic"))).toBeOnTheScreen();
  });

  it("moves field to field on each key, and saves from the last one", async () => {
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await fireEvent(screen.getByTestId("password-current"), "submitEditing");
    await type("password-new", "new-pass-1");
    await fireEvent(screen.getByTestId("password-new"), "submitEditing");
    await type("password-again", "new-pass-1");
    await fireEvent(screen.getByTestId("password-again"), "submitEditing");
    await settle();
    expect(methodsApi.setPassword).toHaveBeenCalledWith({ new_password: "new-pass-1", current_password: "old-pass" });
  });

  it("sends the token held from a proof a moment ago instead of the current password", async () => {
    holdStepUp({ step_up_token: "su_9", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" }, { userId: "u1", action: "unlink_google" });
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(methodsApi.setPassword).toHaveBeenCalledWith({ new_password: "new-pass-1", step_up_token: "su_9" });
  });

  it("says a new password the server would not take under its field", async () => {
    methodsApi.setPassword.mockRejectedValueOnce(refusal("invalid_request", 400));
    await render(<PasswordForm />);
    await type("password-current", "old-pass");
    await type("password-new", "new-pass-1");
    await type("password-again", "new-pass-1");
    await save();
    expect(screen.getByText(viText("settings.security.signInMethods.password.tooShort"))).toBeOnTheScreen();
  });
});

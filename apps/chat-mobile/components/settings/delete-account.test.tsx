import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo, Platform } from "react-native";
import { i18n } from "@/lib/i18n/singleton";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { DeleteAccountSection } from "./delete-account";

jest.mock("@/data/account-api", () => ({ accountApi: { deleteAccount: jest.fn() } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown, accountDeleted: jest.fn(async () => {}) })) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const deleteAccount = jest.mocked(accountApi.deleteAccount);
const refusal = (code: string, status: number) => Object.assign(new Error(code), { status, body: { error: { code } } });
const signedIn = (user: Record<string, unknown>) =>
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An", ...user } as never, accountDeleted: jest.fn(async () => {}) });

async function open() {
  await render(<DeleteAccountSection orgSlug="acme" wsSlug="hq" />);
  await fireEvent.press(screen.getByTestId("settings-delete-account"));
}
const proofInput = (mode: "password" | "code" | "email") => screen.getByLabelText(viText(`settings.security.delete.proof.${mode}`));
const confirm = () => fireEvent.press(screen.getByTestId("delete-account-confirm"));

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  signedIn({ has_password: true });
});
afterEach(async () => {
  resetRuntimeConfig();
  await act(() => useToastStore.getState().clear());
  jest.restoreAllMocks();
  deleteAccount.mockReset();
});

describe("DeleteAccountSection", () => {
  it("says what erasure does before it asks for anything", async () => {
    await open();
    expect(screen.getByRole("header", { name: viText("settings.security.delete.title") })).toBeOnTheScreen();
    for (const key of ["consequence_identity", "consequence_content", "consequence_devices", "consequence_final"]) {
      expect(screen.getByText(viText(`mobile.account.${key}`))).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.policy_link") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/vi/privacy#delete-account");
  });

  it("asks for the password, refuses an empty one, then erases and signs out", async () => {
    await open();
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.required.password"));
    expect(deleteAccount).not.toHaveBeenCalled();

    deleteAccount.mockResolvedValueOnce(undefined);
    await fireEvent.changeText(proofInput("password"), "s3cret pw");
    await confirm();
    expect(deleteAccount).toHaveBeenCalledWith({ password: "s3cret pw" });
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("mobile.account.deleted")]);
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
  });

  it("clears a refused password and says so under the field", async () => {
    deleteAccount.mockRejectedValueOnce(refusal("password_incorrect", 403));
    await open();
    await fireEvent.changeText(proofInput("password"), "wrong");
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.incorrect.password"));
    expect(proofInput("password").props.value).toBe("");
    expect(proofInput("password").props.secureTextEntry).toBe(true);
    expect(useAuthStore.getState().accountDeleted).not.toHaveBeenCalled();
    // Typing again clears the refusal.
    await fireEvent.changeText(proofInput("password"), "w");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks a two-factor account for its code, trimmed", async () => {
    signedIn({ has_password: false, mfa_enabled_at: "2026-10-01T00:00:00Z" });
    deleteAccount.mockResolvedValueOnce(undefined);
    await open();
    expect(proofInput("code").props.keyboardType).toBe("number-pad");
    await fireEvent.changeText(proofInput("code"), " 123456 ");
    await fireEvent(proofInput("code"), "submitEditing");
    expect(deleteAccount).toHaveBeenCalledWith({ code: "123456" });
  });

  it("asks a Google-only account to type its address and keeps a mistyped one to correct", async () => {
    signedIn({ has_password: false, mfa_enabled_at: null });
    deleteAccount.mockRejectedValueOnce(refusal("email_confirmation_mismatch", 400));
    await open();
    expect(proofInput("email").props.placeholder).toBe("an@acme.vn");
    await fireEvent.changeText(proofInput("email"), "an@acme.com");
    await confirm();
    expect(deleteAccount).toHaveBeenCalledWith({ email_confirmation: "an@acme.com" });
    expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.incorrect.email"));
    expect(proofInput("email").props.value).toBe("an@acme.com");
  });

  it("tells an owner to hand the organization over on the web first", async () => {
    deleteAccount.mockRejectedValueOnce(refusal("owner_must_transfer", 409));
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    expect(screen.getByText(viText("mobile.account.owner_title"))).toBeOnTheScreen();
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.owner_open_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/acme/hq/settings");
  });

  it.each([
    [refusal("rate_limited", 429), "mobile.account.rate_limited"],
    [Object.assign(new Error("offline"), { status: 0 }), "mobile.account.offline"],
    [refusal("internal", 500), "settings.security.delete.failed"],
  ])("says what went wrong when the server does not erase (%s)", async (err, key) => {
    deleteAccount.mockRejectedValueOnce(err);
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText(key));
    // Anything but a refused proof keeps what was typed.
    expect(proofInput("password").props.value).toBe("pw");
  });

  it("cancel closes the sheet and forgets what was typed", async () => {
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
    expect(screen.queryByTestId("delete-account-proof")).toBeNull();
    await fireEvent.press(screen.getByTestId("settings-delete-account"));
    expect(proofInput("password").props.value).toBe("");
  });

  it("ignores a second tap while the request is out", async () => {
    let finish: () => void = () => {};
    deleteAccount.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    await confirm();
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByText(viText("mobile.account.deleting"))).toBeOnTheScreen();
    await act(async () => finish());
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
  });

  it("signs out even when wiping the phone fails, on Android, in English, with no address on file", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    useAuthStore.setState({ user: null, accountDeleted: jest.fn(async () => Promise.reject(new Error("keychain"))) });
    deleteAccount.mockResolvedValueOnce(undefined);
    await act(() => i18n.changeLanguage("en"));
    try {
      await open();
      expect(screen.getByLabelText(i18n.t("settings.security.delete.proof.email")).props.placeholder).toBe("");
      await fireEvent.press(screen.getByRole("link", { name: i18n.t("mobile.account.policy_link") }));
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/privacy#delete-account");
      await fireEvent.changeText(screen.getByLabelText(i18n.t("settings.security.delete.proof.email")), "an@acme.vn");
      await confirm();
      expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([i18n.t("mobile.account.deleted")]);
    } finally {
      await act(() => i18n.changeLanguage("vi"));
    }
  });
});

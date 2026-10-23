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

jest.mock("@/data/account-api", () => ({ accountApi: { deleteAccount: jest.fn(), transferOwnership: jest.fn() } }));
const mockRequest = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>();
jest.mock("@/data/api", () => ({ api: { request: (path: string, init?: RequestInit) => mockRequest(path, init) } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown, accountDeleted: jest.fn(async () => {}) })) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const deleteAccount = jest.mocked(accountApi.deleteAccount);
const transferOwnership = jest.mocked(accountApi.transferOwnership);
const refusal = (code: string, status: number) => Object.assign(new Error(code), { status, body: { error: { code } } });
const signedIn = (user: Record<string, unknown>) =>
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An", ...user } as never, accountDeleted: jest.fn(async () => {}) });

async function open(workspace: { orgSlug: string; wsSlug: string } | null = { orgSlug: "acme", wsSlug: "hq" }) {
  await render(<DeleteAccountSection workspace={workspace ?? undefined} />);
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
  transferOwnership.mockReset();
  mockRequest.mockReset();
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

  // select-workspace › Settings: no workspace to name, so the web app decides where its owner lands.
  it("sends an owner with no workspace to the web app itself", async () => {
    deleteAccount.mockRejectedValueOnce(refusal("owner_must_transfer", 409));
    await open(null);
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.owner_open_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/");
  });

  // Audit "owner-deletion-dead-end" (Apple 5.1.1(v)): the only member of an organization finishes in the app.
  describe("an owner who is the organization's only member", () => {
    const soleOwner = (canClose = true) =>
      Object.assign(new Error("owner_must_transfer"), {
        status: 409,
        body: { error: { code: "owner_must_transfer", fields: { organization_name: "Một mình", organization_slug: "mot-minh", can_close: canClose } } },
      });
    const slugInput = () => screen.getByTestId("delete-account-close-slug");

    async function reachClose() {
      deleteAccount.mockRejectedValueOnce(soleOwner());
      await open();
      await fireEvent.changeText(proofInput("password"), "pw");
      await confirm();
    }

    it("closes the organization with the erasure once its address is typed again", async () => {
      await reachClose();
      expect(screen.getByRole("header", { name: viText("mobile.account.close_title") })).toBeOnTheScreen();
      expect(screen.getByText(viText("mobile.account.close_body", { name: "Một mình" }))).toBeOnTheScreen();
      expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("mobile.account.close_confirm"));

      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.close_required"));
      await fireEvent.changeText(slugInput(), "mot minh");
      expect(screen.queryByRole("alert")).toBeNull();
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.close_mismatch"));
      expect(deleteAccount).toHaveBeenCalledTimes(1);

      deleteAccount.mockResolvedValueOnce(undefined);
      await fireEvent.changeText(slugInput(), " Mot-Minh ");
      // The keyboard's Done sends it as the button does.
      await fireEvent(slugInput(), "submitEditing");
      expect(deleteAccount).toHaveBeenLastCalledWith({ password: "pw", close_organization: "mot-minh" });
      expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
    });

    it("says so when the server refuses the address", async () => {
      await reachClose();
      deleteAccount.mockRejectedValueOnce(refusal("close_confirm_mismatch", 400));
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.close_mismatch"));
    });

    it("turns to handing over when someone joined meanwhile", async () => {
      mockRequest.mockResolvedValue({ members: [{ user_id: "u-new", display_name: "Mới", email: "moi@acme.vn", role: "member" }] });
      await reachClose();
      deleteAccount.mockRejectedValueOnce(refusal("organization_has_members", 409));
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByText(viText("mobile.account.close_has_members"))).toBeOnTheScreen();
      expect(screen.getByText(viText("mobile.account.transfer_body", { name: "Một mình" }))).toBeOnTheScreen();
      expect(await screen.findByTestId("hand-over-u-new")).toBeOnTheScreen();
      expect(screen.queryByTestId("delete-account-close-slug")).toBeNull();
    });

    it("sends a two-factor owner to the web when someone joined meanwhile", async () => {
      signedIn({ has_password: false, mfa_enabled_at: "2026-10-01T00:00:00Z" });
      deleteAccount.mockRejectedValueOnce(soleOwner());
      await open();
      await fireEvent.changeText(proofInput("code"), "123456");
      await confirm();
      deleteAccount.mockRejectedValueOnce(refusal("organization_has_members", 409));
      await fireEvent.changeText(proofInput("code"), "654321");
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByText(viText("mobile.account.close_has_members"))).toBeOnTheScreen();
      expect(screen.getByText(viText("mobile.account.owner_body_named", { name: "Một mình" }))).toBeOnTheScreen();
      expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("sends a two-factor owner with members to the web, which asks for a password first", async () => {
      signedIn({ has_password: false, mfa_enabled_at: "2026-10-01T00:00:00Z" });
      deleteAccount.mockRejectedValueOnce(soleOwner(false));
      await open();
      await fireEvent.changeText(proofInput("code"), "123456");
      await confirm();
      expect(screen.getByText(viText("mobile.account.owner_body_named", { name: "Một mình" }))).toBeOnTheScreen();
      expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    // Review finding: the first request already used the code (a recovery code is burned there, a TOTP code
    // expires while the address is typed), so the second asks for a fresh one beside the address.
    it("asks a two-factor account for a fresh code beside the address, and again after a refused one", async () => {
      signedIn({ has_password: false, mfa_enabled_at: "2026-10-01T00:00:00Z" });
      deleteAccount.mockRejectedValueOnce(soleOwner());
      await open();
      await fireEvent.changeText(proofInput("code"), "abcd-efgh");
      await confirm();
      expect(screen.getByRole("header", { name: viText("mobile.account.close_title") })).toBeOnTheScreen();
      expect(proofInput("code").props.value).toBe("");
      expect(screen.getByText(viText("mobile.account.close_code_again"))).toBeOnTheScreen();

      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.required.code"));
      expect(deleteAccount).toHaveBeenCalledTimes(1);

      deleteAccount.mockRejectedValueOnce(refusal("mfa_code_incorrect", 403));
      await fireEvent.changeText(proofInput("code"), "111111");
      await confirm();
      expect(deleteAccount).toHaveBeenLastCalledWith({ code: "111111", close_organization: "mot-minh" });
      expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.incorrect.code"));
      expect(proofInput("code").props.value).toBe("");
      // The address stays typed; only the code is asked again.
      expect(slugInput().props.value).toBe("mot-minh");

      deleteAccount.mockResolvedValueOnce(undefined);
      await fireEvent.changeText(proofInput("code"), "222222");
      expect(screen.queryByRole("alert")).toBeNull();
      await fireEvent(proofInput("code"), "submitEditing");
      expect(deleteAccount).toHaveBeenLastCalledWith({ code: "222222", close_organization: "mot-minh" });
      expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
    });

    it("says a failure that is about neither field under the address", async () => {
      await reachClose();
      deleteAccount.mockRejectedValueOnce(refusal("rate_limited", 429));
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.rate_limited"));
      expect(screen.queryByTestId("delete-account-proof")).toBeNull();
      expect(slugInput().props.value).toBe("mot-minh");
    });

    it("puts the password back on screen when it is refused while closing", async () => {
      await reachClose();
      expect(screen.queryByTestId("delete-account-proof")).toBeNull();
      deleteAccount.mockRejectedValueOnce(refusal("password_incorrect", 403));
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.incorrect.password"));
      expect(proofInput("password").props.value).toBe("");
      deleteAccount.mockResolvedValueOnce(undefined);
      await fireEvent.changeText(proofInput("password"), "new pw");
      await confirm();
      expect(deleteAccount).toHaveBeenLastCalledWith({ password: "new pw", close_organization: "mot-minh" });
    });

    it("forgets the organization when the sheet is cancelled", async () => {
      await reachClose();
      await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
      await fireEvent.press(screen.getByTestId("settings-delete-account"));
      expect(screen.queryByTestId("delete-account-close-slug")).toBeNull();
      expect(proofInput("password").props.value).toBe("");
    });
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

// Review finding (Apple 5.1.1(v)): an owner whose organization has other members picks who takes over in the sheet,
// which hands it over with the password already typed and then erases the account.
describe("an owner whose organization has other members", () => {
  const withMembers = () =>
    Object.assign(new Error("owner_must_transfer"), {
      status: 409,
      body: { error: { code: "owner_must_transfer", fields: { organization_name: "Acme", organization_slug: "acme", can_close: false } } },
    });
  const MEMBERS = {
    members: [
      { user_id: "u1", display_name: "An", email: "an@acme.vn", role: "owner" },
      { user_id: "u-binh", display_name: "Bình", email: "binh@acme.vn", role: "member" },
      { user_id: "u-chi", display_name: "Chi", email: "chi@acme.vn", role: "admin" },
      // No display name: the address names them, once.
      { user_id: "u-dung", display_name: "", email: "dung@acme.vn", role: "member" },
    ],
  };

  async function reachHandOver() {
    mockRequest.mockResolvedValue(MEMBERS);
    deleteAccount.mockRejectedValueOnce(withMembers());
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    await screen.findByTestId("hand-over-u-chi");
  }

  it("lists who may take over, admins first, hands over to the one chosen, then erases", async () => {
    await reachHandOver();
    expect(mockRequest).toHaveBeenCalledWith("/api/v1/orgs/acme/members?status=active&limit=100", expect.anything());
    expect(screen.queryByTestId("hand-over-u1")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.props.testID)).toEqual(["hand-over-u-chi", "hand-over-u-binh", "hand-over-u-dung"]);
    expect(screen.getAllByText("dung@acme.vn")).toHaveLength(1);
    expect(screen.getByLabelText(`Chi, ${viText("mobile.account.transfer_admin")}`)).toBeOnTheScreen();
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("mobile.account.transfer_confirm_pick"));
    expect(screen.queryByTestId("delete-account-proof")).toBeNull();

    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.transfer_choose"));
    expect(transferOwnership).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("hand-over-u-chi").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("mobile.account.transfer_confirm", { name: "Chi" }));
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockResolvedValueOnce(undefined);
    await confirm();
    expect(transferOwnership).toHaveBeenCalledWith("acme", "u-chi", "pw");
    expect(deleteAccount).toHaveBeenLastCalledWith({ password: "pw" });
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
  });

  it("says it is handing over while the request is out, and ignores a tap on the list meanwhile", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-binh"));
    let finish: () => void = () => {};
    transferOwnership.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    deleteAccount.mockResolvedValueOnce(undefined);
    await confirm();
    expect(screen.getByText(viText("mobile.account.transferring"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    expect(screen.getByTestId("hand-over-u-binh").props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => finish());
    expect(deleteAccount).toHaveBeenLastCalledWith({ password: "pw" });
  });

  it("puts the password back on screen when the hand-over refuses it", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockRejectedValueOnce(refusal("password_incorrect", 403));
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.incorrect.password"));
    expect(proofInput("password").props.value).toBe("");
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockResolvedValueOnce(undefined);
    await fireEvent.changeText(proofInput("password"), "pw2");
    await confirm();
    expect(transferOwnership).toHaveBeenLastCalledWith("acme", "u-chi", "pw2");
    expect(deleteAccount).toHaveBeenLastCalledWith({ password: "pw2" });
  });

  it("reads the list again when the one chosen is gone", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-binh"));
    transferOwnership.mockRejectedValueOnce(refusal("member_deactivated", 403));
    mockRequest.mockClear();
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.transfer_member_gone"));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hand-over-u-binh").props.accessibilityState).toMatchObject({ checked: false });
  });

  it.each([
    [refusal("password_required", 403), "mobile.account.transfer_password_needed"],
    [refusal("rate_limited", 429), "mobile.account.rate_limited"],
    [Object.assign(new Error("offline"), { status: 0 }), "mobile.account.offline"],
    [refusal("forbidden", 403), "settings.security.delete.failed"],
  ])("says why the hand-over failed under the list (%s)", async (err, key) => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockRejectedValueOnce(err);
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText(key));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("says the erasure failed under the password once the organization was handed over", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockRejectedValueOnce(refusal("internal", 500));
    await confirm();
    expect(screen.queryByTestId("hand-over-u-chi")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(viText("settings.security.delete.failed"));
    expect(proofInput("password").props.value).toBe("pw");
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("settings.security.delete.confirm"));
  });

  it("offers to read the list again, and the web, when it does not load", async () => {
    mockRequest.mockRejectedValue(Object.assign(new Error("offline"), { status: 0 }));
    deleteAccount.mockRejectedValueOnce(withMembers());
    await open();
    await fireEvent.changeText(proofInput("password"), "pw");
    await confirm();
    expect(await screen.findByText(viText("mobile.account.transfer_empty"))).toBeOnTheScreen();
    mockRequest.mockResolvedValue(MEMBERS);
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.account.transfer_retry") }));
    expect(await screen.findByTestId("hand-over-u-chi")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.owner_open_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/acme/hq/settings");
  });

  it("forgets the choice when the sheet is cancelled", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
    await fireEvent.press(screen.getByTestId("settings-delete-account"));
    expect(screen.queryByTestId("hand-over-u-chi")).toBeNull();
    expect(proofInput("password").props.value).toBe("");
  });
});

// Settings › Delete account (delete-account.tsx, use-owner-step.ts): what erasure does, "Xác nhận là bạn" before it
// (a step-up token for delete_account, ADR 0049 §5), the erasure and the sign-out; an owner closes the organization
// with it, or hands it over first with its own proof (transfer_ownership), which a password buys once for both and a
// mailed code buys per action.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { StepUpAction, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo, Platform } from "react-native";
import { i18n } from "@/lib/i18n/singleton";
import { accountApi } from "@/data/account-api";
import { signInMethodsApi, stepUp } from "@/data/auth/methods-api";
import { forgetStepUp, holdStepUp } from "@/data/auth/step-up-store";
import { useAuthStore } from "@/data/auth/store";
import { useToastStore } from "@/data/stores/toast-store";
import { MockDismissingModal } from "@/test/dismissing-modal";
import { render, viText } from "@/test/render";
import { DeleteAccountSection } from "./delete-account";

// The sheets as iOS runs them: the owner's second proof sheet waits for the first to finish closing (use-step-up.ts).
jest.mock("react-native/Libraries/Modal/Modal", () => ({ __esModule: true, default: MockDismissingModal }));
jest.mock("@/data/account-api", () => ({ accountApi: { deleteAccount: jest.fn(), transferOwnership: jest.fn() } }));
const mockRequest = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>();
jest.mock("@/data/api", () => ({ api: { request: (path: string, init?: RequestInit) => mockRequest(path, init), getMe: jest.fn(async () => null) } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown, accountDeleted: jest.fn(async () => {}) })) };
});
jest.mock("@/data/auth/flow", () => ({ signInOffer: jest.fn(async () => ({ apple: null, google: null })) }));
jest.mock("@/data/auth/methods-api", () => ({
  stepUp: jest.fn(),
  stepUpWithProvider: jest.fn(),
  linkProvider: jest.fn(),
  linkPendingTicket: jest.fn(),
  signInMethodsApi: { getSignInMethods: jest.fn(), sendStepUpEmailCode: jest.fn(async () => true), setPassword: jest.fn(), unlink: jest.fn() },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const deleteAccount = jest.mocked(accountApi.deleteAccount);
const transferOwnership = jest.mocked(accountApi.transferOwnership);
const refusal = (code: string, status: number, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { name: "ApiError", status, body: { error: { code, fields } } });
const signedIn = (user: Record<string, unknown>) =>
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An", ...user } as never, accountDeleted: jest.fn(async () => {}) });
const methods = (proofs: StepUpProof[]) => ({
  password: { set: proofs.includes("password"), changed_at: null },
  google: { linked: !proofs.includes("password"), email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs,
});
/** A passing proof holds its token, as data/auth/methods-api.ts › stepUp does. */
const holds = (method: StepUpProof) => async (_proof: unknown, action: StepUpAction, userId: string) => {
  holdStepUp({ step_up_token: `su_${method}_${action}`, expires_at: new Date(Date.now() + 600_000).toISOString(), method }, { userId, action });
  return true;
};
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function open(workspace: { orgSlug: string; wsSlug: string } | null = { orgSlug: "acme", wsSlug: "hq" }) {
  await render(<DeleteAccountSection workspace={workspace ?? undefined} />);
  await fireEvent.press(screen.getByTestId("settings-delete-account"));
}
const confirm = async () => {
  await fireEvent.press(screen.getByTestId("delete-account-confirm"));
  await settle();
};
/** Types the password into the proof sheet and confirms it. */
const prove = async (password = "pw") => {
  await fireEvent.changeText(screen.getByTestId("step-up-password"), password);
  await fireEvent.press(screen.getByTestId("step-up-submit"));
  await settle();
};
/** Mails a code for the action the sheet is open for, and types it. */
const proveByMail = async (code: string) => {
  await fireEvent.press(screen.getByTestId("step-up-send-code"));
  await settle();
  await fireEvent.changeText(screen.getByTestId("step-up-email-code"), code);
  await settle();
};

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  signedIn({ has_password: true });
  jest.mocked(signInMethodsApi.getSignInMethods).mockResolvedValue(methods(["password", "email_code"]));
  jest.mocked(stepUp).mockImplementation(holds("password"));
});
afterEach(async () => {
  forgetStepUp();
  resetRuntimeConfig();
  await act(() => useToastStore.getState().clear());
  jest.restoreAllMocks();
  deleteAccount.mockReset();
  transferOwnership.mockReset();
  mockRequest.mockReset();
  jest.mocked(stepUp).mockReset();
});

describe("DeleteAccountSection", () => {
  it("says what erasure does before it asks for anything", async () => {
    await open();
    expect(screen.getByRole("header", { name: viText("settings.security.delete.title") })).toBeOnTheScreen();
    // The web dialog's lines, and what happens on this phone.
    for (const key of ["erased", "kept", "owner"]) {
      expect(screen.getByText(viText(`settings.security.delete.consequences.${key}`))).toBeOnTheScreen();
    }
    expect(screen.getByText(viText("mobile.account.consequence_this_phone"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.policy_link") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/vi/privacy#delete-account");
    expect(screen.queryByTestId("step-up-sheet")).toBeNull();
  });

  it("confirms it is you, then erases with the token and signs out", async () => {
    deleteAccount.mockResolvedValueOnce(undefined);
    await open();
    await confirm();
    expect(screen.getByText(viText("settings.security.stepUp.description", { action: viText("settings.security.stepUp.actions.delete_account") }))).toBeOnTheScreen();
    expect(deleteAccount).not.toHaveBeenCalled();
    await prove();
    expect(stepUp).toHaveBeenCalledWith({ kind: "password", password: "pw" }, "delete_account", "u1");
    expect(deleteAccount).toHaveBeenCalledWith({ step_up_token: "su_password_delete_account" });
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("mobile.account.deleted")]);
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
  });

  it("erases at once with a token held from a proof a moment ago", async () => {
    await holds("password")(null, "unlink_google", "u1");
    deleteAccount.mockResolvedValueOnce(undefined);
    await open();
    await confirm();
    expect(screen.queryByTestId("step-up-password")).toBeNull();
    expect(deleteAccount).toHaveBeenCalledWith({ step_up_token: "su_password_unlink_google" });
  });

  it("erases nothing when the proof sheet is closed, and keeps the sheet open", async () => {
    await open();
    await confirm();
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-account-confirm")).toBeOnTheScreen();
  });

  it("tells an owner to hand the organization over on the web when an older server names none", async () => {
    deleteAccount.mockRejectedValueOnce(refusal("owner_must_transfer", 409));
    await open();
    await confirm();
    await prove();
    expect(screen.getByText(viText("mobile.account.owner_title"))).toBeOnTheScreen();
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.owner_open_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/acme/hq/settings");
  });

  // select-workspace › Settings: no workspace to name, so the web app decides where its owner lands.
  it("sends an owner with no workspace to the web app itself", async () => {
    deleteAccount.mockRejectedValueOnce(refusal("owner_must_transfer", 409));
    await open(null);
    await confirm();
    await prove();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.account.owner_open_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/");
  });

  // Audit "owner-deletion-dead-end" (Apple 5.1.1(v)): the only member of an organization finishes in the app.
  describe("an owner who is the organization's only member", () => {
    const soleOwner = (canClose = true) =>
      refusal("owner_must_transfer", 409, { organization_name: "Một mình", organization_slug: "mot-minh", can_close: canClose });
    const slugInput = () => screen.getByTestId("delete-account-close-slug");

    async function reachClose() {
      deleteAccount.mockRejectedValueOnce(soleOwner());
      await open();
      await confirm();
      await prove();
    }

    it("closes the organization with the erasure once its address is typed again, the token still held", async () => {
      await reachClose();
      expect(screen.getByRole("header", { name: viText("mobile.account.close_title") })).toBeOnTheScreen();
      // What closing does, in the web dialog's words.
      expect(screen.getByText(viText("settings.security.delete.closeNotice", { name: "Một mình" }))).toBeOnTheScreen();
      for (const key of ["archived", "no_access", "restore", "billing"]) {
        expect(screen.getByText(viText(`org.close.consequences.${key}`, { name: "Một mình" }))).toBeOnTheScreen();
      }
      expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("settings.security.delete.closeAndDelete"));

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
      await settle();
      expect(stepUp).toHaveBeenCalledTimes(1);
      expect(deleteAccount).toHaveBeenLastCalledWith({ step_up_token: "su_password_delete_account", close_organization: "mot-minh" });
      expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
    });

    it("keeps the address it is closing with while the request is out, whatever is typed", async () => {
      await reachClose();
      await fireEvent.changeText(slugInput(), "mot-minh");
      let finish: () => void = () => {};
      deleteAccount.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
      await fireEvent.press(screen.getByTestId("delete-account-confirm"));
      await fireEvent.changeText(slugInput(), "khac");
      expect(slugInput().props.value).toBe("mot-minh");
      expect(slugInput().props.accessibilityState).toEqual({ busy: true });
      await act(async () => finish());
      await settle();
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

    it("says a failure that is about neither field under the address, which stays typed", async () => {
      await reachClose();
      deleteAccount.mockRejectedValueOnce(refusal("rate_limited", 429));
      await fireEvent.changeText(slugInput(), "mot-minh");
      await confirm();
      expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.account.rate_limited"));
      expect(slugInput().props.value).toBe("mot-minh");
    });

    it("forgets the organization when the sheet is cancelled", async () => {
      await reachClose();
      await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
      await fireEvent.press(screen.getByTestId("settings-delete-account"));
      expect(screen.queryByTestId("delete-account-close-slug")).toBeNull();
    });
  });

  it.each([
    ["rate limit", refusal("rate_limited", 429), "mobile.account.rate_limited"],
    ["no answer", Object.assign(new Error("offline"), { status: 0 }), "mobile.account.offline"],
    ["server error", refusal("internal", 500), "settings.security.delete.failed"],
  ])("says what went wrong when the server does not erase (%s)", async (_label, err, key) => {
    deleteAccount.mockRejectedValueOnce(err);
    await open();
    await confirm();
    await prove();
    expect(screen.getByTestId("delete-account-error")).toHaveTextContent(viText(key));
    expect(useAuthStore.getState().accountDeleted).not.toHaveBeenCalled();
  });

  it("asks for the proof again when the token was refused, and says a second refusal", async () => {
    deleteAccount.mockRejectedValue(refusal("proof_required", 403, { proofs: ["password"] }));
    await open();
    await confirm();
    await prove();
    expect(screen.getByTestId("step-up-password")).toBeOnTheScreen();
    await prove("pw again");
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("delete-account-error")).toHaveTextContent(viText("settings.security.stepUp.errors.proofRequired"));
  });

  it("ignores a second tap and a cancel while the request is out", async () => {
    await holds("password")(null, "delete_account", "u1");
    let finish: () => void = () => {};
    deleteAccount.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    await open();
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByText(viText("mobile.account.deleting"))).toBeOnTheScreen();
    await act(async () => finish());
    await settle();
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
  });

  it("erases nothing for nobody: a sheet left open after a sign-out elsewhere asks for no proof", async () => {
    useAuthStore.setState({ user: null });
    await open();
    await confirm();
    expect(screen.queryByTestId("step-up-password")).toBeNull();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("signs out even when wiping the phone fails, on Android, in English", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    signedIn({ has_password: true });
    useAuthStore.setState({ accountDeleted: jest.fn(async () => Promise.reject(new Error("keychain"))) });
    deleteAccount.mockResolvedValueOnce(undefined);
    await act(() => i18n.changeLanguage("en"));
    try {
      await open();
      await fireEvent.press(screen.getByRole("link", { name: i18n.t("mobile.account.policy_link") }));
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/privacy#delete-account");
      await confirm();
      await prove();
      expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([i18n.t("mobile.account.deleted")]);
    } finally {
      await act(() => i18n.changeLanguage("vi"));
    }
  });
});

// Review finding (Apple 5.1.1(v)): an owner whose organization has other members picks who takes over in the sheet,
// which hands it over (its own proof) and then erases the account.
describe("an owner whose organization has other members", () => {
  const withMembers = () => refusal("owner_must_transfer", 409, { organization_name: "Acme", organization_slug: "acme", can_close: false });
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
    await confirm();
    await prove();
    await screen.findByTestId("hand-over-u-chi");
  }

  it("lists who may take over, admins first, hands over to the one chosen, then erases, on one proof", async () => {
    await reachHandOver();
    expect(mockRequest).toHaveBeenCalledWith("/api/v1/orgs/acme/members?status=active&limit=100", expect.anything());
    expect(screen.queryByTestId("hand-over-u1")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.props.testID)).toEqual(["hand-over-u-chi", "hand-over-u-binh", "hand-over-u-dung"]);
    expect(screen.getAllByText("dung@acme.vn")).toHaveLength(1);
    expect(screen.getByLabelText(`Chi, ${viText("mobile.account.transfer_admin")}`)).toBeOnTheScreen();
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("mobile.account.transfer_confirm_pick"));

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
    // The password bought one token that serves both commands.
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(transferOwnership).toHaveBeenCalledWith("acme", "u-chi", "su_password_delete_account");
    expect(deleteAccount).toHaveBeenLastCalledWith({ step_up_token: "su_password_delete_account" });
    expect(useAuthStore.getState().accountDeleted).toHaveBeenCalledTimes(1);
  });

  const describes = (action: StepUpAction) =>
    viText("settings.security.stepUp.description", { action: viText(`settings.security.stepUp.actions.${action}`) });

  /** An owner without a password or second factor: every proof is a code mailed for one action. */
  async function reachHandOverByMail() {
    signedIn({ has_password: false });
    jest.mocked(signInMethodsApi.getSignInMethods).mockResolvedValue(methods(["email_code"]));
    jest.mocked(stepUp).mockImplementation(holds("email_code"));
    mockRequest.mockResolvedValue(MEMBERS);
    deleteAccount.mockRejectedValueOnce(withMembers());
    await open();
    await confirm();
    await proveByMail("111111");
    await fireEvent.press(await screen.findByTestId("hand-over-u-binh"));
  }

  it("asks an owner who confirms by mail for the hand-over's own code, keeping the erasure's", async () => {
    await reachHandOverByMail();
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockResolvedValueOnce(undefined);
    await confirm();
    expect(screen.getByText(describes("transfer_ownership"))).toBeOnTheScreen();
    await proveByMail("222222");
    expect(transferOwnership).toHaveBeenCalledWith("acme", "u-binh", "su_email_code_transfer_ownership");
    // The first code's token still serves the erasure: no third mail.
    expect(signInMethodsApi.sendStepUpEmailCode).toHaveBeenCalledTimes(2);
    expect(signInMethodsApi.sendStepUpEmailCode).toHaveBeenNthCalledWith(2, "transfer_ownership");
    expect(deleteAccount).toHaveBeenLastCalledWith({ step_up_token: "su_email_code_delete_account" });
  });

  it("asks for both codes before handing over, and moves nothing when the second sheet is closed", async () => {
    await reachHandOverByMail();
    // The erasure's token ran out while the owner chose who takes over.
    forgetStepUp();
    await confirm();
    expect(screen.getByText(describes("transfer_ownership"))).toBeOnTheScreen();
    await proveByMail("222222");
    expect(screen.getByText(describes("delete_account"))).toBeOnTheScreen();
    expect(transferOwnership).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    expect(transferOwnership).not.toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("mobile.account.transfer_confirm", { name: "Bình" }));

    // Asked again, both tokens are held now: the hand-over and the erasure run on them, in that order.
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockResolvedValueOnce(undefined);
    await confirm();
    await proveByMail("333333");
    expect(transferOwnership).toHaveBeenCalledWith("acme", "u-binh", "su_email_code_transfer_ownership");
    expect(deleteAccount).toHaveBeenLastCalledWith({ step_up_token: "su_email_code_delete_account" });
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
    await settle();
    expect(deleteAccount).toHaveBeenLastCalledWith({ step_up_token: "su_password_delete_account" });
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

  it("hands nothing over when the proof sheet is closed", async () => {
    forgetStepUp();
    mockRequest.mockResolvedValue(MEMBERS);
    deleteAccount.mockRejectedValueOnce(withMembers());
    await open();
    await confirm();
    await prove();
    forgetStepUp();
    await fireEvent.press(await screen.findByTestId("hand-over-u-chi"));
    await confirm();
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    expect(transferOwnership).not.toHaveBeenCalled();
    expect(screen.getByTestId("hand-over-u-chi")).toBeOnTheScreen();
  });

  it("asks once more when the hand-over's token is refused, and hands nothing over when that sheet is closed", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockRejectedValueOnce(refusal("proof_required", 403, { proofs: ["password"] }));
    await confirm();
    expect(screen.getByTestId("step-up-password")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("step-up-cancel"));
    await settle();
    expect(transferOwnership).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("delete-account-handed-over")).toBeNull();
  });

  it.each([
    ["rate limit", refusal("rate_limited", 429), "mobile.account.rate_limited"],
    ["no answer", Object.assign(new Error("offline"), { status: 0 }), "mobile.account.offline"],
    ["refusal", refusal("forbidden", 403), "settings.security.delete.failed"],
  ])("says why the hand-over failed under the list (%s)", async (_label, err, key) => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockRejectedValueOnce(err);
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent(viText(key));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("says the erasure failed once the organization was handed over, and that it moved, with the plain sheet back", async () => {
    await reachHandOver();
    await fireEvent.press(screen.getByTestId("hand-over-u-chi"));
    transferOwnership.mockResolvedValueOnce(undefined);
    deleteAccount.mockRejectedValueOnce(refusal("internal", 500));
    await confirm();
    expect(screen.queryByTestId("hand-over-u-chi")).toBeNull();
    const notice = viText("mobile.account.transfer_done_not_deleted", { organization: "Acme", name: "Chi" });
    expect(screen.getByText(notice)).toBeOnTheScreen();
    if (Platform.OS === "ios") expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(notice);
    expect(screen.getByTestId("delete-account-error")).toHaveTextContent(viText("settings.security.delete.failed"));
    expect(screen.getByTestId("delete-account-confirm")).toHaveTextContent(viText("settings.security.delete.confirm"));
    // Closing the sheet forgets it: the next one opens on the plain erasure.
    await fireEvent.press(screen.getByRole("button", { name: viText("settings.security.delete.cancel") }));
    await fireEvent.press(screen.getByTestId("settings-delete-account"));
    expect(screen.queryByText(notice)).toBeNull();
  });

  it("offers to read the list again, and the web, when it does not load", async () => {
    mockRequest.mockRejectedValue(Object.assign(new Error("offline"), { status: 0 }));
    deleteAccount.mockRejectedValueOnce(withMembers());
    await open();
    await confirm();
    await prove();
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
  });
});

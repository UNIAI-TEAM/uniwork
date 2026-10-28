import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types/user";

vi.mock("../api/endpoints/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/auth")>()),
  login: vi.fn(),
  verifyMfa: vi.fn(),
  resetPassword: vi.fn(),
  mfaSetup: vi.fn(),
  mfaConfirm: vi.fn(),
  mfaDisable: vi.fn(),
  deleteAccount: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));
vi.mock("../api/endpoints/organization-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/organization-members")>()),
  transferOwnership: vi.fn(),
}));
vi.mock("../api/endpoints/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/workspaces")>()),
  acceptInvite: vi.fn(),
}));
vi.mock("../api/endpoints/membership-invite-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/membership-invite-links")>()),
  joinMembershipInviteLink: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import * as links from "../api/endpoints/membership-invite-links";
import * as orgMembers from "../api/endpoints/organization-members";
import * as workspaces from "../api/endpoints/workspaces";
import { useTransferOwnership } from "../organizations/hooks";
import { useAcceptInvite } from "../workspaces/hooks";
import { useJoinMembershipInviteLink } from "../workspaces/membership-invite-hooks";
import {
  authKeys,
  useDeleteAccount,
  useLogin,
  useMfaConfirm,
  useMfaDisable,
  useMfaSetup,
  useResetPassword,
  useVerifyMfa,
} from "./hooks";
import { forgetStepUp, hasStepUp, rememberStepUp } from "./step-up-store";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: null,
  email_verified_at: "2026-10-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const grant = { step_up_token: "su", expires_at: "", method: "password" as const };

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const render = <T,>(hook: () => T) => renderHook(hook, { wrapper }).result;
/** Mount the mutation hook first, then run it inside act. */
function run<V, R>(hook: () => { mutateAsync: (vars: V) => Promise<R> }, vars: V): Promise<R> {
  const result = render(hook);
  return act(() => result.current.mutateAsync(vars));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(user);
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  forgetStepUp();
  qc.clear();
});

describe("sign-in hooks in link mode (ADR 0047)", () => {
  it("pass keepSignInTicket through login, the second factor and a reset", async () => {
    vi.mocked(auth.login).mockResolvedValueOnce({ mfa_required: true, mfa_token: "chal" });
    vi.mocked(auth.verifyMfa).mockResolvedValueOnce({ user, access_token: "t", link_skipped: "sign_in_method_taken" });
    vi.mocked(auth.resetPassword).mockResolvedValueOnce({ user, access_token: "t", reclaimed: true });
    await run(() => useLogin(), { email: "a", password: "b", keepSignInTicket: true });
    expect(auth.login).toHaveBeenCalledWith("a", "b", { keepSignInTicket: true });
    const verified = await run(() => useVerifyMfa(), { mfaToken: null, code: "123456", keepSignInTicket: true });
    expect(auth.verifyMfa).toHaveBeenCalledWith(null, "123456", { keepSignInTicket: true });
    expect(verified.link_skipped).toBe("sign_in_method_taken");
    const reset = await run(() => useResetPassword(), { token: "rt", password: "newpassword1" });
    expect(auth.resetPassword).toHaveBeenCalledWith("rt", "newpassword1", { keepSignInTicket: undefined });
    expect("reclaimed" in reset && reset.reclaimed).toBe(true);
  });

  it("a new session drops the step-up token of the one before", async () => {
    rememberStepUp(grant, "delete_account");
    vi.mocked(auth.verifyMfa).mockResolvedValueOnce({ user, access_token: "t" });
    await run(() => useVerifyMfa(), { mfaToken: "chal", code: "123456" });
    expect(hasStepUp("delete_account")).toBe(false);
  });
});

describe("sensitive commands send the held step-up token", () => {
  it("turning the second factor on, both steps", async () => {
    vi.mocked(auth.mfaSetup).mockResolvedValue({ secret: "S", otpauth_url: "otpauth://x" });
    vi.mocked(auth.mfaConfirm).mockResolvedValue([]);
    await run(() => useMfaSetup(), undefined);
    expect(auth.mfaSetup).toHaveBeenLastCalledWith("");
    rememberStepUp(grant, "enable_mfa");
    await run(() => useMfaSetup(), undefined);
    expect(auth.mfaSetup).toHaveBeenLastCalledWith("su");
    await run(() => useMfaConfirm(), "123456");
    expect(auth.mfaConfirm).toHaveBeenLastCalledWith("123456", "su");
  });

  it("turning the second factor on or off reads the method list again: its proofs changed", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(auth.mfaConfirm).mockResolvedValue(["code-1"]);
    vi.mocked(auth.mfaDisable).mockResolvedValue({ ...user, mfa_enabled_at: null });
    await run(() => useMfaConfirm(), "123456");
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: authKeys.signInMethods() });
    invalidate.mockClear();
    await run(() => useMfaDisable(), "654321");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authKeys.signInMethods() });
    expect(useAuthStore.getState().user?.mfa_enabled_at).toBeNull();
  });

  it("a refused proof drops the token", async () => {
    rememberStepUp(grant, "enable_mfa");
    vi.mocked(auth.mfaConfirm).mockRejectedValueOnce(new ApiError("", "proof_required", 403));
    await expect(run(() => useMfaConfirm(), "123456")).rejects.toBeInstanceOf(ApiError);
    expect(hasStepUp("enable_mfa")).toBe(false);
    vi.mocked(auth.mfaSetup).mockRejectedValueOnce(new ApiError("", "proof_required", 403));
    await expect(run(() => useMfaSetup(), undefined)).rejects.toBeInstanceOf(ApiError);
  });

  it("deleting the account: the token when held, the legacy proof only without", async () => {
    vi.mocked(auth.deleteAccount).mockResolvedValue();
    await run(() => useDeleteAccount(), { password: "pw" });
    expect(auth.deleteAccount).toHaveBeenLastCalledWith({ password: "pw" });
    useAuthStore.getState().setUser(user);
    rememberStepUp(grant, "delete_account");
    await run(() => useDeleteAccount(), { close_organization: "acme" });
    expect(auth.deleteAccount).toHaveBeenLastCalledWith({ close_organization: "acme", step_up_token: "su" });
    vi.mocked(auth.deleteAccount).mockRejectedValueOnce(new ApiError("", "proof_required", 403));
    useAuthStore.getState().setUser(user);
    rememberStepUp(grant, "delete_account");
    await expect(run(() => useDeleteAccount(), {})).rejects.toBeInstanceOf(ApiError);
    expect(hasStepUp("delete_account")).toBe(false);
  });

  it("handing an organization over: the token when held, else the typed password", async () => {
    vi.mocked(orgMembers.transferOwnership).mockResolvedValue(null);
    await run(() => useTransferOwnership("acme"), { toUserId: "u2", password: "pw" });
    expect(orgMembers.transferOwnership).toHaveBeenLastCalledWith("acme", "u2", { password: "pw" });
    await run(() => useTransferOwnership("acme"), { toUserId: "u2" });
    expect(orgMembers.transferOwnership).toHaveBeenLastCalledWith("acme", "u2", { password: "" });
    rememberStepUp(grant, "transfer_ownership");
    await run(() => useTransferOwnership("acme"), { toUserId: "u2", password: "pw" });
    expect(orgMembers.transferOwnership).toHaveBeenLastCalledWith("acme", "u2", { step_up_token: "su" });
  });

  it("the invitation switch and the invite link prove their transfer with it", async () => {
    vi.mocked(workspaces.acceptInvite).mockResolvedValue({ organization: null, workspace: null });
    vi.mocked(links.joinMembershipInviteLink).mockResolvedValue({ organization: null, workspace: null, joined_ids: [], already_all: false });
    vi.mocked(auth.me).mockResolvedValue(user);
    rememberStepUp(grant, "transfer_ownership");
    const resolve = [{ organization_id: "o1", action: "transfer" as const, transfer_to_user_id: "u9" }];
    await run(() => useAcceptInvite(), { token: "inv", resolve });
    expect(workspaces.acceptInvite).toHaveBeenCalledWith("inv", [{ ...resolve[0], step_up_token: "su" }]);
    await run(() => useJoinMembershipInviteLink(), { linkId: "l", secret: "s", resolve });
    expect(links.joinMembershipInviteLink).toHaveBeenCalledWith("l", "s", [{ ...resolve[0], step_up_token: "su" }]);
  });
});

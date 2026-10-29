import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignInMethods } from "../api/endpoints/sign-in-schemas";
import type { User } from "../types/user";

vi.mock("../api/endpoints/sign-in-ticket", () => ({
  getSignInTicket: vi.fn(),
  createFromSignInTicket: vi.fn(),
  sendSignInEmailClaim: vi.fn(),
  verifySignInEmailClaim: vi.fn(),
  discardSignInTicket: vi.fn(),
  linkSignInTicket: vi.fn(),
}));
vi.mock("../api/endpoints/sign-in-methods", () => ({
  getSignInMethods: vi.fn(),
  stepUp: vi.fn(),
  sendStepUpEmailCode: vi.fn(),
  setPassword: vi.fn(),
  startLink: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("../api/endpoints/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/auth")>()),
  me: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import * as methodsApi from "../api/endpoints/sign-in-methods";
import * as ticketApi from "../api/endpoints/sign-in-ticket";
import { authKeys } from "./hooks";
import {
  useCreateFromSignInTicket,
  useDiscardSignInTicket,
  useLinkSignInTicket,
  useSendSignInEmailClaim,
  useSendStepUpEmailCode,
  useSetPassword,
  useSignInMethods,
  useSignInTicket,
  useStartSignInMethodLink,
  useStepUp,
  useUnlinkSignInMethod,
  useVerifySignInEmailClaim,
} from "./sign-in-hooks";
import { forgetStepUp, hasStepUp, rememberStepUp, stepUpToken } from "./step-up-store";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user = (over: Partial<User> = {}): User => ({
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: null,
  email_verified_at: "2026-10-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
  ...over,
});
const methods: SignInMethods = {
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const grant = { step_up_token: "su", expires_at: "", method: "password" as const };
const ticket = { provider: "apple" as const, kind: "unmatched" as const, email: "an@icloud.com", name: "An", private_relay: false };

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const render = <T,>(hook: () => T) => renderHook(hook, { wrapper }).result;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  forgetStepUp();
  qc.clear();
});

describe("the choice screen's hooks", () => {
  it("reads the pending sign-in, null when there is none", async () => {
    vi.mocked(ticketApi.getSignInTicket).mockResolvedValueOnce(ticket).mockResolvedValueOnce(null);
    const first = render(() => useSignInTicket());
    await waitFor(() => expect(first.current.data).toEqual(ticket));
    await act(() => qc.invalidateQueries({ queryKey: authKeys.signInTicket() }));
    await waitFor(() => expect(first.current.data).toBeNull());
    const idle = render(() => useSignInTicket({ enabled: false }));
    expect(idle.current.fetchStatus).toBe("idle");
  });

  it("creating the account signs in, spends the ticket and drops any step-up token of the session before", async () => {
    useAuthStore.getState().setUser(user({ id: "u0" }));
    qc.setQueryData(authKeys.signInTicket(), ticket);
    vi.mocked(ticketApi.createFromSignInTicket).mockResolvedValueOnce({ user: user(), access_token: "t" });
    const created = render(() => useCreateFromSignInTicket());
    await act(() => created.current.mutateAsync({ displayName: "An" }));
    expect(ticketApi.createFromSignInTicket).toHaveBeenCalledWith("An");
    expect(useAuthStore.getState().user?.id).toBe("u1");
    expect(qc.getQueryData(authKeys.signInTicket())).toBeNull();
  });

  it("creating fails loudly when the session does not parse", async () => {
    vi.mocked(ticketApi.createFromSignInTicket).mockResolvedValueOnce(null);
    const created = render(() => useCreateFromSignInTicket());
    await expect(act(() => created.current.mutateAsync({}))).rejects.toMatchObject({ code: "malformed_response" });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("the claimed address may still owe its second factor: no session yet, the ticket spent", async () => {
    qc.setQueryData(authKeys.signInTicket(), ticket);
    vi.mocked(ticketApi.sendSignInEmailClaim).mockResolvedValueOnce(true);
    vi.mocked(ticketApi.verifySignInEmailClaim).mockResolvedValueOnce({ mfa_required: true, mfa_token: "chal" });
    const send = render(() => useSendSignInEmailClaim());
    await expect(act(() => send.current.mutateAsync("an@acme.vn"))).resolves.toBe(true);
    const verify = render(() => useVerifySignInEmailClaim());
    await expect(act(() => verify.current.mutateAsync({ email: "an@acme.vn", code: "482913" }))).resolves.toEqual({
      mfa_required: true,
      mfa_token: "chal",
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(qc.getQueryData(authKeys.signInTicket())).toBeNull();
  });

  it("links with the held step-up token for that provider, storing the answered user and methods", async () => {
    useAuthStore.getState().setUser(user());
    rememberStepUp(grant, "link_apple");
    vi.mocked(ticketApi.linkSignInTicket).mockResolvedValueOnce({ user: user({ display_name: "An mới" }), methods });
    const link = render(() => useLinkSignInTicket());
    await act(() => link.current.mutateAsync({ provider: "apple", move: true }));
    expect(ticketApi.linkSignInTicket).toHaveBeenCalledWith({ move: true, stepUpToken: "su" });
    expect(useAuthStore.getState().user?.display_name).toBe("An mới");
    expect(qc.getQueryData(authKeys.signInMethods())).toEqual(methods);
    expect(qc.getQueryData(authKeys.signInTicket())).toBeNull();
  });

  it("reads /me again when the answered user does not parse, and refetches an unreadable method list", async () => {
    useAuthStore.getState().setUser(user());
    vi.mocked(ticketApi.linkSignInTicket).mockResolvedValueOnce({ user: null, methods: null });
    vi.mocked(auth.me).mockResolvedValueOnce(user({ display_name: "from me" }));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const link = render(() => useLinkSignInTicket());
    await act(() => link.current.mutateAsync({ provider: "google" }));
    expect(ticketApi.linkSignInTicket).toHaveBeenCalledWith({ move: undefined, stepUpToken: null });
    expect(useAuthStore.getState().user?.display_name).toBe("from me");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authKeys.signInMethods() });
  });

  it("keeps the session user when /me cannot be read either", async () => {
    useAuthStore.getState().setUser(user());
    vi.mocked(ticketApi.linkSignInTicket).mockResolvedValueOnce({ user: null, methods });
    vi.mocked(auth.me).mockRejectedValueOnce(new Error("offline"));
    const link = render(() => useLinkSignInTicket());
    await act(() => link.current.mutateAsync({ provider: "google" }));
    expect(useAuthStore.getState().user?.display_name).toBe("An");
  });

  it("a proof_required refusal drops the held token so the screen asks again", async () => {
    useAuthStore.getState().setUser(user());
    rememberStepUp(grant, "link_google");
    vi.mocked(ticketApi.linkSignInTicket).mockRejectedValueOnce(new ApiError("", "proof_required", 403));
    const link = render(() => useLinkSignInTicket());
    await expect(act(() => link.current.mutateAsync({ provider: "google" }))).rejects.toMatchObject({ code: "proof_required" });
    expect(hasStepUp("link_google")).toBe(false);
  });

  it("discarding spends the ticket", async () => {
    qc.setQueryData(authKeys.signInTicket(), ticket);
    vi.mocked(ticketApi.discardSignInTicket).mockResolvedValueOnce();
    const discard = render(() => useDiscardSignInTicket());
    await act(() => discard.current.mutateAsync());
    expect(qc.getQueryData(authKeys.signInTicket())).toBeNull();
  });
});

describe("confirm it is you", () => {
  beforeEach(() => useAuthStore.getState().setUser(user()));

  it("keeps the token a step-up bought, for its action", async () => {
    vi.mocked(methodsApi.stepUp).mockResolvedValueOnce({ ...grant, method: "email_code" });
    const step = render(() => useStepUp());
    await act(() => step.current.mutateAsync({ proof: { kind: "email_code", code: "482913" }, action: "delete_account" }));
    expect(methodsApi.stepUp).toHaveBeenCalledWith({ kind: "email_code", code: "482913" }, "delete_account");
    expect(stepUpToken("delete_account")).toBe("su");
    expect(stepUpToken("transfer_ownership")).toBeNull();
  });

  it("fails when no usable token came back", async () => {
    vi.mocked(methodsApi.stepUp).mockResolvedValueOnce(null);
    const step = render(() => useStepUp());
    await expect(act(() => step.current.mutateAsync({ proof: { kind: "password", password: "pw" }, action: "set_password" }))).rejects.toMatchObject({
      code: "malformed_response",
    });
    expect(hasStepUp("set_password")).toBe(false);
  });

  it("mails a code for one action", async () => {
    vi.mocked(methodsApi.sendStepUpEmailCode).mockResolvedValueOnce(true);
    const send = render(() => useSendStepUpEmailCode());
    await expect(act(() => send.current.mutateAsync("enable_mfa"))).resolves.toBe(true);
    expect(methodsApi.sendStepUpEmailCode).toHaveBeenCalledWith("enable_mfa");
  });
});

describe("Settings › Sign-in methods", () => {
  beforeEach(() => useAuthStore.getState().setUser(user()));

  it("reads the methods under their key", async () => {
    vi.mocked(methodsApi.getSignInMethods).mockResolvedValueOnce(methods);
    const list = render(() => useSignInMethods());
    await waitFor(() => expect(list.current.data).toEqual(methods));
    expect(qc.getQueryData(authKeys.signInMethods())).toEqual(methods);
    expect(render(() => useSignInMethods({ enabled: false })).current.fetchStatus).toBe("idle");
  });

  it("changes the password with the current one, or sets it with the held token, and reads the sessions again", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(methodsApi.setPassword).mockResolvedValue({ user: user({ has_password: true }), methods });
    const set = render(() => useSetPassword());
    await act(() => set.current.mutateAsync({ newPassword: "new-password-2026", currentPassword: "old" }));
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-password-2026", current_password: "old" });
    await act(() => set.current.mutateAsync({ newPassword: "new-password-2026" }));
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-password-2026" });
    rememberStepUp({ ...grant, method: "email_code" }, "change_password");
    await act(() => set.current.mutateAsync({ newPassword: "new-password-2026" }));
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-password-2026", step_up_token: "su" });
    expect(useAuthStore.getState().user?.has_password).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authKeys.sessions() });
  });

  it("a held token proves the change even when the dialog also took the current password (an account with 2FA)", async () => {
    vi.mocked(methodsApi.setPassword)
      .mockRejectedValueOnce(new ApiError("", "proof_required", 403, undefined, { proofs: ["totp"] }))
      .mockResolvedValueOnce({ user: user({ has_password: true }), methods: { ...methods, proofs: ["totp"] } });
    const set = render(() => useSetPassword());
    const input = { newPassword: "new-password-2026", currentPassword: "old" };
    await expect(act(() => set.current.mutateAsync(input))).rejects.toMatchObject({ code: "proof_required" });
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-password-2026", current_password: "old" });
    // The proof dialog took the authenticator code; the same submit goes again.
    rememberStepUp({ ...grant, method: "totp" }, "change_password");
    await act(() => set.current.mutateAsync(input));
    expect(methodsApi.setPassword).toHaveBeenLastCalledWith({ new_password: "new-password-2026", step_up_token: "su" });
    expect(hasStepUp("change_password")).toBe(true);
  });

  it("starts a link with the held token and hands back where the browser goes", async () => {
    rememberStepUp(grant, "link_google");
    vi.mocked(methodsApi.startLink).mockResolvedValueOnce("https://api.test/api/v1/auth/google/start?intent=link");
    const start = render(() => useStartSignInMethodLink());
    await expect(act(() => start.current.mutateAsync({ provider: "google", returnTo: "/settings?tab=security" }))).resolves.toBe(
      "https://api.test/api/v1/auth/google/start?intent=link",
    );
    expect(methodsApi.startLink).toHaveBeenCalledWith("google", { stepUpToken: "su", returnTo: "/settings?tab=security" });
  });

  it("a link start without a usable URL fails", async () => {
    vi.mocked(methodsApi.startLink).mockResolvedValueOnce(null);
    const start = render(() => useStartSignInMethodLink());
    await expect(act(() => start.current.mutateAsync({ provider: "apple" }))).rejects.toMatchObject({ code: "malformed_response" });
    expect(methodsApi.startLink).toHaveBeenCalledWith("apple", { stepUpToken: "", returnTo: undefined });
  });

  it("unlinks with the held token, storing the answered methods and reading the sessions again", async () => {
    rememberStepUp(grant, "unlink_google");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(methodsApi.unlink).mockResolvedValueOnce({ user: user(), methods: { ...methods, google: { linked: false, email: null, linked_at: null } } });
    const unlink = render(() => useUnlinkSignInMethod());
    await act(() => unlink.current.mutateAsync({ provider: "google" }));
    expect(methodsApi.unlink).toHaveBeenCalledWith("google", "su");
    expect(qc.getQueryData<SignInMethods>(authKeys.signInMethods())?.google.linked).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authKeys.sessions() });
  });

  it("unlinking without a held token sends none and lets the server ask for a proof", async () => {
    vi.mocked(methodsApi.unlink).mockRejectedValueOnce(new ApiError("", "proof_required", 403, undefined, { proofs: ["password"] }));
    const unlink = render(() => useUnlinkSignInMethod());
    await expect(act(() => unlink.current.mutateAsync({ provider: "apple" }))).rejects.toMatchObject({ code: "proof_required" });
    expect(methodsApi.unlink).toHaveBeenCalledWith("apple", "");
  });
});

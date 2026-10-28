"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import type { StepUpProofInput } from "../api/endpoints/sign-in-methods-api";
import * as methods from "../api/endpoints/sign-in-methods";
import type { SignInMethodsChange, SignInProvider, StepUpAction, StepUpGrant } from "../api/endpoints/sign-in-schemas";
import * as ticket from "../api/endpoints/sign-in-ticket";
import { isMFAChallenge, type MFAChallenge, type SessionResponse } from "../types/user";
import { applyAuthSession, authKeys, requireSessionOrChallenge, setSessionUser } from "./hooks";
import { linkAction, unlinkAction } from "./step-up";
import { forgetStepUpIfRefused, rememberStepUp, stepUpToken } from "./step-up-store";

/**
 * Unified sign-in on the web (ADR 0047): the choice screen's pending
 * sign-in, "confirm it is you", and Settings › Sign-in methods, as queries
 * and mutations. Server state lives in TanStack Query under authKeys; the
 * step-up token in the memory store (step-up-store.ts), which every command
 * here reads and the step-up writes. A command that changed how the account
 * signs in stores the user it answered (or reads /me again when that does
 * not parse — never a fallback user) and the method list it answered.
 */

function malformed(): ApiError {
  return new ApiError("Unexpected response from the server", "malformed_response", 502);
}

async function applyChange(qc: QueryClient, change: SignInMethodsChange): Promise<void> {
  if (change.methods) qc.setQueryData(authKeys.signInMethods(), change.methods);
  else await qc.invalidateQueries({ queryKey: authKeys.signInMethods() });
  const user = change.user ?? (await auth.me().catch(() => null));
  if (user) setSessionUser(user);
}

/** The ticket is spent (or dropped) once a command answered: the choice screen must not offer it again. */
function spendTicket(qc: QueryClient): void {
  qc.setQueryData(authKeys.signInTicket(), null);
}

// --- The choice screen (/auth/continue, spec §4.3) --------------------------

/** The browser's pending sign-in; null when there is none (expired, spent, or never there). */
export function useSignInTicket(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authKeys.signInTicket(),
    queryFn: ({ signal }) => ticket.getSignInTicket(signal),
    enabled: options.enabled ?? true,
    // One retry for a dropped connection; "no ticket" is an answer (null), not an error.
    retry: 1,
  });
}

function onSessionOrChallenge(qc: QueryClient) {
  return (out: SessionResponse | MFAChallenge) => {
    spendTicket(qc);
    if (!isMFAChallenge(out)) applyAuthSession(out);
  };
}

/** "Tạo tài khoản mới": opens a session (fails loudly on a malformed answer, like login). */
export function useCreateFromSignInTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ displayName }: { displayName?: string }) =>
      requireSessionOrChallenge(await ticket.createFromSignInTicket(displayName)),
    onSuccess: onSessionOrChallenge(qc),
  });
}

/** "Tôi được mời bằng email khác", step one: mail a code. Resolves to whether the server said sent. */
export function useSendSignInEmailClaim() {
  return useMutation({ mutationFn: (email: string) => ticket.sendSignInEmailClaim(email) });
}

/** Step two: the code opens a session (or the second factor is still owed); fails loudly like login. */
export function useVerifySignInEmailClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; code: string; displayName?: string }) =>
      requireSessionOrChallenge(await ticket.verifySignInEmailClaim(input)),
    onSuccess: onSessionOrChallenge(qc),
  });
}

/**
 * "Liên kết" on the link step (/auth/continue?step=link), signed in: sends
 * the held step-up token for link_<provider> when there is one (needed when
 * this session began before the ticket), and `move` after a 409
 * sign_in_method_movable.
 */
export function useLinkSignInTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, move }: { provider: SignInProvider; move?: boolean }) =>
      ticket.linkSignInTicket({ move, stepUpToken: stepUpToken(linkAction(provider)) }),
    onError: forgetStepUpIfRefused,
    onSuccess: async (change) => {
      spendTicket(qc);
      await applyChange(qc, change);
    },
  });
}

/** "Hủy" / "Không liên kết": drop the pending sign-in. */
export function useDiscardSignInTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ticket.discardSignInTicket(),
    onSuccess: () => spendTicket(qc),
  });
}

// --- Confirm it is you (spec §3.7, §4.5) ------------------------------------

/**
 * Trade one proof for a ten-minute token, kept in memory for `action` and
 * every command it serves (step-up.ts). Fails when no usable token came back.
 */
export function useStepUp() {
  return useMutation({
    mutationFn: async ({ proof, action }: { proof: StepUpProofInput; action: StepUpAction }): Promise<StepUpGrant> => {
      const grant = await methods.stepUp(proof, action);
      if (!grant) throw malformed();
      rememberStepUp(grant, action);
      return grant;
    },
  });
}

/** Mail a code for `action` (one a minute, five a day). Resolves to whether the server said sent. */
export function useSendStepUpEmailCode() {
  return useMutation({ mutationFn: (action: StepUpAction) => methods.sendStepUpEmailCode(action) });
}

// --- Settings › Sign-in methods (spec §4.5) ---------------------------------

/** How the account signs in, and the proofs a sensitive command takes here; null when it could not be read. */
export function useSignInMethods(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authKeys.signInMethods(),
    queryFn: ({ signal }) => methods.getSignInMethods(signal),
    enabled: options.enabled ?? true,
  });
}

/**
 * Set the first password, or change it. `currentPassword` is the proof of a
 * change on an account without a second factor; otherwise the held step-up
 * token (set_password / change_password). A change signs every other
 * session out, so the session list is read again.
 */
export function useSetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ newPassword, currentPassword }: { newPassword: string; currentPassword?: string }) =>
      methods.setPassword(
        currentPassword
          ? { new_password: newPassword, current_password: currentPassword }
          : { new_password: newPassword, step_up_token: stepUpToken("set_password") ?? undefined },
      ),
    onError: forgetStepUpIfRefused,
    onSuccess: async (change) => {
      void qc.invalidateQueries({ queryKey: authKeys.sessions() });
      await applyChange(qc, change);
    },
  });
}

/**
 * Start linking `provider` from Settings: resolves to the URL the browser
 * goes to (the screen calls the platform's navigation with it). `returnTo`
 * is the same-origin page the round trip comes back to.
 */
export function useStartSignInMethodLink() {
  return useMutation({
    mutationFn: async ({ provider, returnTo }: { provider: SignInProvider; returnTo?: string }): Promise<string> => {
      const url = await methods.startLink(provider, { stepUpToken: stepUpToken(linkAction(provider)) ?? "", returnTo });
      if (!url) throw malformed();
      return url;
    },
    onError: forgetStepUpIfRefused,
  });
}

/** Unlink `provider` (never the last way in; signs every other session out). */
export function useUnlinkSignInMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider }: { provider: SignInProvider }) =>
      methods.unlink(provider, stepUpToken(unlinkAction(provider)) ?? ""),
    onError: forgetStepUpIfRefused,
    onSuccess: async (change) => {
      void qc.invalidateQueries({ queryKey: authKeys.sessions() });
      await applyChange(qc, change);
    },
  });
}

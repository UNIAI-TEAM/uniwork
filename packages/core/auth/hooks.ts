"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import { isMFAChallenge, type MFAChallenge, type SessionResponse, type User, type UserSession } from "../types/user";
import { useAuthStore, type SessionStatus } from "./store";

export type { SessionStatus };

export const authKeys = {
  providers: () => ["auth", "providers"] as const,
  sessions: () => ["auth", "sessions"] as const,
};

/** Update the session user (after PATCH onboarding/complete). */
export function setSessionUser(user: User) {
  useAuthStore.getState().setUser(user);
}

/**
 * Thin view over the auth store, kept under the name every screen already
 * uses. Triggers initialization on first use so a page rendered outside
 * CoreProvider (tests, isolated mounts) still resolves the session.
 */
export function useSession(): { user: User | null; status: SessionStatus } {
  const state = useAuthStore(useShallow((s) => ({ user: s.user, status: s.status })));
  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);
  return state;
}

// A login/register response that fails its schema is the one drift that
// cannot be smoothed over — there is no token to start a session with. It is
// surfaced as an ApiError so the form shows its normal failure state.
function requireSession(sess: SessionResponse | null): SessionResponse {
  if (!sess) throw new ApiError("Unexpected response from the server", "malformed_response", 502);
  return sess;
}

function applyAuthSession(sess: SessionResponse): void {
  setSessionUser(sess.user);
}

/** Resolves to a session, or to the MFA challenge the login screen must answer with `useVerifyMfa`. */
export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }): Promise<SessionResponse | MFAChallenge> => {
      const out = await auth.login(email, password);
      return isMFAChallenge(out) ? out : requireSession(out);
    },
    onSuccess: (out) => {
      if (!isMFAChallenge(out)) applyAuthSession(out);
    },
  });
}

export function useVerifyMfa() {
  return useMutation({
    mutationFn: async ({ mfaToken, code }: { mfaToken: string | null; code: string }) =>
      requireSession(await auth.verifyMfa(mfaToken, code)),
    onSuccess: applyAuthSession,
  });
}

export function useMfaSetup() {
  return useMutation({ mutationFn: () => auth.mfaSetup() });
}

/**
 * Deliberately does not refresh the session user: the recovery codes are
 * shown once, and swapping the user (MFA on) would unmount the screen that
 * shows them. The screen calls `useRefreshSessionUser` when the person is done.
 */
export function useMfaConfirm() {
  return useMutation({ mutationFn: (code: string) => auth.mfaConfirm(code) });
}

export function useRefreshSessionUser() {
  return useMutation({
    mutationFn: () => auth.me(),
    onSuccess: (user) => {
      if (user) setSessionUser(user);
    },
  });
}

export function useMfaDisable() {
  return useMutation({
    mutationFn: (code: string) => auth.mfaDisable(code),
    onSuccess: (user) => {
      if (user) setSessionUser(user);
    },
  });
}

export function useSessions() {
  return useQuery<UserSession[]>({ queryKey: authKeys.sessions(), queryFn: auth.listSessions });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => auth.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => auth.revokeOtherSessions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: auth.DeleteAccountBody) => auth.deleteAccount(body),
    onSuccess: async () => {
      await useAuthStore.getState().logout();
      qc.clear();
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async ({
      email,
      password,
      displayName,
    }: {
      email: string;
      password: string;
      displayName: string;
    }) => requireSession(await auth.registerUser(email, password, displayName)),
    onSuccess: applyAuthSession,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => useAuthStore.getState().logout(),
    onSuccess: () => qc.clear(),
  });
}

// The verified user replaces the session user so every gate that reads
// email_verified_at moves on without a refetch.
export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (code: string) => {
      const user = await auth.verifyEmail(code);
      if (!user) throw new ApiError("Unexpected response from the server", "malformed_response", 502);
      return user;
    },
    onSuccess: (user) => setSessionUser(user),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: () => auth.resendVerification() });
}

/** Deployment-level and static for the page's life, hence never stale. */
export function useAuthProviders() {
  return useQuery({ queryKey: authKeys.providers(), queryFn: auth.authProviders, staleTime: Infinity });
}

export function usePatchMe() {
  return useMutation({
    mutationFn: (body: { display_name?: string; locale?: "vi" | "en"; timezone?: string }) => auth.patchMe(body),
    onSuccess: (user) => {
      if (user) setSessionUser(user);
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => auth.forgotPassword(email) });
}

/** Like useLogin: an MFA account gets the challenge (cookie-borne) instead of a session. */
export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }): Promise<SessionResponse | MFAChallenge> => {
      const out = await auth.resetPassword(token, password);
      return isMFAChallenge(out) ? out : requireSession(out);
    },
    onSuccess: (out) => {
      if (!isMFAChallenge(out)) setSessionUser(out.user);
    },
  });
}

export function useUploadAvatar() {
  return useMutation({
    mutationFn: (file: File) => auth.uploadAvatar(file),
    onSuccess: (user) => {
      if (user) setSessionUser(user);
    },
  });
}

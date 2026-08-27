"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import type { SessionResponse, User } from "../types/user";
import { useAuthStore, type SessionStatus } from "./store";

export type { SessionStatus };

export const authKeys = {
  providers: () => ["auth", "providers"] as const,
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

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) =>
      requireSession(await auth.login(email, password)),
    onSuccess: (sess) => setSessionUser(sess.user),
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
    onSuccess: (sess) => setSessionUser(sess.user),
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
    mutationFn: (displayName: string) => auth.patchMe({ display_name: displayName }),
    onSuccess: (user) => {
      if (user) setSessionUser(user);
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

"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import { getAccessToken, subscribe } from "../api/session";
import type { SessionResponse, User } from "../types/user";

export type SessionStatus = "loading" | "authed" | "anon";

let cachedUser: User | null = null;
const userListeners = new Set<() => void>();

/** Update the cached session user (after PATCH onboarding/complete) and notify every useSession. */
export function setSessionUser(user: User) {
  cachedUser = user;
  userListeners.forEach((fn) => fn());
}

export function useSession(): { user: User | null; status: SessionStatus } {
  const [state, setState] = useState<{ user: User | null; status: SessionStatus }>(
    cachedUser ? { user: cachedUser, status: "authed" } : { user: null, status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    if (!cachedUser && !getAccessToken()) {
      void auth.refreshSession().then((sess) => {
        if (cancelled) return;
        cachedUser = sess?.user ?? null;
        setState(sess ? { user: sess.user, status: "authed" } : { user: null, status: "anon" });
      });
    }
    const unsub = subscribe(() => {
      if (!getAccessToken()) {
        cachedUser = null;
        if (!cancelled) setState({ user: null, status: "anon" });
      }
    });
    const onUser = () => {
      if (!cancelled && cachedUser) setState({ user: cachedUser, status: "authed" });
    };
    userListeners.add(onUser);
    return () => {
      cancelled = true;
      unsub();
      userListeners.delete(onUser);
    };
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
    mutationFn: () => auth.logout(),
    onSuccess: () => {
      cachedUser = null;
      qc.clear();
    },
  });
}

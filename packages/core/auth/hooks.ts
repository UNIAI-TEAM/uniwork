"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as api from "../api/client";
import { getAccessToken, subscribe } from "../api/session";
import type { User } from "../types";

export type SessionStatus = "loading" | "authed" | "anon";

let cachedUser: User | null = null;
const userListeners = new Set<() => void>();

/** Cập nhật user trong cache session (sau PATCH onboarding/complete) và báo mọi useSession. */
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
      void api.refreshSession().then((sess) => {
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

export function useLogin() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (sess) => setSessionUser(sess.user),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: ({
      email,
      password,
      displayName,
    }: {
      email: string;
      password: string;
      displayName: string;
    }) => api.registerUser(email, password, displayName),
    onSuccess: (sess) => setSessionUser(sess.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      cachedUser = null;
      qc.clear();
    },
  });
}

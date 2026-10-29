"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@uniwork/core";
import { useLogout, useSession } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import { isSignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { paths } from "@uniwork/core/paths";
import { DesktopConsentView, isDesktopCallbackUrl, type DesktopConsentState } from "@uniwork/views/auth/desktop-consent";
import { useNavigation } from "@uniwork/views/navigation";

export default function DesktopAuthorizePage() {
  const { searchParams, replace } = useNavigation();
  const { status } = useSession();
  const logout = useLogout();
  const attemptId = searchParams.get("attempt_id") ?? "";
  // The way back here after a sign-in leaves the provider hint out, so
  // arriving signed in shows the consent instead of starting the provider
  // again. The hint itself (spec §3.5) goes to /login, which follows it once.
  const consentPath = `${paths.desktopAuthorize()}?attempt_id=${encodeURIComponent(attemptId)}`;
  const hint = searchParams.get("provider");
  // The app's register screen: the provider starts to sign up, no choice screen.
  const signUp = searchParams.get("intent") === "sign_up";
  const signInUrl = paths.login({
    next: consentPath,
    provider: isSignInProvider(hint) ? hint : null,
    intent: signUp ? "sign_up" : null,
  });
  const [consent, setConsent] = useState<Awaited<ReturnType<typeof api.auth.desktopConsent>>>(null);
  const [state, setState] = useState<DesktopConsentState>("pending");
  const [callbackUrl, setCallbackUrl] = useState<string>();
  const load = useCallback(() => {
    if (status !== "authed") return;
    if (!attemptId) { setState("error"); return; }
    void api.auth.desktopConsent(attemptId)
      .then((value) => {
        if (value) {
          setConsent(value);
          const next = value.status ?? "pending";
          setState(next === "approved" || next === "cancelled" || next === "expired" || next === "pending" ? next : "error");
          // The server state controls approval; the same-tab callback is only
          // a convenience for reopening the app after an approved reload.
          const saved = sessionStorage.getItem(`desktop-callback:${attemptId}`);
          if (next === "approved" && saved && isDesktopCallbackUrl(saved, value.redirect_uri)) setCallbackUrl(saved);
        }
        else { setConsent(null); setState("error"); }
      })
      .catch((error: unknown) => {
        setConsent(null);
        if (error instanceof ApiError && error.status === 401 && error.code !== "auth_code_invalid") { replace(signInUrl); return; }
        setState(error instanceof ApiError && (error.code === "auth_code_invalid" || error.status === 410) ? "expired" : "error");
      });
  }, [attemptId, signInUrl, replace, status]);
  // Signing out ("Không phải bạn?") lands here too: an anonymous browser goes
  // to sign in, the app's provider hint included, and comes back to this
  // same attempt as whoever signs in.
  useEffect(() => {
    if (status === "anon") { replace(signInUrl); return; }
    load();
  }, [load, signInUrl, replace, status]);
  // A retry shows the consent's loading shape again, so the press is seen and
  // a fresh CSRF token replaces the one a failed approval may have spent.
  const retry = () => { setConsent(null); setState("pending"); load(); };
  const openApp = (url: string | undefined) => { if (url && isDesktopCallbackUrl(url, consent?.redirect_uri)) window.location.assign(url); };
  return <DesktopConsentView consent={consent} state={state} callbackUrl={callbackUrl} onRetry={retry} onSwitchAccount={() => logout.mutateAsync()} onOpenDesktop={() => openApp(callbackUrl)} onDecision={async (decision) => {
    if (!consent) { setState("error"); return; }
    try {
    const result = await api.auth.desktopConsentCommand({ attempt_id: consent.attempt_id, csrf_token: consent.csrf_token, decision });
    if (!result) { setState("error"); return; }
    if (decision === "approve" && result.status === "approved" && result.callback_url && isDesktopCallbackUrl(result.callback_url, consent.redirect_uri)) { sessionStorage.setItem(`desktop-callback:${attemptId}`, result.callback_url); setCallbackUrl(result.callback_url); setState("approved");
      // The app gets its code only through this callback (a desktop deep link,
      // the phone's auth sheet closing on it): it opens at once, while the
      // Allow press still counts as the gesture a custom scheme needs. The
      // result screen stays behind it, its "Mở {{app}}" the fallback.
      window.location.assign(result.callback_url); return; }
    if (decision === "cancel" && result.status === "cancelled") { setState("cancelled"); return; }
    setState("error");
    } catch { setState("error"); }
  }} />;
}

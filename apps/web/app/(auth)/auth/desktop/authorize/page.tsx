"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import { DesktopConsentView, type DesktopConsentState } from "@uniwork/views/auth/desktop-consent";
import { useNavigation } from "@uniwork/views/navigation";
import { useTranslation } from "react-i18next";

export default function DesktopAuthorizePage() {
  const { searchParams, replace } = useNavigation();
  const { t } = useTranslation();
  const { status } = useSession();
  const attemptId = searchParams.get("attempt_id") ?? "";
  const loginUrl = `/login?next=${encodeURIComponent(`/auth/desktop/authorize?attempt_id=${encodeURIComponent(attemptId)}`)}`;
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
          if (next === "approved" && saved && isDesktopCallbackUrl(saved)) setCallbackUrl(saved);
        }
        else { setConsent(null); setState("error"); }
      })
      .catch((error: unknown) => {
        setConsent(null);
        if (error instanceof ApiError && error.status === 401 && error.code !== "auth_code_invalid") { replace(loginUrl); return; }
        setState(error instanceof ApiError && (error.code === "auth_code_invalid" || error.status === 410) ? "expired" : "error");
      });
  }, [attemptId, loginUrl, replace, status]);
  useEffect(() => {
    if (status === "anon") { replace(loginUrl); return; }
    load();
  }, [load, loginUrl, replace, status]);
  if (!consent && state === "pending") return <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6"><p role="status">{t("auth.desktop.loading")}</p></main>;
  return <DesktopConsentView consent={consent} state={state} callbackUrl={callbackUrl} onRetry={load} onBack={() => replace(loginUrl)} onOpenDesktop={() => { if (callbackUrl && isDesktopCallbackUrl(callbackUrl)) window.location.assign(callbackUrl); }} onDecision={async (decision) => {
    if (!consent) { setState("error"); return; }
    try {
    const result = await api.auth.desktopConsentCommand({ attempt_id: consent.attempt_id, csrf_token: consent.csrf_token, decision });
    if (!result) { setState("error"); return; }
    if (decision === "approve" && result.status === "approved" && result.callback_url && isDesktopCallbackUrl(result.callback_url)) { sessionStorage.setItem(`desktop-callback:${attemptId}`, result.callback_url); setCallbackUrl(result.callback_url); setState("approved"); return; }
    if (decision === "cancel" && result.status === "cancelled") { setState("cancelled"); return; }
    setState("error");
    } catch { setState("error"); }
  }} />;
}

function isDesktopCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["uniwork-office:", "uniwork-office-dev:"].includes(url.protocol) && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
}

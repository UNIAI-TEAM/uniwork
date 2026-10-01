"use client";

import { useEffect, useState } from "react";
import { api } from "@uniwork/core";
import { DesktopConsentView, type DesktopConsentState } from "@uniwork/views/auth/desktop-consent";
import { useNavigation } from "@uniwork/views/navigation";
import { useTranslation } from "react-i18next";

export default function DesktopAuthorizePage() {
  const { searchParams, replace } = useNavigation();
  const { t } = useTranslation();
  const attemptId = searchParams.get("attempt_id") ?? "";
  const [consent, setConsent] = useState<Awaited<ReturnType<typeof api.auth.desktopConsent>>>(null);
  const [state, setState] = useState<DesktopConsentState>("pending");
  const [callbackUrl, setCallbackUrl] = useState<string>();
  const [loadError, setLoadError] = useState(false);
  const load = () => {
    if (!attemptId) { setState("error"); return; }
    setLoadError(false);
    void api.auth.desktopConsent(attemptId)
      .then((value) => {
        if (value) { setConsent(value); setState("pending"); }
        else { setConsent(null); setState("expired"); }
      })
      .catch(() => { setConsent(null); setLoadError(true); setState("error"); });
  };
  useEffect(() => {
    load();
  }, [attemptId]);
  if (!consent && state === "pending") return <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6"><p role="status">{t("auth.desktop.loading")}</p></main>;
  return <DesktopConsentView consent={consent} state={state} callbackUrl={callbackUrl} onRetry={load} onBack={() => replace("/login")} onOpenDesktop={() => { if (callbackUrl && isDesktopCallbackUrl(callbackUrl)) window.location.assign(callbackUrl); }} onDecision={async (decision) => {
    if (!consent) { setState("error"); return; }
    const result = await api.auth.desktopConsentCommand({ attempt_id: consent.attempt_id, csrf_token: consent.csrf_token, decision });
    if (!result) { setState("error"); return; }
    if (decision === "approve" && result.status === "approved" && result.callback_url && isDesktopCallbackUrl(result.callback_url)) { setCallbackUrl(result.callback_url); setState("approved"); return; }
    if (decision === "cancel" && result.status === "cancelled") { setState("cancelled"); return; }
    setState("error");
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

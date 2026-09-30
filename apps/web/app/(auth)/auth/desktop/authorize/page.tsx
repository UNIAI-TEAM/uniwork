"use client";

import { useEffect, useState } from "react";
import { api } from "@uniwork/core";
import { DesktopConsentView } from "@uniwork/views/auth/desktop-consent";
import { useNavigation } from "@uniwork/views/navigation";
import { useTranslation } from "react-i18next";

export default function DesktopAuthorizePage() {
  const { searchParams, replace } = useNavigation();
  const { t } = useTranslation();
  const attemptId = searchParams.get("attempt_id") ?? "";
  const [consent, setConsent] = useState<Awaited<ReturnType<typeof api.auth.desktopConsent>>>(null);
  useEffect(() => {
    const loginPath = attemptId
      ? `/login?next=${encodeURIComponent(`/auth/desktop/authorize?attempt_id=${attemptId}`)}`
      : "/login";
    if (!attemptId) {
      replace(loginPath);
      return;
    }
    void api.auth.desktopConsent(attemptId)
      .then((value) => {
        if (value) setConsent(value);
        else replace(loginPath);
      })
      .catch(() => replace(loginPath));
  }, [attemptId, replace]);
  if (!consent) return <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6"><p role="status">{t("auth.desktop.loading")}</p></main>;
  return <DesktopConsentView consent={consent} onDecision={async (decision) => {
    const result = await api.auth.desktopConsentCommand({ attempt_id: consent.attempt_id, csrf_token: consent.csrf_token, decision });
    if (!result) return;
    if (decision === "approve" && result.callback_url && isDesktopCallbackUrl(result.callback_url)) window.location.assign(result.callback_url);
    else replace("/login");
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

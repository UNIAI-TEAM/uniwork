"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@uniwork/core";
import type { ConnectConsent } from "@uniwork/core/api/endpoints/connect";
import { ApiError } from "@uniwork/core/api/http";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { ConnectConsentView, type ConnectConsentState } from "@uniwork/views/auth/connect-consent";
import { useNavigation } from "@uniwork/views/navigation";

export default function ConnectAuthorizePage() {
  const { searchParams, replace } = useNavigation();
  const { t } = useTranslation();
  const { status } = useSession();
  const attemptId = searchParams.get("attempt") ?? "";
  const errorCode = searchParams.get("error") ?? "";
  const loginUrl = `${paths.login()}?next=${encodeURIComponent(`${paths.connectAuthorize()}?attempt=${encodeURIComponent(attemptId)}`)}`;
  const [consent, setConsent] = useState<ConnectConsent | null>(null);
  const [state, setState] = useState<ConnectConsentState>(errorCode ? "error" : "pending");
  const [loaded, setLoaded] = useState(errorCode !== "");
  // Every read of the attempt rotates its CSRF token on the server, so the
  // page reads once per attempt: a second read (StrictMode's double effect, a
  // re-render) would leave the first token in state stale.
  const requestedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!attemptId) {
      setState("error");
      setLoaded(true);
      return;
    }
    try {
      const value = await api.connect.getConnectConsent(attemptId);
      setConsent(value);
      setState(value ? stateOf(value.status) : "error");
      setLoaded(true);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        replace(loginUrl);
        return;
      }
      setState(error instanceof ApiError && error.status === 410 ? "expired" : "error");
      setLoaded(true);
    }
  }, [attemptId, loginUrl, replace]);

  useEffect(() => {
    if (errorCode) return;
    if (status === "anon") {
      replace(loginUrl);
      return;
    }
    if (status !== "authed" || requestedFor.current === attemptId) return;
    requestedFor.current = attemptId;
    void load();
  }, [attemptId, errorCode, load, loginUrl, replace, status]);

  if (!loaded) {
    return <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6"><p role="status">{t("auth.connect.loading")}</p></main>;
  }
  return (
    <ConnectConsentView
      consent={consent}
      state={state}
      errorCode={errorCode || undefined}
      onRetry={errorCode ? undefined : () => void load()}
      onDecision={async (decision, organizationId) => {
        if (!consent) {
          setState("error");
          return;
        }
        try {
          const result = await api.connect.decideConnectConsent(consent.attempt_id, { decision, csrf_token: consent.csrf_token, organization_id: organizationId });
          if (!result || !isHttpUrl(result.redirect_to)) {
            setState("error");
            return;
          }
          setState(result.status === "approved" ? "approved" : "cancelled");
          window.location.assign(result.redirect_to);
        } catch (error) {
          // The token the form holds is no longer the one the server keeps
          // (another tab or load read the attempt since): read again for a
          // fresh one and show the form, rather than a dead end.
          if (error instanceof ApiError && error.status === 400 && error.code === "csrf_invalid") {
            await load();
            return;
          }
          setState(error instanceof ApiError && error.status === 410 ? "expired" : "error");
        }
      }}
    />
  );
}

// An ended attempt is answered with its final status; anything unknown reads
// as expired, which is what the person has to do next (start again).
function stateOf(status: string): ConnectConsentState {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "cancelled":
      return "cancelled";
    default:
      return "expired";
  }
}

// The server only ever returns the client's registered redirect URI; this
// guard keeps a malformed response from becoming a javascript: navigation.
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

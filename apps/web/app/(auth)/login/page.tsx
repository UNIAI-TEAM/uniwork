"use client";
import { useCallback, useEffect } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { sanitizeNextUrl, type AuthGateUser } from "@uniwork/core/paths";
import { LoginView, type GoogleLoginError } from "@uniwork/views/auth/login-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";
import { useIsUniChatHost } from "../../../platform/desktop-host";
import { UniChatLoginGate } from "../../../platform/unichat-login-gate";

const GOOGLE_ERRORS: ReadonlySet<string> = new Set(["google_denied", "google_failed", "google_unverified"]);

export default function LoginPage() {
  const isUniChat = useIsUniChatHost();
  const { push, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const next = sanitizeNextUrl(searchParams.get("next"));
  const rawError = searchParams.get("error");
  const initialError = rawError && GOOGLE_ERRORS.has(rawError) ? (rawError as GoogleLoginError) : null;
  const rawReason = searchParams.get("reason");
  const reason = rawReason === "meeting_invite" || rawReason === "session_expired" ? rawReason : null;
  const initialMfa = searchParams.get("mfa") === "1";
  const { status, user } = useSession();
  const goAfterLogin = useCallback(
    async (u: AuthGateUser) => {
      const workspaces = await api.workspaces.list().catch(() => []);
      const destination = await resolveDestination(u, workspaces);
      // `next` only once every gate step is behind the user.
      push(next && destination !== "/verify" && destination !== "/onboarding" ? next : destination);
    },
    [next, push, resolveDestination],
  );
  useEffect(() => {
    // The shell's login lands as a token the auth store resolves, not through this form's onSuccess.
    if (isUniChat && status === "authed" && user) void goAfterLogin(user);
  }, [isUniChat, status, user, goAfterLogin]);
  // The shell's cookie-less session only starts through the system browser (PKCE), never this form.
  if (isUniChat) return status === "authed" ? null : <UniChatLoginGate />;
  return (
    <LoginView
      next={next}
      initialError={initialError}
      reason={reason}
      initialMfa={initialMfa}
      onSuccess={(sess) => goAfterLogin(sess.user)}
    />
  );
}

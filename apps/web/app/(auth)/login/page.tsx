"use client";
import { api } from "@uniwork/core";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { LoginView, type GoogleLoginError } from "@uniwork/views/auth/login-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

const GOOGLE_ERRORS: ReadonlySet<string> = new Set(["google_denied", "google_failed", "google_unverified"]);

export default function LoginPage() {
  const { push, searchParams } = useNavigation();
  const resolveDestination = useLoggedInDestination();
  const next = sanitizeNextUrl(searchParams.get("next"));
  const rawError = searchParams.get("error");
  const initialError = rawError && GOOGLE_ERRORS.has(rawError) ? (rawError as GoogleLoginError) : null;
  const rawReason = searchParams.get("reason");
  const reason = rawReason === "meeting_invite" || rawReason === "session_expired" ? rawReason : null;
  const initialMfa = searchParams.get("mfa") === "1";
  return (
    <LoginView
      next={next}
      initialError={initialError}
      reason={reason}
      initialMfa={initialMfa}
      onSuccess={async (sess) => {
        const workspaces = await api.workspaces.list().catch(() => []);
        const destination = await resolveDestination(sess.user, workspaces);
        // `next` only once every gate step is behind the user.
        push(next && destination !== "/verify" && destination !== "/onboarding" ? next : destination);
      }}
    />
  );
}

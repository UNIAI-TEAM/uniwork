"use client";
import { api } from "@uniwork/core";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { LoginView, type GoogleLoginError } from "@uniwork/views/auth/login-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

const GOOGLE_ERRORS: ReadonlySet<string> = new Set(["google_denied", "google_failed", "google_unverified"]);

export default function LoginPage() {
  const { push, searchParams } = useNavigation();
  const next = sanitizeNextUrl(searchParams.get("next"));
  const rawError = searchParams.get("error");
  const initialError = rawError && GOOGLE_ERRORS.has(rawError) ? (rawError as GoogleLoginError) : null;
  const reason = searchParams.get("reason") === "meeting_invite" ? ("meeting_invite" as const) : null;
  return (
    <LoginView
      next={next}
      initialError={initialError}
      reason={reason}
      onSuccess={async (sess) => {
        const workspaces = await api.workspaces.list();
        const destination = await resolveLoggedInDestination(sess.user, workspaces);
        // `next` only once every gate step is behind the user.
        push(next && destination !== "/verify" && destination !== "/onboarding" ? next : destination);
      }}
    />
  );
}

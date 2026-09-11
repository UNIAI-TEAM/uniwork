"use client";
import { useEffect } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { paths, sanitizeNextUrl } from "@uniwork/core/paths";
import { AuthCallbackView } from "@uniwork/views/auth/auth-callback-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useNavigation } from "@uniwork/views/navigation";

/**
 * Where the API sends the browser after a Google sign-in. The refresh cookie
 * is already set, so the session initializer running at boot resolves the
 * user; this page only waits for it and routes. Anonymous here means the
 * cookie did not arrive (blocked, expired) — back to login with the error.
 */
export default function AuthCallbackPage() {
  const { replace, searchParams } = useNavigation();
  const { status, user } = useSession();
  const next = sanitizeNextUrl(searchParams.get("next"));

  useEffect(() => {
    if (status === "anon") {
      replace(`${paths.login()}?error=google_failed`);
      return;
    }
    if (status !== "authed" || !user) return;
    void (async () => {
      const workspaces = await api.workspaces.list().catch(() => []);
      const destination = await resolveLoggedInDestination(user, workspaces);
      // A verified, onboarded user goes where they were headed; anyone still
      // owing a gate step goes through it first.
      replace(next && destination !== paths.verify() && destination !== paths.onboarding() ? next : destination);
    })();
  }, [status, user, next, replace]);

  return <AuthCallbackView />;
}

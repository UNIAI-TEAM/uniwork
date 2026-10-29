"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@uniwork/core";
import { useSession } from "@uniwork/core/auth";
import { paths, sanitizeNextUrl } from "@uniwork/core/paths";
import { AuthCallbackView } from "@uniwork/views/auth/auth-callback-view";
import { useLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";
import { useSessionNotices } from "@uniwork/views/auth/session-notices";
import { useNavigation } from "@uniwork/views/navigation";

/**
 * Where the API sends the browser after a provider sign-in (Google, Apple).
 * The refresh cookie is already set, so the session initializer running at
 * boot resolves the user; this page only waits for it and routes. Anonymous
 * here means the cookie did not arrive (blocked, expired): back to login with
 * the error, and with `next`, so a desktop or invitation sign-in can try again
 * without losing its place.
 *
 * `reclaimed=1` says the sign-in took the account back from whoever had
 * registered the address without proving it (spec §3.1): said once, as a
 * toast that outlives the move to the next screen, and only once the session
 * is real. The flag leaves the address bar at once, so a reload does not say
 * it again.
 */
export default function AuthCallbackPage() {
  const { replace, searchParams } = useNavigation();
  const { status, user } = useSession();
  const resolveDestination = useLoggedInDestination();
  const announce = useSessionNotices();
  const next = sanitizeNextUrl(searchParams.get("next"));
  // Read once: stripping the flag from the URL must not take it back.
  const [reclaimed] = useState(() => searchParams.get("reclaimed") === "1");
  const announced = useRef(false);

  useEffect(() => {
    if (!reclaimed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("reclaimed");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [reclaimed]);

  useEffect(() => {
    if (status === "anon") {
      replace(paths.login({ next, error: "sign_in_failed" }));
      return;
    }
    if (status !== "authed" || !user) return;
    if (reclaimed && !announced.current) {
      announced.current = true;
      announce({ reclaimed: true });
    }
    void (async () => {
      const workspaces = await api.workspaces.list().catch(() => []);
      // A verified, onboarded user goes where they were headed; anyone still
      // owing a gate step goes through it first, carrying `next`.
      replace(await resolveDestination(user, workspaces, next));
    })();
  }, [status, user, next, reclaimed, replace, resolveDestination, announce]);

  return <AuthCallbackView />;
}

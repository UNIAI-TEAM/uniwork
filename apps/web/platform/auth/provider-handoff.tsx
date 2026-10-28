"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { isSignInProvider, type SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useAuthProviders } from "@uniwork/core/auth";
import { AuthCallbackView } from "@uniwork/views/auth/auth-callback-view";
import { providerStartUrl, webSignInProviders } from "@uniwork/views/auth/social-sign-in";

const HINT = "provider";

/**
 * `/login?provider=`: the desktop or phone app's "Continue with Apple" (spec
 * §3.5) rides the system-browser PKCE sign-in, and the browser should go on
 * to that provider instead of asking again. Exactly `google` or `apple`, as
 * the server checks it on /auth/desktop/start; anything else is no hint.
 */
export function providerHint(searchParams: URLSearchParams): SignInProvider | null {
  const value = searchParams.get(HINT);
  return isSignInProvider(value) ? value : null;
}

/**
 * Takes `provider` out of the address bar once, without a navigation, so
 * Back, a reload or a copied link never starts the provider again; the rest
 * of the query (`next`) stays. history.replaceState rather than the router:
 * the router's replace commits later, and by then the page may already be
 * leaving for the provider with the old URL in its history entry.
 */
export function useDropProviderHint(present: boolean): void {
  useEffect(() => {
    if (!present) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(HINT)) return;
    url.searchParams.delete(HINT);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [present]);
}

function replaceLocation(url: string): void {
  window.location.replace(url);
}

/**
 * Hands the browser to the hinted provider's start route, once, when the
 * deployment offers that provider on the web; otherwise (not offered, or the
 * provider list failed) the login form shows as if there had been no hint.
 * location.replace: the login entry gives way to the provider, so Back from
 * the provider's page can never land here and send the browser off again.
 *
 * Until the answer is known, and while the browser is leaving, the screen is
 * the callback's calm "Đang đăng nhập…": the same plane the person will see
 * when the provider sends them back, and never a form they could start
 * typing into a moment before it disappears.
 */
export function ProviderHandoff({
  provider,
  next,
  children,
  leave = replaceLocation,
}: {
  provider: SignInProvider;
  next: string | null;
  /** The login form, shown when the hint cannot be followed. */
  children: ReactNode;
  /** Test seam; the page leaves through location.replace. */
  leave?: (url: string) => void;
}) {
  const providers = useAuthProviders();
  const target = webSignInProviders(providers.data).includes(provider) ? providerStartUrl(provider, { next }) : null;
  const left = useRef(false);
  useEffect(() => {
    if (!target || left.current) return;
    left.current = true;
    leave(target);
  }, [target, leave]);
  if (providers.isPending || target) return <AuthCallbackView />;
  return children;
}

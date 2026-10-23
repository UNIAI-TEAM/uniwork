// The shape of the sign-in callback URL, which both the deep-link router
// (lib/deep-link.ts) and the callback's validation (data/auth/callback.ts)
// recognise. Pure, so the router stays in lib/ without reaching up into data/.

/** The URL up to its query or fragment. */
export function urlBase(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/** `<scheme>://auth/callback[?…]`; the OS may upper-case the scheme, validation compares exactly. */
export function isAuthCallbackUrl(url: unknown, scheme: string): url is string {
  return typeof url === "string" && urlBase(url).toLowerCase() === `${scheme}://auth/callback`;
}

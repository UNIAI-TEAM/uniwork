// The sign-in screens (app/(auth)/) and the two signed-in steps that finish a sign-in (app/(app)/): proving the
// address of a new account, and linking a Google or Apple identity into the account just signed in to ("Tôi đã có
// tài khoản", spec §4.3-4.4, §5.2). Link mode rides in the URL as `link=1` and says only that the person chose to
// link; what is linked stays in memory (data/auth/pending-sign-in.ts).
const withLink = (path: string, link?: boolean) => (link ? `${path}?link=1` : path);

export const signInRoutes = {
  login: (options: { link?: boolean } = {}) => withLink("/login", options.link),
  register: "/register",
  secondFactor: (options: { link?: boolean } = {}) => withLink("/mfa", options.link),
  choice: "/continue",
  linkStep: "/link-sign-in",
  verifyEmail: "/verify-email",
} as const;

/** expo-router's search param for link mode, whatever shape it arrives in. */
export function isLinkMode(param: unknown): boolean {
  return param === "1" || (Array.isArray(param) && param[0] === "1");
}

/** Where a sign-in screen sends the person once signed in: the link step when they asked to link and an identity waits. */
export function afterSignInHref(input: { linkMode: boolean; choiceHeld: boolean }): string {
  return input.linkMode && input.choiceHeld ? signInRoutes.linkStep : "/";
}

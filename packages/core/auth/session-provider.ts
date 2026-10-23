import { setAccessToken } from "../api/session";
import type { SessionProvider } from "../platform/desktop-bridge";

export type { SessionProvider };

let provider: SessionProvider | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * A host that owns the session (the UniChat shell) registers its provider
 * once, synchronously at boot, before `useAuthStore.initialize()` runs.
 * While one is registered, `refreshSession()` and the auth store take tokens
 * from it instead of the refresh cookie; null (web, tests) restores the cookie
 * path untouched. The provider's `onChange` feeds `setAccessToken`, so a token
 * the host drops ends the web session the same way a failed refresh does.
 */
export function registerSessionProvider(p: SessionProvider | null): void {
  unsubscribe?.();
  unsubscribe = null;
  provider = p;
  if (p) unsubscribe = p.onChange(setAccessToken);
}

export function getSessionProvider(): SessionProvider | null {
  return provider;
}

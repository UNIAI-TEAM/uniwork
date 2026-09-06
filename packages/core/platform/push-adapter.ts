import type { PushSubscriptionBody } from "../types/notification";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

/**
 * The browser half of Web Push, injected by the host. packages/core never
 * touches navigator.serviceWorker; apps/web/platform/push.ts registers the
 * worker and implements this, a desktop host would do it its own way.
 */
export interface PushAdapter {
  permission(): PushPermission;
  requestPermission(): Promise<PushPermission>;
  /** The current subscription for this browser, if any. */
  current(): Promise<PushSubscriptionBody | null>;
  /** Subscribe with the server's VAPID public key (base64url). */
  subscribe(publicKey: string): Promise<PushSubscriptionBody>;
  /** Drop the browser subscription; resolves to the endpoint it had, if any. */
  unsubscribe(): Promise<string | null>;
}

let adapter: PushAdapter | null = null;

/** Called once by the host at boot; null unregisters (tests, SSR). */
export function registerPushAdapter(a: PushAdapter | null): void {
  adapter = a;
}

export function getPushAdapter(): PushAdapter | null {
  return adapter;
}

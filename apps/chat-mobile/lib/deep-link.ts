// The two shapes a link into the app takes: the web's chat URL
// (`https://<appUrl>/{org}/{ws}/chat?room=&message=&dm=`, plus `call=` on a
// ringing call's push (server notification.ResourceURL), the same params
// packages/views/chat/use-chat-room-url.ts, use-chat-message-deep-link.ts and
// use-chat-dm-deep-link.ts read) and the custom scheme wrapper
// `<scheme>://open?url=<percent-encoded path>` for builds without verified
// universal links. Expo installs a WHATWG URL on Hermes, so `new URL` is safe.

import { isAuthCallbackUrl } from "@/data/auth/callback";

export interface DeepLink {
  orgSlug: string;
  wsSlug: string;
  roomId?: string;
  messageId?: string;
  dmUserId?: string;
  callId?: string;
}

const CHAT_PATH = /^\/([^/]+)\/([^/]+)\/chat\/?$/;

function tryUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

export function parseDeepLink(url: string, appUrl: string, scheme: string): DeepLink | null {
  let target = tryUrl(url);
  if (!target) return null;
  if (target.protocol === `${scheme.toLowerCase()}:`) {
    if (target.host !== "open") return null;
    const wrapped = target.searchParams.get("url");
    target = wrapped ? tryUrl(wrapped, appUrl) : null;
    if (!target) return null;
  }
  if (target.origin !== tryUrl(appUrl)?.origin) return null;
  const [, orgSlug, wsSlug] = CHAT_PATH.exec(target.pathname) ?? [];
  if (!orgSlug || !wsSlug) return null;
  const link: DeepLink = { orgSlug, wsSlug };
  const roomId = target.searchParams.get("room");
  const messageId = target.searchParams.get("message");
  const dmUserId = target.searchParams.get("dm");
  const callId = target.searchParams.get("call");
  if (roomId) link.roomId = roomId;
  if (messageId) link.messageId = messageId;
  if (dmUserId) link.dmUserId = dmUserId;
  if (callId) link.callId = callId;
  return link;
}

/** The expo-router href for a parsed link. */
export function deepLinkHref(link: DeepLink): string {
  const query = new URLSearchParams();
  if (link.roomId) query.set("room", link.roomId);
  if (link.messageId) query.set("message", link.messageId);
  if (link.dmUserId) query.set("dm", link.dmUserId);
  if (link.callId) query.set("call", link.callId);
  const search = query.toString();
  return `/${link.orgSlug}/${link.wsSlug}/chat${search ? `?${search}` : ""}`;
}

/** For app/+native-intent.ts: the route expo-router opens for an OS URL. A
 *  chat link becomes its href, the PKCE callback lands on the login screen
 *  (the Linking listener in app/_layout completes the sign-in), anything else
 *  is left to expo-router untouched. */
export function systemPathToRoute(url: string, appUrl: string, scheme: string): string {
  if (isAuthCallbackUrl(url, scheme)) return "/login";
  const link = parseDeepLink(url, appUrl, scheme);
  return link ? deepLinkHref(link) : url;
}

// A link that arrives before sign-in waits here; app/index.tsx takes it once
// a user and a workspace exist.
let pending: DeepLink | null = null;

export function setPendingDeepLink(link: DeepLink): void {
  pending = link;
}

export function takePendingDeepLink(): DeepLink | null {
  const link = pending;
  pending = null;
  return link;
}

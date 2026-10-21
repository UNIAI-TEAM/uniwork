// The two shapes a link into the app takes: the web's chat URL
// (`https://<appUrl>/{org}/{ws}/chat?room=&message=&dm=`, plus `call=` on a
// ringing call's push (server notification.ResourceURL), the same params
// packages/views/chat/use-chat-room-url.ts, use-chat-message-deep-link.ts and
// use-chat-dm-deep-link.ts read) and the custom scheme wrapper
// `<scheme>://open?url=<percent-encoded path>` for builds without verified
// universal links. Expo installs a WHATWG URL on Hermes, so `new URL` is safe.
//
// A URL can be fired by anyone: a web page, a message, any app on the phone
// (an implicit VIEW intent). So no link acts on its own: `call=` only shows the
// ringing screen, never answers (the notification's Answer reaches the app
// through its own PendingIntent, modules/unichat-calls › CallLaunchTokens), and
// `dm=` asks before it opens a conversation (components/chat/use-deep-link-target.ts)
// — unless the app itself asked for that DM a moment ago (inAppDmHref: a
// contact's row, a member's Message), which no URL can claim.

import { isAuthCallbackUrl } from "./auth-callback-url";

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

/** What the app does with a URL the OS hands it (app/_layout.tsx): complete the sign-in, keep a chat link until
 *  someone is signed in, or open it — only when asked to navigate (a notification tap), since app/+native-intent.ts
 *  already routes a Linking URL; anything else is ignored. */
export type IncomingUrlAction = { kind: "callback" } | { kind: "keep"; link: DeepLink } | { kind: "open"; href: string } | { kind: "ignore" };

export function incomingUrlAction(url: string, options: { appUrl: string; scheme: string; signedIn: boolean; navigate: boolean }): IncomingUrlAction {
  if (isAuthCallbackUrl(url, options.scheme)) return { kind: "callback" };
  const link = parseDeepLink(url, options.appUrl, options.scheme);
  if (!link) return { kind: "ignore" };
  if (!options.signedIn) return { kind: "keep", link };
  return options.navigate ? { kind: "open", href: deepLinkHref(link) } : { kind: "ignore" };
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

// "Message this person" inside the app (Contacts, room info) goes through the Chat tab's `dm=` too, so the back
// button lands on the inbox; it is the person's own tap, so the tab opens it without the outside link's confirm.
// The vouch is held here in memory, never in the URL: a param could be forged by any link (a custom-scheme URL
// that parseDeepLink does not recognise reaches expo-router untouched). One DM, used once, for a few seconds.
const IN_APP_DM_TTL_MS = 10_000;
let inAppDm: { userId: string; at: number } | null = null;

/** The Chat tab's href for a DM the person asked for in the app, vouched for once. */
export function inAppDmHref(slugs: Pick<DeepLink, "orgSlug" | "wsSlug">, userId: string, now = Date.now()): string {
  inAppDm = { userId, at: now };
  return deepLinkHref({ orgSlug: slugs.orgSlug, wsSlug: slugs.wsSlug, dmUserId: userId });
}

/** Whether the app itself just asked to open this DM; the vouch is spent either way. */
export function takeInAppDm(userId: string, now = Date.now()): boolean {
  const vouched = inAppDm;
  inAppDm = null;
  return vouched !== null && vouched.userId === userId && now - vouched.at <= IN_APP_DM_TTL_MS;
}

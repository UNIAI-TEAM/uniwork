// The shapes a link into the app takes: the web's chat URL
// (`https://<appUrl>/{org}/{ws}/chat?room=&message=&dm=`, plus `call=` on a
// ringing call's push (server notification.ResourceURL), the same params
// packages/views/chat/use-chat-room-url.ts, use-chat-message-deep-link.ts and
// use-chat-dm-deep-link.ts read) and the custom scheme wrapper
// `<scheme>://open?url=<percent-encoded path>` for builds without verified
// universal links; and an invitation's link (`/invite/{token}`, the web's
// paths.invite, which the app claims as a universal link), which opens its
// preview. Expo installs a WHATWG URL on Hermes, so `new URL` is safe.
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

/** The page a URL names on the app's own origin, unwrapping `<scheme>://open?url=`; null for anything else. */
function appTarget(url: string, appUrl: string, scheme: string): URL | null {
  let target = tryUrl(url);
  if (!target) return null;
  if (target.protocol === `${scheme.toLowerCase()}:`) {
    if (target.host !== "open") return null;
    const wrapped = target.searchParams.get("url");
    target = wrapped ? tryUrl(wrapped, appUrl) : null;
    if (!target) return null;
  }
  return target.origin === tryUrl(appUrl)?.origin ? target : null;
}

export function parseDeepLink(url: string, appUrl: string, scheme: string): DeepLink | null {
  const target = appTarget(url, appUrl, scheme);
  if (!target) return null;
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

// `/invite/{token}`: one segment. A meeting's invite link (`/invite/meeting/{id}`) is the web's, not an invitation.
const INVITE_PATH = /^\/invite\/([^/]+)\/?$/;

/** The invitation token an invite link carries, or null when the URL is no invite link of the app's origin. */
export function parseInviteLink(url: string, appUrl: string, scheme: string): string | null {
  const target = appTarget(url, appUrl, scheme);
  const [, raw] = (target && INVITE_PATH.exec(target.pathname)) ?? [];
  if (!raw || raw === "meeting") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The app's route for an invitation: its preview, which shows it and joins nothing by itself. */
export function invitationHref(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** The in-app route of a link from outside the app: a chat, or an invitation's preview; null for any other URL. */
function linkHref(url: string, appUrl: string, scheme: string): string | null {
  const link = parseDeepLink(url, appUrl, scheme);
  if (link) return deepLinkHref(link);
  const token = parseInviteLink(url, appUrl, scheme);
  return token ? invitationHref(token) : null;
}

/** What the app does with a URL the OS hands it (app/_layout.tsx): complete the sign-in, keep a chat or invite link
 *  until someone is signed in (an invitation is often opened before the account exists), or open it — only when
 *  asked to navigate (a notification tap), since app/+native-intent.ts already routes a Linking URL; anything else
 *  is ignored. */
export type IncomingUrlAction = { kind: "callback" } | { kind: "keep"; href: string } | { kind: "open"; href: string } | { kind: "ignore" };

export function incomingUrlAction(url: string, options: { appUrl: string; scheme: string; signedIn: boolean; navigate: boolean }): IncomingUrlAction {
  if (isAuthCallbackUrl(url, options.scheme)) return { kind: "callback" };
  const href = linkHref(url, options.appUrl, options.scheme);
  if (!href) return { kind: "ignore" };
  if (!options.signedIn) return { kind: "keep", href };
  return options.navigate ? { kind: "open", href } : { kind: "ignore" };
}

/** Where a URL from outside the app may land when it is not a chat link: the start screen, which sends a
 *  signed-in person home and anyone else to sign in (app/index.tsx). */
const START_ROUTE = "/";

/** For app/+native-intent.ts: the route expo-router opens for an OS URL. A
 *  chat link becomes its href (a bare path is read on the app's origin), an
 *  invite link its preview (which joins nothing by itself), the PKCE callback
 *  lands on the login screen (the Linking listener in app/_layout completes the
 *  sign-in), and anything else lands on the start screen. An allowlist, not a
 *  pass-through: any app or web page can fire a URL at the phone, and no URL
 *  may open an inner screen it names (account deletion, a room's info, a group
 *  picker preloaded with ?room=) — audit "Security & privacy",
 *  deep-link-catch-all. */
export function systemPathToRoute(url: string, appUrl: string, scheme: string): string {
  const absolute = url.startsWith("/") ? `${appUrl}${url}` : url;
  if (isAuthCallbackUrl(url, scheme)) return "/login";
  return linkHref(absolute, appUrl, scheme) ?? START_ROUTE;
}

// A link that arrives before sign-in waits here, as its in-app route; app/index.tsx takes it once a user whose
// address is proved exists.
let pending: string | null = null;

export function setPendingLink(href: string): void {
  pending = href;
}

export function takePendingLink(): string | null {
  const href = pending;
  pending = null;
  return href;
}

// "Message this person" inside the app (Contacts, room info) goes through the Chat tab's `dm=` too, so the back
// button lands on the inbox; it is the person's own tap, so the tab opens it without the outside link's confirm.
// The vouch is held here in memory, never in the URL: a param could be forged by any link (a chat link names any
// dm= it likes). One DM, used once, for a few seconds.
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

export type OfficeChannel = "dev" | "beta" | "stable";
export type OfficeLaunchOutcome = "hidden" | "launched" | "not-installed" | "expired" | "error";
export interface OfficeLaunchSessionLike {
  launch_ticket: string;
  launch_url?: string;
}

/**
 * The public deployment profile every web -> app link carries, so the app
 * learns (or follows a moved) server from the link itself: no secret, only
 * which deployment, at which origin, on which channel. The client id follows
 * from the channel.
 */
export interface OfficeLinkProfile {
  deploymentId: string;
  apiOrigin: string;
}

export function officeScheme(channel: OfficeChannel): "uniwork-office-dev" | "uniwork-office" {
  return channel === "dev" ? "uniwork-office-dev" : "uniwork-office";
}

export function officeClientId(channel: OfficeChannel): "uniwork-office-dev" | "uniwork-office" {
  return officeScheme(channel);
}

const commentIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The `?comment=` of the page, as the launch ticket's optional `comment_id`:
 * only an id-shaped value rides, anything else is left off (the app then
 * opens the document alone, as for any comment the server does not know).
 */
export function launchCommentId(raw: string | null | undefined): string | undefined {
  return raw && commentIdPattern.test(raw) ? raw : undefined;
}

const ticketPattern = /^ticket_[A-Za-z0-9_-]{32,185}$/;
const deploymentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

/** The same origin rule the app applies: HTTPS, or loopback HTTP on dev; a bare origin only. */
function linkOrigin(raw: string, channel: OfficeChannel): string | null {
  try {
    const url = new URL(raw);
    const allowed = url.protocol === "https:" || (channel === "dev" && url.protocol === "http:" && loopbackHosts.includes(url.hostname));
    if (!allowed || url.username || url.password || url.search || url.hash || url.pathname !== "/" || raw.includes("\\")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The profile as link parameters, all four or none. A profile the app would
 * refuse is left off rather than sent: the app then keeps the server it has.
 */
function profileParams(profile: OfficeLinkProfile | undefined, channel: OfficeChannel): [string, string][] {
  if (!profile || !deploymentPattern.test(profile.deploymentId)) return [];
  const apiOrigin = linkOrigin(profile.apiOrigin, channel);
  if (!apiOrigin) return [];
  return [["deploymentId", profile.deploymentId], ["apiOrigin", apiOrigin], ["clientId", officeClientId(channel)], ["channel", channel]];
}

function query(params: [string, string][]): string {
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

export function buildOfficeDeepLink(ticket: string, channel: OfficeChannel = "stable", profile?: OfficeLinkProfile): string {
  if (!ticketPattern.test(ticket)) throw new TypeError("invalid office launch ticket");
  return `${officeScheme(channel)}://open?${query([["ticket", ticket], ...profileParams(profile, channel)])}`;
}

/** Always rebuilt from the ticket: a server-sent URL never decides the scheme, host or extra parameters. */
export function safeOfficeDeepLink(session: OfficeLaunchSessionLike, channel: OfficeChannel, profile?: OfficeLinkProfile): string {
  return buildOfficeDeepLink(session.launch_ticket, channel, profile);
}

/** The app's home route: opens (or brings forward) the installed app on its
 * home screen. It carries no ticket and names no document, only the public
 * deployment profile, so a first-run app learns its server from this click. */
export function buildOfficeHomeLink(channel: OfficeChannel = "stable", profile?: OfficeLinkProfile): string {
  const params = profileParams(profile, channel);
  return `${officeScheme(channel)}://home${params.length > 0 ? `?${query(params)}` : ""}`;
}

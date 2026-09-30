export type OfficeChannel = "dev" | "beta" | "stable";
export type OfficeLaunchOutcome = "hidden" | "launched" | "not-installed" | "expired" | "error";
export interface OfficeLaunchSessionLike {
  launch_ticket: string;
  launch_url?: string;
}

export function officeScheme(channel: OfficeChannel): "uniwork-office-dev" | "uniwork-office" {
  return channel === "dev" ? "uniwork-office-dev" : "uniwork-office";
}

export function officeClientId(channel: OfficeChannel): "uniwork-office-dev" | "uniwork-office" {
  return officeScheme(channel);
}

const ticketPattern = /^ticket_[A-Za-z0-9_-]{32,185}$/;

export function buildOfficeDeepLink(ticket: string, channel: OfficeChannel = "stable"): string {
  if (!ticketPattern.test(ticket)) throw new TypeError("invalid office launch ticket");
  return `${officeScheme(channel)}://open?ticket=${encodeURIComponent(ticket)}`;
}

export function safeOfficeDeepLink(session: OfficeLaunchSessionLike, channel: OfficeChannel): string {
  const expected = buildOfficeDeepLink(session.launch_ticket, channel);
  return session.launch_url === expected ? session.launch_url : expected;
}

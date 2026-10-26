import { paths } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";

/** The guest link people open: the secret rides in the fragment, so it never reaches a server log. */
export function inviteLinkUrl(linkId: string, secret: string): string {
  return `${runtimeConfig().appUrl}${paths.meetingInvite(linkId)}#secret=${secret}`;
}

/** The `expires_at` of a link that lasts `days` from `nowMs`. */
export function expiresAtFromDays(days: number, nowMs: number): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
}

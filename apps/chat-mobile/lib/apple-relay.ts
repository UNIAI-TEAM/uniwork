// Apple's Hide My Email (ADR 0041) gives each app its own forwarding address at one domain. An account made that way
// has that address, not the person's own, and an invitation sent to their work email names another account
// (server/internal/service/invitation_accept.go › sameMailbox), so the empty workspace list says why.

const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com";

/** `email` is a Hide My Email forwarding address: the relay domain itself, not a subdomain or a mention of it. */
export function isAppleRelayAddress(email: string): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  return at > 0 && address.slice(at + 1) === APPLE_RELAY_DOMAIN;
}

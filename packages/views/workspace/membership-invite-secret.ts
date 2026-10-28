/** Persist the membership invite secret across login (hash is lost on some OAuth returns). */
export function membershipInviteSecretKey(linkId: string): string {
  return `uw.membership-invite.${linkId}.secret`;
}

export function readMembershipInviteSecret(linkId: string): string {
  if (typeof window === "undefined") return "";
  const fromHash = secretFromHash();
  if (fromHash) {
    try {
      sessionStorage.setItem(membershipInviteSecretKey(linkId), fromHash);
    } catch {
      /* private mode */
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(membershipInviteSecretKey(linkId)) ?? "";
  } catch {
    return "";
  }
}

function secretFromHash(): string {
  if (typeof window === "undefined") return "";
  // Reads the fragment only, never navigates; the navigation adapter does not
  // expose the hash, and the secret stays there so it never reaches a server.
  // eslint-disable-next-line no-restricted-syntax
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return "";
  const params = new URLSearchParams(raw.includes("=") ? raw : `secret=${raw}`);
  return params.get("secret") ?? "";
}

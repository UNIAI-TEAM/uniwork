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
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return "";
  const params = new URLSearchParams(raw.includes("=") ? raw : `secret=${raw}`);
  return params.get("secret") ?? "";
}

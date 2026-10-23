// An owner whose organization has other members hands it over from the phone before the account is erased (Apple
// 5.1.1(v): deletion completes in the app), as the web's Settings › Organization does with POST
// /api/v1/orgs/{org}/transfer-ownership (server OrganizationMemberService.TransferOwnership). Pure: who may take
// over, and what a refused hand-over means; the sheet is components/settings/delete-account.tsx.
import { pathOf } from "./unknown-shape";
import { userKey } from "./user-id";

/** One active member of the organization, as GET /api/v1/orgs/{org}/members?status=active answers it. */
export interface OrgMemberRow {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  deactivated_at?: string | null;
}

export interface TransferCandidate {
  userId: string;
  name: string;
  email: string;
  admin: boolean;
}

/** Everyone but the owner who may take over, admins first; the server's order (by name) otherwise. */
export function transferCandidates(members: readonly OrgMemberRow[], selfId: string): TransferCandidate[] {
  const rows = members
    .filter((m) => !m.deactivated_at && userKey(m.user_id) !== userKey(selfId))
    .map((m) => ({ userId: m.user_id, name: m.display_name || m.email, email: m.email, admin: m.role === "admin" }));
  return [...rows.filter((r) => r.admin), ...rows.filter((r) => !r.admin)];
}

export type TransferOwnershipFailure = "proof_refused" | "password_required" | "member_gone" | "rate_limited" | "offline" | "failed";

/** The server codes transferOwnershipFailure turns into words: answers, not contract drift (data/report.ts). */
export const TRANSFER_OWNERSHIP_HANDLED_CODES = [
  "password_incorrect",
  "invalid_credentials",
  "password_required",
  "member_deactivated",
  "not_found",
] as const;

export function transferOwnershipFailure(err: unknown): TransferOwnershipFailure {
  switch (pathOf(err, "body", "error", "code")) {
    case "password_incorrect":
    case "invalid_credentials":
      return "proof_refused";
    // An account with no password (Google sign-in) cannot hand over: the server asks for one first.
    case "password_required":
      return "password_required";
    case "member_deactivated":
    case "not_found":
      return "member_gone";
  }
  const status = pathOf(err, "status");
  if (status === 429) return "rate_limited";
  if (status === 0) return "offline";
  return "failed";
}

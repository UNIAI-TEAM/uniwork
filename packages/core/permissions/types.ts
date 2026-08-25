import type { OrgRole } from "../types/organization";
import type { MemberRole } from "../types/workspace";

/**
 * Inputs to every permission rule. UniWork has two membership tiers —
 * organization and workspace — so a rule may consult either or both.
 *
 * `userId === null` models the logged-out edge case; a null role models
 * "not a member" / "membership still loading". Every rule must deny
 * gracefully on those rather than throw.
 */
export interface PermissionContext {
  userId: string | null;
  orgRole: OrgRole | null;
  wsRole: MemberRole | null;
}

/**
 * Stable enum of WHY a permission was denied (or allowed). Lets every surface
 * — disabled state, tooltip, banner — branch on `reason` without parsing the
 * human message. Tests assert on `reason`.
 */
export type DecisionReason =
  | "allowed"
  | "not_authenticated"
  | "not_member"
  | "not_org_member"
  | "not_admin_role"
  | "not_owner_role"
  | "not_resource_owner"
  | "unknown";

export interface Decision {
  allowed: boolean;
  reason: DecisionReason;
  /**
   * Copy for tooltips / banners, centralised so views do not drift. Views may
   * wrap it for emphasis but should not invent their own. Keys into i18n are
   * resolved by the view; this carries the fallback English.
   */
  message: string;
}

export const ALLOW: Decision = { allowed: true, reason: "allowed", message: "" };

export function deny(reason: DecisionReason, message: string): Decision {
  return { allowed: false, reason, message };
}

export const isAdminLike = (role: MemberRole | OrgRole | null): boolean =>
  role === "owner" || role === "admin";

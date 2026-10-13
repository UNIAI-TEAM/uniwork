import type { useTranslation } from "react-i18next";
import type { MembershipConflict, SwitchResolution } from "@uniwork/core/types";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** What the person has filled in for one organization they are giving up. */
export type SwitchDraft = {
  leaveConfirmed: boolean;
  toUserId: string;
  toUserName: string;
  password: string;
  slug: string;
};

export const EMPTY_DRAFT: SwitchDraft = { leaveConfirmed: false, toUserId: "", toUserName: "", password: "", slug: "" };

/**
 * Whether one organization's block is complete. A blocked conflict, or an
 * action this client does not know, never is: the server would refuse the
 * resolve, so the wizard cannot go on (spec 2026-10-13 §6.1).
 */
export function draftReady(conflict: MembershipConflict, draft: SwitchDraft): boolean {
  switch (conflict.required_action) {
    case "leave":
      return draft.leaveConfirmed;
    case "transfer":
      return draft.toUserId !== "" && draft.password !== "";
    case "close":
      // Compared exactly, as the server compares confirm_slug.
      return draft.slug.trim() === conflict.organization.slug;
    default:
      return false;
  }
}

/** The resolve entry the accept sends for one organization; null when it cannot be resolved here. */
export function toResolution(conflict: MembershipConflict, draft: SwitchDraft): SwitchResolution | null {
  const organization_id = conflict.organization.id;
  switch (conflict.required_action) {
    case "leave":
      return { organization_id, action: "leave" };
    case "transfer":
      return { organization_id, action: "transfer", transfer_to_user_id: draft.toUserId, password: draft.password };
    case "close":
      return { organization_id, action: "close", confirm_slug: draft.slug.trim() };
    default:
      return null;
  }
}

/** The label for an organization role; an unknown role shows as it came. */
export function roleLabel(t: TFunction, role: string): string {
  switch (role) {
    case "owner":
    case "admin":
    case "member":
      return t(`people.role_${role}`);
    default:
      return role;
  }
}

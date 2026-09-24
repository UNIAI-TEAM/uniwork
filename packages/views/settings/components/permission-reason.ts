import type { useTranslation } from "react-i18next";
import type { Decision } from "@uniwork/core/permissions";

type TFunction = ReturnType<typeof useTranslation>["t"];

/**
 * The sentence a view shows beside a refused action. Decisions carry a stable
 * `reason` code and a fallback English `message`; the message is never shown,
 * because it would leak English into a Vietnamese screen. `action` picks a
 * more specific sentence where one reason means different things (the owner
 * cannot leave vs. the owner's role cannot change).
 *
 * Returns null while permissions are still loading (`unknown`) and when the
 * action is allowed, so the caller renders nothing that would flicker.
 */
export function decisionReason(t: TFunction, decision: Decision, action?: "leave"): string | null {
  if (decision.allowed || decision.reason === "unknown" || decision.reason === "allowed") return null;
  if (action === "leave" && decision.reason === "last_owner") return t("org.reasons.leave_last_owner");
  switch (decision.reason) {
    case "last_owner":
      return t("org.reasons.last_owner");
    case "member_deactivated":
      return t("org.reasons.member_deactivated");
    case "not_org_member":
      return t("org.reasons.not_org_member");
    case "not_member":
      return t("org.reasons.not_member");
    case "not_authenticated":
      return t("org.reasons.not_authenticated");
    case "not_admin_role":
      return t("org.reasons.not_admin_role");
    case "not_owner_role":
      return t("org.reasons.not_owner_role");
    case "not_resource_owner":
      return t("org.reasons.not_resource_owner");
    default:
      return t("org.reasons.fallback");
  }
}

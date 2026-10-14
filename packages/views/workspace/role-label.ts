import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

/**
 * The label for an organization role; an unknown role shows as it came.
 * Shared by the invite page and every list of pending invitations, so a row
 * and the page it opens name the same role the same way.
 */
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

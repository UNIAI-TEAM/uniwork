// An owner erasing their account from the phone (Apple 5.1.1(v): deletion completes in the app). The server refuses
// with owner_must_transfer and names the organization (server account_deletion.go › errOwnerMustTransferFor); the
// only active member closes it in the same erasure by typing its address again (close_organization), and anyone
// else hands it over first (lib/owner-transfer.ts). The web's dialog has neither step: an owner there transfers the
// organization in its own settings, so this module is the phone's alone. Pure; the sheet is
// components/settings/delete-account.tsx with its owner step in use-owner-step.ts.
import { pathOf } from "./unknown-shape";

/** The organization owner_must_transfer names. */
export interface OwnedOrganization {
  name: string;
  slug: string;
  /** The account is its only active member: closing it and erasing the account is one request. */
  canClose: boolean;
}

/** The body field that closes the organization with the erasure: its slug, typed again. */
export interface CloseOrganizationBody {
  close_organization?: string;
}

const fieldOf = (err: unknown, name: string): unknown => pathOf(err, "body", "error", "fields", name);

/** The owned organization a refusal names, or null when it names none (an older server, a drifted body). */
export function ownedOrganization(err: unknown): OwnedOrganization | null {
  if (pathOf(err, "body", "error", "code") !== "owner_must_transfer") return null;
  const name = fieldOf(err, "organization_name");
  const slug = fieldOf(err, "organization_slug");
  if (typeof slug !== "string" || slug === "") return null;
  return { name: typeof name === "string" && name !== "" ? name : slug, slug, canClose: fieldOf(err, "can_close") === true };
}

/** What the person typed names the organization: the slug, ignoring case and the spaces a keyboard adds. */
export function closeConfirmed(typed: string, organization: OwnedOrganization): boolean {
  return typed.trim().toLowerCase() === organization.slug.toLowerCase();
}

/** The field that asks the server to close the organization being closed, trimmed; nothing when none is. */
export function closeOrganizationBody(slug: string | undefined): CloseOrganizationBody {
  return slug?.trim() ? { close_organization: slug.trim() } : {};
}

/** Why closing with the erasure failed: the slug did not match (400), or someone joined meanwhile (409). */
export type CloseFailure = "close_mismatch" | "organization_has_members";

/** The server codes closeFailure turns into words: answers, not contract drift (data/report.ts). */
export const CLOSE_ORGANIZATION_HANDLED_CODES = ["close_confirm_mismatch", "organization_has_members"] as const;

export function closeFailure(err: unknown): CloseFailure | null {
  switch (pathOf(err, "body", "error", "code")) {
    case "close_confirm_mismatch":
      return "close_mismatch";
    case "organization_has_members":
      return "organization_has_members";
    default:
      return null;
  }
}

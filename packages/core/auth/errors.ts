import { errorCode, errorFields } from "../api/http";

/** The organization a deletion was refused for (409 owner_must_transfer). */
export interface OwnedOrganization {
  /** Its name; the slug when the refusal names none, "" when it names neither. */
  name: string;
  /** Its slug, typed back as `close_organization`; "" when the refusal names none. */
  slug: string;
  /** The account is its only active member and it is active: it closes with the erasure. */
  canClose: boolean;
}

/**
 * The organization standing between the account and its erasure, when
 * POST /me/delete was refused with 409 owner_must_transfer; null for any
 * other failure. The server weighs the proof first, then names the
 * organization the account owns (account_deletion.go,
 * errOwnerMustTransferFor): its only member closes it in the same request,
 * anyone else hands it over first. A refusal whose fields do not name it
 * (an older server, drift) still reads as one, with nothing to close.
 */
export function ownedOrganization(err: unknown): OwnedOrganization | null {
  if (errorCode(err) !== "owner_must_transfer") return null;
  const fields = errorFields(err) ?? {};
  const slug = typeof fields.organization_slug === "string" ? fields.organization_slug.trim() : "";
  const named = typeof fields.organization_name === "string" ? fields.organization_name.trim() : "";
  return { name: named || slug, slug, canClose: slug !== "" && fields.can_close === true };
}

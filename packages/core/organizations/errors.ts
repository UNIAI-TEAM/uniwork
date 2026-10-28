import { z } from "zod";
import { errorCode, errorFields } from "../api/http";
import { MembershipConflictSchema, type MembershipConflict } from "../types/workspace";

// The details the one-organization rule (ADR 0032) attaches to its 409s,
// read from ApiError.fields (ErrorSDO.fields on the wire). Lenient like every
// response schema: an action this client does not know still parses, and the
// caller's switch carries a default.

const OrganizationRefSchema = z.object({ id: z.string(), name: z.string(), slug: z.string() });

/**
 * The organization the caller already belongs to, when creating another one
 * was refused with 409 already_in_organization; null for any other failure.
 */
export function alreadyInOrganization(err: unknown): z.infer<typeof OrganizationRefSchema> | null {
  if (errorCode(err) !== "already_in_organization") return null;
  const parsed = OrganizationRefSchema.safeParse(errorFields(err)?.organization);
  return parsed.success ? parsed.data : null;
}

/**
 * The organizations standing between the caller and an invitation, when
 * accepting it was refused with 409 organization_switch_required; null for
 * any other failure or details that do not parse.
 */
export function organizationSwitchConflicts(err: unknown): MembershipConflict[] | null {
  if (errorCode(err) !== "organization_switch_required") return null;
  const parsed = z.array(MembershipConflictSchema).safeParse(errorFields(err)?.conflicts);
  return parsed.success ? parsed.data : null;
}

/**
 * Why the server refused the proof an owner gave to hand an organization
 * over (Settings › Organization, or the invitation switch), null for any
 * other failure:
 * - "incorrect": the re-entered password did not match. 403
 *   password_incorrect is the code; 401 invalid_credentials is still read
 *   the same so a client running against an older server says the same.
 * - "step_up": no proof the account takes came with the request, or the
 *   held step-up token no longer serves (403 proof_required, which replaced
 *   password_required in ADR 0047 §5: an owner without a password proves
 *   itself with a mailed code). The screen confirms it is the owner
 *   (useStepUp with action transfer_ownership, on the proofs
 *   readSignInFailure(err, "methods").proofs names) and sends again;
 *   useTransferOwnership and the invitation hooks send the held token.
 */
export type PasswordRefusal = "incorrect" | "step_up";

export function passwordRefusal(err: unknown): PasswordRefusal | null {
  const code = errorCode(err);
  if (code === "password_incorrect" || code === "invalid_credentials") return "incorrect";
  if (code === "proof_required") return "step_up";
  return null;
}

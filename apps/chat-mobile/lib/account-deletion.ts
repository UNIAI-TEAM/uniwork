// Erasing the account from the phone (Apple 5.1.1(v), Google Play's account
// deletion policy), ported from packages/views/settings/components/
// delete-account-dialog.tsx and packages/core/auth/errors.ts ›
// deleteAccountProofRefused. Pure: the sheet (components/settings/
// delete-account-sheet.tsx) asks which proof to collect and what a failure
// means; the request is data/account-api.ts.
import type { User } from "@uniwork/core/types/user";
import { pathOf } from "./unknown-shape";

/** The one proof the server reads (spec F-01 §2 I9): the password, else a two-factor code, else the typed email. */
export type DeleteProofMode = "password" | "code" | "email";

export interface DeleteAccountBody {
  password?: string;
  code?: string;
  email_confirmation?: string;
  /** The slug of the organization the account owns alone, typed again: it is closed with the erasure. */
  close_organization?: string;
}

export function deleteProofMode(user: Pick<User, "has_password" | "mfa_enabled_at"> | null | undefined): DeleteProofMode {
  if (user?.has_password) return "password";
  if (user?.mfa_enabled_at) return "code";
  return "email";
}

/**
 * A password is sent as typed; a code and an address lose the spaces a keyboard adds. A typed organization slug
 * (closeOrganization) asks the server to close that organization with the erasure.
 */
export function deleteProofBody(mode: DeleteProofMode, proof: string, closeOrganization?: string): DeleteAccountBody {
  const close = closeOrganization?.trim() ? { close_organization: closeOrganization.trim() } : {};
  if (mode === "password") return { password: proof, ...close };
  if (mode === "code") return { code: proof.trim(), ...close };
  return { email_confirmation: proof.trim(), ...close };
}

/** What a failed erasure tells the person; anything unrecognised is "failed" (try again later). */
export type DeleteAccountFailure =
  | "proof_refused"
  | "owner_must_transfer"
  | "close_mismatch"
  | "organization_has_members"
  | "rate_limited"
  | "offline"
  | "failed";

/** The organization owner_must_transfer names (server account_deletion.go › errOwnerMustTransferFor). */
export interface OwnedOrganization {
  name: string;
  slug: string;
  /** The account is its only active member: closing it and erasing the account is one request. */
  canClose: boolean;
}

/** The owned organization a refusal names, or null when it names none (an older server, a drifted body). */
export function ownedOrganization(err: unknown): OwnedOrganization | null {
  if (errorCode(err) !== "owner_must_transfer") return null;
  const name = pathOf(err, "body", "error", "fields", "organization_name");
  const slug = pathOf(err, "body", "error", "fields", "organization_slug");
  if (typeof slug !== "string" || slug === "") return null;
  const canClose = pathOf(err, "body", "error", "fields", "can_close") === true;
  return { name: typeof name === "string" && name !== "" ? name : slug, slug, canClose };
}

/** What the person typed names the organization: the slug, ignoring case and the spaces a keyboard adds. */
export function closeConfirmed(typed: string, organization: OwnedOrganization): boolean {
  return typed.trim().toLowerCase() === organization.slug.toLowerCase();
}

function errorCode(err: unknown): unknown {
  return pathOf(err, "body", "error", "code");
}

function errorStatus(err: unknown): unknown {
  return pathOf(err, "status");
}

/** The server codes deleteAccountFailure turns into words: answers, not contract drift (data/report.ts). */
export const DELETE_ACCOUNT_HANDLED_CODES = [
  "password_incorrect",
  "mfa_code_incorrect",
  "email_confirmation_mismatch",
  "invalid_credentials",
  "owner_must_transfer",
  "close_confirm_mismatch",
  "organization_has_members",
] as const;

export function deleteAccountFailure(err: unknown): DeleteAccountFailure {
  switch (errorCode(err)) {
    // A wrong password (403), two-factor code (403) or typed address (400);
    // invalid_credentials is what an older server says for the same.
    case "password_incorrect":
    case "mfa_code_incorrect":
    case "email_confirmation_mismatch":
    case "invalid_credentials":
      return "proof_refused";
    // 409: the account still owns an organization (account_deletion.go).
    case "owner_must_transfer":
      return "owner_must_transfer";
    // Closing the organization with the erasure: the slug did not match (400), or someone joined it meanwhile (409).
    case "close_confirm_mismatch":
      return "close_mismatch";
    case "organization_has_members":
      return "organization_has_members";
  }
  // The route sits behind the credential rate limit; 0 is no answer at all (data/api.ts).
  if (errorStatus(err) === 429) return "rate_limited";
  if (errorStatus(err) === 0) return "offline";
  return "failed";
}

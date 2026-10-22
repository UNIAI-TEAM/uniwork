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
}

export function deleteProofMode(user: Pick<User, "has_password" | "mfa_enabled_at"> | null | undefined): DeleteProofMode {
  if (user?.has_password) return "password";
  if (user?.mfa_enabled_at) return "code";
  return "email";
}

/** A password is sent as typed; a code and an address lose the spaces a keyboard adds. */
export function deleteProofBody(mode: DeleteProofMode, proof: string): DeleteAccountBody {
  if (mode === "password") return { password: proof };
  if (mode === "code") return { code: proof.trim() };
  return { email_confirmation: proof.trim() };
}

/** What a failed erasure tells the person; anything unrecognised is "failed" (try again later). */
export type DeleteAccountFailure = "proof_refused" | "owner_must_transfer" | "rate_limited" | "offline" | "failed";

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
  }
  // The route sits behind the credential rate limit; 0 is no answer at all (data/api.ts).
  if (errorStatus(err) === 429) return "rate_limited";
  if (errorStatus(err) === 0) return "offline";
  return "failed";
}

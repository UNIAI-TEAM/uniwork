// Erasing the account from the phone (Apple 5.1.1(v), Google Play's account
// deletion policy), as packages/views/settings/components/
// delete-account-dialog.tsx does: the person confirms it is them first (a
// step-up token for delete_account, ADR 0047 §5; the proof sheet is
// components/settings/step-up-sheet.tsx), then POST /api/v1/me/delete. Pure:
// what a failure means; the sheet is components/settings/delete-account.tsx and
// the request data/account-api.ts. What an owner does on the phone alone (close
// the organization, hand it over) is lib/owned-organization.ts.
import { pathOf } from "./unknown-shape";

/** The erasure's proof: the token the proof sheet bought for delete_account. */
export interface DeleteAccountBody {
  step_up_token: string;
}

/** What a failed erasure tells the person; anything unrecognised is "failed" (try again later). */
export type DeleteAccountFailure = "owner_must_transfer" | "rate_limited" | "offline" | "failed";

/**
 * The server codes the sheet answers itself: answers, not contract drift (data/report.ts). proof_required is the
 * proof sheet's: the token ran out, and it asks again (components/settings/use-step-up.ts).
 */
export const DELETE_ACCOUNT_HANDLED_CODES = ["owner_must_transfer", "proof_required"] as const;

export function deleteAccountFailure(err: unknown): DeleteAccountFailure {
  // 409: the account still owns an organization (account_deletion.go).
  if (pathOf(err, "body", "error", "code") === "owner_must_transfer") return "owner_must_transfer";
  // The route sits behind the step-up budget; 0 is no answer at all (data/api.ts).
  const status = pathOf(err, "status");
  if (status === 429) return "rate_limited";
  if (status === 0) return "offline";
  return "failed";
}

/**
 * Where a refusal about no one field is said, in words (the i18n key): the rate limit, no connection, a proof the
 * server kept refusing (proof_required), or anything else. The owner's step words its own refusals with it too.
 */
export function deleteFailureKey(failure: string): string {
  switch (failure) {
    case "rate_limited":
      return "mobile.account.rate_limited";
    case "offline":
      return "mobile.account.offline";
    case "proof_required":
      return "settings.security.stepUp.errors.proofRequired";
    default:
      return "settings.security.delete.failed";
  }
}

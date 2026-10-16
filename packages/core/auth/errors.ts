import { errorCode } from "../api/http";

/**
 * Whether the server refused the proof typed to delete the account (spec F-01
 * §2 I9): a wrong password (403 password_incorrect), a wrong two-factor code
 * (403 mfa_code_incorrect) or a typed address that does not match (400
 * email_confirmation_mismatch). None of them is 401, so the transport never
 * refreshes and replays the request. 401 invalid_credentials is still read as
 * a refusal so a client running against an older server says the same.
 */
export function deleteAccountProofRefused(err: unknown): boolean {
  switch (errorCode(err)) {
    case "password_incorrect":
    case "mfa_code_incorrect":
    case "email_confirmation_mismatch":
    case "invalid_credentials":
      return true;
    default:
      return false;
  }
}

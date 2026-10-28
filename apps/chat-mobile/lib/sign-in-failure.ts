// What the sign-in screen says when a sign-in failed. The browser's only failure is opening the browser; Sign in with
// Apple (ADR 0041, 0047) can also be refused by the server. Until the second-factor and choice screens land (spec
// §5.2), the steps this screen cannot finish read as the shipped app said them: the browser is the way forward.
import { pathOf } from "./unknown-shape";

type SignInMethod = "browser" | "apple";

/** the copy key of the line under the buttons */
export function signInFailureKey(method: SignInMethod, error: unknown): string {
  if (method === "browser") return "auth.desktop.unichat_login_failed";
  return pathOf(error, "code") === "sign_in_account_conflict" ? "chat.mobile.login_apple_conflict" : "chat.mobile.login_apple_failed";
}

/** A sign-in that stopped at a step this screen has no screen for yet: the line that sends the person to the browser. */
export function unfinishedStepKey(outcome: { kind: string }): string | null {
  switch (outcome.kind) {
    case "second_factor":
      return "chat.mobile.login_apple_mfa";
    case "choice":
      return "chat.mobile.login_apple_conflict";
    default:
      return null;
  }
}

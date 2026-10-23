// What the sign-in screen says when a sign-in failed. The browser's only failure is opening the browser; Sign in with
// Apple (ADR 0041) can also be refused by the server, two of them with a way forward the person should read.
import { pathOf } from "./unknown-shape";

type SignInMethod = "browser" | "apple";

/** the copy key of the line under the buttons */
export function signInFailureKey(method: SignInMethod, error: unknown): string {
  if (method === "browser") return "auth.desktop.unichat_login_failed";
  switch (pathOf(error, "code")) {
    case "apple_account_conflict":
      return "chat.mobile.login_apple_conflict";
    case "mfa_required":
      return "chat.mobile.login_apple_mfa";
    default:
      return "chat.mobile.login_apple_failed";
  }
}

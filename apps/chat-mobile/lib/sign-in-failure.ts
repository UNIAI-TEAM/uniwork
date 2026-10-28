// What a sign-in screen says when a step failed (ADR 0047, spec §5.2). Every refusal of the server reads through
// core's one table (auth/sign-in-errors.ts › readSignInFailure), so the phone and the web say the same thing; this
// module only adds what happens on the phone before the server answers: Apple's or Google's own sheet failing, the
// system browser not opening, and the step the app held in memory being gone (sign_in_expired).
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { readSignInFailure, type SignInContext, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import type { SignInRequest } from "@/data/auth/sign-in";
import { pathOf } from "./unknown-shape";

/** How the sign-in that failed was started: a provider's sheet and the browser fail on the phone, before any server. */
export type SignInStart = "browser" | SignInProvider | "form";

/** What a request opens on the phone before any server: a provider's sheet, the browser, or nothing (a form). */
export function startOf(request: SignInRequest): SignInStart {
  return request.method === "browser" || request.method === "apple" || request.method === "google" ? request.method : "form";
}

function failure(key: string, kind: SignInFailure["kind"], code: string): SignInFailure {
  return { code, status: null, kind, key, values: {}, retryAfterSeconds: null, retry: null, proofs: null, maskedEmail: null };
}

/** The app's auth transport and bearer client answer with these; anything else came from the phone itself. */
const fromTransport = (error: unknown): boolean => {
  const name = pathOf(error, "name");
  return name === "TransportError" || name === "ApiError";
};

/**
 * The sentence for a failed step. `start` names what the person tapped: a sheet that threw (Apple's or Google's
 * own error, never the server's) says that provider did not work; a browser that would not open says so.
 */
export function signInFailureOf(error: unknown, context: SignInContext, start: SignInStart = "form"): SignInFailure {
  // The second step or the choice the app held is gone (expired, or the app restarted): sign in again.
  if (pathOf(error, "code") === "sign_in_expired") return failure("auth.continue.errors.expired", "restart", "sign_in_expired");
  if (!fromTransport(error) && !(error instanceof TypeError)) {
    if (start === "apple" || start === "google") return failure(`auth.social.errors.${start}_failed`, "form", "provider_sheet");
    if (start === "browser") return failure("auth.desktop.unichat_login_failed", "form", "browser");
  }
  return readSignInFailure(error, context);
}

/**
 * Email verification (POST /me/email/verify, /me/email/resend) in the web's own words (auth.verify): a wrong code, a
 * code asked again within the minute (its button counts the minute down itself); the rest as any step that failed.
 */
export function verifyEmailFailureOf(error: unknown): SignInFailure {
  const read = readSignInFailure(error, "claim");
  if (read.code === "invalid_code") return { ...read, key: "auth.verify.invalidCode" };
  if (read.code === "rate_limited") return { ...read, kind: "form", key: "auth.verify.resendTooSoon", retry: null };
  return read;
}

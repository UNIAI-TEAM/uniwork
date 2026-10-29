// Google's chooser or Apple's sheet failing on the phone (data/auth/google.ts, apple.ts), told apart from the server's
// refusals and from the app's own bugs. What the person's phone or network does (offline, no Google account on the
// device, not signed in to iCloud) is an answer the screen says in words and crash reporting never hears
// (data/report.ts › classifyError); a fault of this build (no client id, nothing to present the sheet on, an answer
// with no token, Android's DEVELOPER_ERROR for a client id or signing key Google does not know) is a bug.
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { pathOf } from "./unknown-shape";

export class ProviderSheetError extends Error {
  override readonly name = "ProviderSheetError";

  constructor(
    readonly provider: SignInProvider,
    /** the native module's code: ERR_GOOGLE_SIGN_IN, ERR_REQUEST_FAILED… */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Codes that say this build, not the phone, is wrong: the module's own, and an Apple answer the app cannot read. */
const BUILD_FAULTS: ReadonlySet<string> = new Set([
  "ERR_GOOGLE_NOT_CONFIGURED",
  "ERR_GOOGLE_NO_PRESENTER",
  "ERR_GOOGLE_NO_TOKEN",
  "ERR_APPLE_NO_TOKEN",
  "ERR_REQUEST_INVALID_RESPONSE",
]);

/** Google Play services' DEVELOPER_ERROR (status 10, Credential Manager's 28444): the console does not know this app. */
const DEVELOPER_ERROR = /\b(?:28444|DEVELOPER_ERROR)\b|developer console/i;

export function isBuildFault(error: ProviderSheetError): boolean {
  return BUILD_FAULTS.has(error.code) || DEVELOPER_ERROR.test(error.message);
}

/** A native rejection as the app holds it: its code and message, whatever shape it came in. */
export function providerSheetError(provider: SignInProvider, error: unknown): ProviderSheetError {
  const code = pathOf(error, "code");
  const message = pathOf(error, "message");
  return new ProviderSheetError(provider, typeof code === "string" ? code : "ERR_UNKNOWN", typeof message === "string" ? message : "");
}

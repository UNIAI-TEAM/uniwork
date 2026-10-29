import { describe, expect, it } from "vitest";
import { ProviderSheetError, isBuildFault, providerSheetError } from "./provider-sheet-error";

describe("a provider's sheet failing on the phone", () => {
  it("keeps the native rejection's code and message, and the provider", () => {
    const error = providerSheetError("google", Object.assign(new Error("No credentials available"), { code: "ERR_GOOGLE_SIGN_IN" }));
    expect(error).toBeInstanceOf(ProviderSheetError);
    expect(error).toMatchObject({ name: "ProviderSheetError", provider: "google", code: "ERR_GOOGLE_SIGN_IN", message: "No credentials available" });
  });

  it("reads a rejection that is no error as an unknown code with no message", () => {
    expect(providerSheetError("apple", "not an error")).toMatchObject({ provider: "apple", code: "ERR_UNKNOWN", message: "" });
  });

  it("is the person's device or network unless this build is at fault", () => {
    expect(isBuildFault(new ProviderSheetError("google", "ERR_GOOGLE_SIGN_IN", "Network error"))).toBe(false);
    expect(isBuildFault(new ProviderSheetError("apple", "ERR_REQUEST_FAILED", "The operation couldn't be completed."))).toBe(false);
    for (const code of ["ERR_GOOGLE_NOT_CONFIGURED", "ERR_GOOGLE_NO_PRESENTER", "ERR_GOOGLE_NO_TOKEN", "ERR_APPLE_NO_TOKEN", "ERR_REQUEST_INVALID_RESPONSE"]) {
      expect(isBuildFault(new ProviderSheetError("google", code, ""))).toBe(true);
    }
    // Google Play services' answer to a client id or signing key the Cloud console does not know.
    expect(isBuildFault(new ProviderSheetError("google", "ERR_GOOGLE_SIGN_IN", "[28444] Developer console is not set up correctly."))).toBe(true);
    expect(isBuildFault(new ProviderSheetError("google", "ERR_GOOGLE_SIGN_IN", "10: DEVELOPER_ERROR"))).toBe(true);
  });
});

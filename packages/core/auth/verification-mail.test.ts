import { afterEach, describe, expect, it } from "vitest";
import { VERIFICATION_RESEND_GAP_MS, forgetVerificationMail, noteVerificationMailed, verificationResendAt } from "./verification-mail";

const NOW = Date.parse("2026-10-29T09:00:00Z");

afterEach(forgetVerificationMail);

describe("verificationResendAt", () => {
  it("lets a code be asked at once when this browser mailed none", () => {
    expect(verificationResendAt("an@acme.vn", NOW)).toBe(NOW);
  });

  it("waits out the server's minute after a code mailed to that address, whatever its case", () => {
    noteVerificationMailed(" An@Acme.vn ", NOW);
    expect(verificationResendAt("an@acme.vn", NOW + 10_000)).toBe(NOW + VERIFICATION_RESEND_GAP_MS);
    expect(verificationResendAt("an@acme.vn", NOW + VERIFICATION_RESEND_GAP_MS + 1)).toBe(NOW + VERIFICATION_RESEND_GAP_MS + 1);
    // Another address, or after sign-out, waits on nothing.
    expect(verificationResendAt("binh@acme.vn", NOW)).toBe(NOW);
    forgetVerificationMail();
    expect(verificationResendAt("an@acme.vn", NOW)).toBe(NOW);
  });
});

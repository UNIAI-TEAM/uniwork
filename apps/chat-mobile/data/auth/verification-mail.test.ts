import { beforeEach, describe, expect, it } from "vitest";
import { VERIFICATION_RESEND_GAP_MS, forgetVerificationMail, noteVerificationMailed, verificationResendAt } from "./verification-mail";

const NOW = Date.parse("2026-10-28T09:00:00Z");

beforeEach(() => forgetVerificationMail());

describe("when a verification code may be asked again", () => {
  it("waits out the server's minute after a code this app had mailed to the address", () => {
    noteVerificationMailed(" Moi@CongTy.vn ", NOW);
    expect(verificationResendAt("moi@congty.vn", NOW + 1_000)).toBe(NOW + VERIFICATION_RESEND_GAP_MS);
    expect(verificationResendAt("moi@congty.vn", NOW + VERIFICATION_RESEND_GAP_MS)).toBe(NOW + VERIFICATION_RESEND_GAP_MS);
  });

  it("is now when no code was mailed (an app opened days later), or it went to another address", () => {
    expect(verificationResendAt("moi@congty.vn", NOW)).toBe(NOW);
    noteVerificationMailed("khac@congty.vn", NOW);
    expect(verificationResendAt("moi@congty.vn", NOW + 1_000)).toBe(NOW + 1_000);
    forgetVerificationMail();
    expect(verificationResendAt("khac@congty.vn", NOW + 1_000)).toBe(NOW + 1_000);
  });
});

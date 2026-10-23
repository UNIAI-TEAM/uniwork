// C3 — password-protected PDF open path. The fixture's user password is
// exactly four spaces (docs/office/g0/fixtures/manifest.json F-PDF-PWD4SP):
// the boundary this case exists for — an empty or differently spaced entry
// must stay locked with a typed error, never an empty viewer. F-PDF-CERT is
// encrypted for a certificate, so no password can ever satisfy it and it must
// stay a named refusal instead of a prompt.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  applyPdfEditBytes,
  PDF_PASSWORD_REASONS,
  PdfPasswordError,
  PdfTypedError,
  probePdf,
} from "./adapter";
import { readPdfText } from "./extract";

const FIXTURES = fileURLToPath(
  new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url),
);
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

const PASSWORD_PDF = "pdf-password-4spaces.pdf";
const CERT_PDF = "pdf-cert-encrypted.pdf";
/** The fixture's user password: exactly four spaces. */
const PASSWORD = "    ";
const WRONG_PASSWORD = "definitely-wrong-password";

async function refused(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
}

describe("encrypted pdf open — password path", () => {
  it("asks for a password when the file is encrypted and none was supplied", async () => {
    const error = await refused(probePdf(fixture(PASSWORD_PDF)));
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect(error).toMatchObject({
      name: "PdfPasswordError",
      code: "engine_result_invalid",
      reason: PDF_PASSWORD_REASONS.required,
      status: "required",
    });
  });

  it("opens with the correct password and reports the document", async () => {
    const probe = await probePdf(fixture(PASSWORD_PDF), PASSWORD);
    expect(probe.pageCount).toBe(1);
    expect(probe.features.ocr).toBe(false);
    // Unlocked content is readable through the same in-memory load.
    const text = await readPdfText(fixture(PASSWORD_PDF), { password: PASSWORD });
    expect(text.pageCount).toBe(1);
    expect(text.pages).toHaveLength(1);
  });

  it("refuses a wrong password as a typed wrong_password and never echoes it", async () => {
    const error = await refused(probePdf(fixture(PASSWORD_PDF), WRONG_PASSWORD));
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect(error).toMatchObject({
      reason: PDF_PASSWORD_REASONS.wrong,
      status: "wrong",
    });
    const surfaced = error as PdfPasswordError;
    expect(surfaced.message).toBe("wrong_password");
    expect(surfaced.message).not.toContain(WRONG_PASSWORD);
    expect(surfaced.reason).not.toContain(WRONG_PASSWORD);
    expect(String(surfaced)).not.toContain(WRONG_PASSWORD);
  });

  it("treats an empty entry as a supplied password that is refused", async () => {
    const error = await refused(probePdf(fixture(PASSWORD_PDF), ""));
    expect(error).toMatchObject({ status: "wrong", reason: "wrong_password" });
  });

  it("keeps a certificate-encrypted file a named refusal, with or without a password", async () => {
    for (const password of [undefined, "anything-at-all"] as const) {
      const error = await refused(probePdf(fixture(CERT_PDF), password));
      expect(error).toBeInstanceOf(PdfTypedError);
      expect(error).not.toBeInstanceOf(PdfPasswordError);
      expect(error).toMatchObject({
        code: "unsupported_operation",
        reason: "certificate_encrypted",
      });
    }
  });

  it("keeps the edit path's encrypted refusal — the edit channel carries no password", async () => {
    for (const file of [PASSWORD_PDF, CERT_PDF]) {
      await expect(
        applyPdfEditBytes(fixture(file), [{ op: "setMetadata", attributes: { title: "x" } }]),
      ).rejects.toMatchObject({ code: "engine_result_invalid", reason: "encrypted_pdf" });
    }
  });

  it("still types non-pdf bytes as not_a_pdf on the password path", async () => {
    await expect(probePdf(new Uint8Array(Buffer.from("junk")), PASSWORD)).rejects.toMatchObject({
      code: "engine_result_invalid",
      reason: "not_a_pdf",
    });
  });
});

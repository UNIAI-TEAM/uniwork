// Cross-language parity: Go signs server/internal/office/testdata/grant-parity.json
// (a golden test there), and the engine must verify that exact token with the
// same key and read back the same bindings. A wire change on either side
// fails one of the two tests.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bindEnvelope, signGrant, verifyGrant, type ServiceGrant } from "./grants.ts";

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../server/internal/office/testdata/grant-parity.json"), "utf8"),
) as { key: string; grant: ServiceGrant; token: string };

const extractFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../server/internal/office/testdata/grant-parity-extract.json"), "utf8"),
) as { key: string; grant: ServiceGrant; token: string };

describe("grant parity with the Go issuer", () => {
  it("verifies the Go-signed token and reads the same bindings", () => {
    const grant = verifyGrant(fixture.token, fixture.key);
    expect(grant).toEqual(fixture.grant);
  });

  it("verifies the Go-signed extract_text token and reads the same bindings", () => {
    const grant = verifyGrant(extractFixture.token, extractFixture.key);
    expect(grant).toEqual(extractFixture.grant);
  });

  it("refuses the Go token under another key or with a flipped byte", () => {
    expect(() => verifyGrant(fixture.token, fixture.key + "x")).toThrow(/grant_scope/);
    const [body, sig] = fixture.token.split(".") as [string, string];
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "B" : "A") + body.slice(-1);
    expect(() => verifyGrant(flipped + "." + sig, fixture.key)).toThrow(/grant_scope/);
  });

  it("a grant the engine signs verifies the same way", () => {
    const token = signGrant(fixture.grant, fixture.key);
    expect(verifyGrant(token, fixture.key)).toEqual(fixture.grant);

    const extractToken = signGrant(extractFixture.grant, extractFixture.key);
    expect(verifyGrant(extractToken, extractFixture.key)).toEqual(extractFixture.grant);
  });
});

describe("extract_text grant variant and envelope binding", () => {
  const key = extractFixture.key;

  it("refuses an extract_text grant with document_id, base_version_id, base_revision, null input, non-null output, or missing drive_file_id", () => {
    const badCases: Record<string, unknown>[] = [
      { ...extractFixture.grant, document_id: "01DOC00000000000000000000A" },
      { ...extractFixture.grant, base_version_id: "01VER00000000000000000000A" },
      { ...extractFixture.grant, base_revision: 1 },
      { ...extractFixture.grant, drive_file_id: "" },
      { ...extractFixture.grant, drive_file_id: undefined },
      { ...extractFixture.grant, input: null },
      { ...extractFixture.grant, output: fixture.grant.output },
    ];
    for (const bad of badCases) {
      const tok = signGrant(bad as unknown as ServiceGrant, key);
      expect(() => verifyGrant(tok, key)).toThrow(/grant_scope/);
    }
  });

  it("refuses a non-extract operation grant that carries drive_file_id or lacks document_id / base_version_id", () => {
    const withDriveFile = { ...fixture.grant, drive_file_id: "01DRIVEFILE00000000000000A" };
    expect(() => verifyGrant(signGrant(withDriveFile, key), key)).toThrow(/grant_scope/);

    const extractShapeWithOpen = { ...extractFixture.grant, operation: "open" as const };
    expect(() => verifyGrant(signGrant(extractShapeWithOpen, key), key)).toThrow(/grant_scope/);
  });

  it("binds an extract_text envelope without base_revision or base_version_id and refuses cross-operation use", () => {
    const extractGrant = verifyGrant(extractFixture.token, key);
    const docGrant = verifyGrant(fixture.token, fixture.key);

    expect(() =>
      bindEnvelope(
        extractGrant,
        {
          operation: "extract_text",
          format: "docx",
          grantId: extractGrant.grant_id,
          inputs: extractGrant.input,
        },
        [],
      ),
    ).not.toThrow();

    // Extract grant refused for another operation.
    expect(() =>
      bindEnvelope(
        extractGrant,
        {
          operation: "open",
          format: "docx",
          grantId: extractGrant.grant_id,
          baseRevision: 0,
          baseVersionId: "",
          inputs: extractGrant.input,
        },
        [],
      ),
    ).toThrow(/grant_scope/);

    // Document grant refused for extract_text (both on operation mismatch and if operation were forged on a doc shape).
    expect(() =>
      bindEnvelope(
        docGrant,
        {
          operation: "extract_text",
          format: "md",
          grantId: docGrant.grant_id,
          inputs: docGrant.input,
        },
        ["http://minio:9000"],
      ),
    ).toThrow(/grant_scope/);
  });
});

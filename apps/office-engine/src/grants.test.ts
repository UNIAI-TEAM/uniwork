// Cross-language parity: Go signs server/internal/office/testdata/grant-parity.json
// (a golden test there), and the engine must verify that exact token with the
// same key and read back the same bindings. A wire change on either side
// fails one of the two tests.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { signGrant, verifyGrant, type ServiceGrant } from "./grants.ts";

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../server/internal/office/testdata/grant-parity.json"), "utf8"),
) as { key: string; grant: ServiceGrant; token: string };

describe("grant parity with the Go issuer", () => {
  it("verifies the Go-signed token and reads the same bindings", () => {
    const grant = verifyGrant(fixture.token, fixture.key);
    expect(grant).toEqual(fixture.grant);
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
  });
});

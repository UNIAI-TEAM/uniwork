import { describe, expect, it } from "vitest";
import { launchUrlFromArgv, parseOfficeDeepLink } from "./parser";

const ticket = `ticket_${"a".repeat(32)}`;
const valid = `uniwork-office://open?ticket=${ticket}`;

describe("Office launch URL parser", () => {
  it("accepts only the canonical single-ticket URL", () => {
    expect(parseOfficeDeepLink(valid)).toEqual({ ok: true, ticket });
    expect(parseOfficeDeepLink(`uniwork-office://open/?ticket=${ticket}`)).toEqual({ ok: true, ticket });
  });

  it.each([
    [`uniwork-office://open?ticket=${ticket}&ticket=${ticket}`, "duplicate_ticket"],
    [`uniwork-office://open?ticket=${ticket}&server_url=https%3A%2F%2Fevil.test`, "unexpected_parameter"],
    [`uniwork-office://open?ticket=${ticket}&path=%2Ftmp%2Fx`, "unexpected_parameter"],
    [`uniwork-office://open?ticket=${ticket}&title=secret`, "unexpected_parameter"],
    [`uniwork-office://open?ticket=${ticket}&bytes=abc`, "unexpected_parameter"],
    [`uniwork-office://open?ticket=${ticket}&refresh_token=secret`, "unexpected_parameter"],
    [`https://open?ticket=${ticket}`, "wrong_scheme"],
    [`uniwork-office://other?ticket=${ticket}`, "wrong_host"],
    [`uniwork-office://open/nested?ticket=${ticket}`, "wrong_path"],
    [`uniwork-office://open`, "missing_ticket"],
    [`uniwork-office://open?ticket=${"x".repeat(193)}`, "oversized_ticket"],
    ["uniwork-office://open?ticket=code_abcdefghijklmnopqrstuvwxyz012345", "login_code"],
    ["uniwork-office://open?ticket=fake-code-1", "login_code"],
    ["uniwork-office://open?ticket=not-a-ticket", "invalid_ticket"],
  ] as const)("refuses %s without exposing the value", (url, reason) => {
    expect(parseOfficeDeepLink(url)).toEqual({ ok: false, reason });
    const candidate = url.split("ticket=")[1];
    if (candidate) expect(JSON.stringify(parseOfficeDeepLink(url))).not.toContain(candidate);
  });

  it("extracts a cold-start URL without accepting arbitrary argv values", () => {
    expect(launchUrlFromArgv(["--hidden", valid])).toBe(valid);
    expect(launchUrlFromArgv(["--hidden", "https://evil.test"])).toBeUndefined();
  });
});

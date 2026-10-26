import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const accountApi = vi.hoisted(() => ({ mobileSecurityPolicy: vi.fn(async () => ({ require_app_lock: true, block_screen_capture: false })) }));
vi.mock("../account-api", () => ({ accountApi }));

import { mobileSecurityPolicyOptions } from "./mobile-security-policy";

describe("mobileSecurityPolicyOptions", () => {
  it("reads the organization's requirements under the organization's key", async () => {
    const qc = new QueryClient();
    const options = mobileSecurityPolicyOptions("acme");
    expect(options.queryKey).toEqual(["org", "acme", "mobile-security-policy"]);
    await expect(qc.fetchQuery(options)).resolves.toEqual({ require_app_lock: true, block_screen_capture: false });
    expect(accountApi.mobileSecurityPolicy).toHaveBeenCalledWith("acme", expect.any(AbortSignal));
  });
});

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const accountApi = vi.hoisted(() => ({ pushPreviewPolicy: vi.fn(async () => ({ hidden: true, can_manage: false })) }));
vi.mock("../account-api", () => ({ accountApi }));

import { pushPreviewPolicyOptions } from "./push-previews";

describe("pushPreviewPolicyOptions", () => {
  it("reads the organization's rule under the organization's key", async () => {
    const qc = new QueryClient();
    const options = pushPreviewPolicyOptions("acme");
    expect(options.queryKey).toEqual(["org", "acme", "push-preview-policy"]);
    await expect(qc.fetchQuery(options)).resolves.toEqual({ hidden: true, can_manage: false });
    expect(accountApi.pushPreviewPolicy).toHaveBeenCalledWith("acme", expect.any(AbortSignal));
  });
});

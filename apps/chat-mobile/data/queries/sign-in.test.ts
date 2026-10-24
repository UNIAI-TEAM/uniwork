import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({ appleSignInOffered: vi.fn(async () => true) }));
vi.mock("../auth/flow", () => flow);

import { APPLE_OFFERED_STALE_MS, appleSignInOfferedOptions } from "./sign-in";

describe("appleSignInOfferedOptions", () => {
  it("asks the composition root, outside the chat keys", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(appleSignInOfferedOptions().queryKey).toEqual(["sign-in", "apple"]);
    expect(await client.fetchQuery(appleSignInOfferedOptions())).toBe(true);
  });

  it("keeps a yes a while and asks a no again", () => {
    const staleTime = appleSignInOfferedOptions().staleTime as (query: { state: { data: unknown } }) => number;
    expect(staleTime({ state: { data: true } })).toBe(APPLE_OFFERED_STALE_MS);
    expect(staleTime({ state: { data: false } })).toBe(0);
    expect(staleTime({ state: { data: undefined } })).toBe(0);
  });
});

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({ signInOffer: vi.fn(async () => ({ apple: "native", google: "browser" })) }));
vi.mock("../auth/flow", () => flow);
const methods = vi.hoisted(() => ({ signInMethodsApi: { getSignInMethods: vi.fn(async () => null) } }));
vi.mock("../auth/methods-api", () => methods);

import { SIGN_IN_OFFER_STALE_MS, signInMethodsOptions, signInOfferOptions } from "./sign-in";

describe("signInOfferOptions", () => {
  it("asks the composition root, outside the chat keys", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(signInOfferOptions().queryKey).toEqual(["sign-in", "offer"]);
    expect(await client.fetchQuery(signInOfferOptions())).toEqual({ apple: "native", google: "browser" });
  });

  it("keeps an offer with a provider a while and asks an empty one again", () => {
    const staleTime = signInOfferOptions().staleTime as (query: { state: { data: unknown } }) => number;
    expect(staleTime({ state: { data: { apple: null, google: "native" } } })).toBe(SIGN_IN_OFFER_STALE_MS);
    expect(staleTime({ state: { data: { apple: null, google: null } } })).toBe(0);
    expect(staleTime({ state: { data: undefined } })).toBe(0);
  });
});

describe("signInMethodsOptions", () => {
  it("reads the methods with the query's signal, and again whenever the app comes to the front", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(signInMethodsOptions().queryKey).toEqual(["sign-in", "methods"]);
    expect(await client.fetchQuery(signInMethodsOptions())).toBeNull();
    expect(methods.signInMethodsApi.getSignInMethods).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(signInMethodsOptions().refetchOnWindowFocus).toBe("always");
  });
});

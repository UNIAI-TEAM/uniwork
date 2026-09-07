import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  cancelSubscription,
  changePlan,
  createCheckout,
  getSubscription,
  listPlans,
  resumeSubscription,
} from "./billing";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const plan = { id: "p1", code: "starter", name: "Starter", features: [{ feature_key: "members.max", enabled: true, quota_limit: null }] };
const subscription = {
  id: "s1", plan_code: "starter", plan_name: "Starter", status: "active", provider: "manual",
  current_period_start: "2026-09-06T00:00:00Z", row_version: 1,
};
const entitlement = { feature_key: "members.max", name: "Thành viên", kind: "quota", enabled: true, quota_limit: 50, current_usage: 3 };

describe("billing endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("listPlans returns plans and [] on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ plans: [plan] }));
    expect((await listPlans())[0]!.price_amount).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ plans: [{ id: 1 }] }));
    await expect(listPlans()).resolves.toEqual([]);
  });

  it("getSubscription returns the view, lets an unknown status through, and null when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: { ...subscription, status: "mystery" }, entitlements: [entitlement] }));
    const view = await getSubscription("o1");
    expect(view?.subscription.plan_code).toBe("starter");
    expect(view?.entitlements[0]!.current_usage).toBe(3);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/o1/billing");
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: { id: 1 } }));
    await expect(getSubscription("o1")).resolves.toBeNull();
  });

  it("changePlan sends plan_code and row_version and degrades to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: { ...subscription, row_version: 2 } }));
    const view = await changePlan("o1", { plan_code: "team", row_version: 1 });
    expect(view?.subscription.row_version).toBe(2);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ plan_code: "team", row_version: 1 });
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(changePlan("o1", { plan_code: "team", row_version: 1 })).resolves.toBeNull();
  });

  it("cancelSubscription and resumeSubscription degrade to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: { ...subscription, cancel_at: "2026-10-06T00:00:00Z" } }));
    expect((await cancelSubscription("o1"))?.subscription.cancel_at).toBe("2026-10-06T00:00:00Z");
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: 3 }));
    await expect(cancelSubscription("o1")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription }));
    expect((await resumeSubscription("o1"))?.subscription.cancel_at).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(json([]));
    await expect(resumeSubscription("o1")).resolves.toBeNull();
  });

  it("createCheckout returns the url and '' when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ url: "https://pay.test/x" }, 201));
    expect(await createCheckout("o1", { plan_code: "team", success_path: "/a", cancel_path: "/b" })).toBe("https://pay.test/x");
    vi.mocked(fetch).mockResolvedValueOnce(json({ url: 5 }, 201));
    expect(await createCheckout("o1", { plan_code: "team", success_path: "/a", cancel_path: "/b" })).toBe("");
  });
});

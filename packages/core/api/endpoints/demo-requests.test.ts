import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { createDemoRequest, listDemoRequests, updateDemoRequest } from "./demo-requests";

beforeEach(() => { configureRuntime({ apiUrl: "http://api.test" }); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); resetRuntimeConfig(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const input = { full_name: "Lan", work_email: "lan@example.com", company_name: "Acme", team_size: "11-50" as const, message: "", locale: "vi" as const };
it("submits with the same idempotency key and only accepts an actual receipt", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ request_id: "d1" }));
  expect(await createDemoRequest(input, "same-request-key")).toEqual({ request_id: "d1" });
  expect(fetch).toHaveBeenCalledWith("http://api.test/api/v1/demo-requests", expect.objectContaining({ method: "POST", body: JSON.stringify(input), headers: expect.objectContaining({ "Idempotency-Key": "same-request-key" }) }));
  vi.mocked(fetch).mockResolvedValueOnce(json({ accepted: true }));
  expect(await createDemoRequest(input, "same-request-key")).toEqual({ request_id: "" });
});
it("degrades malformed admin responses without claiming a write succeeded", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ requests: "wrong" }));
  expect(await listDemoRequests({})).toEqual({ requests: [], total: 0 });
  vi.mocked(fetch).mockResolvedValueOnce(json({ request: null }));
  expect(await updateDemoRequest("d1", { status: "completed", reason: "Demo delivered to the team" })).toBeNull();
});

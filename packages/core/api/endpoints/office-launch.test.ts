import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { setSchemaLogger } from "../schema";
import {
  createOfficeLaunchSession,
  createOfficeLaunchSessionRequestSchema,
  exchangeOfficeLaunchSession,
  exchangeOfficeLaunchSessionRequestSchema,
} from "./office-launch";

const ticket = `ticket_${"a".repeat(32)}`;
const descriptor = {
  id: "01J8X4DOC0N1P2Q3R4S5T6U7",
  organization_id: "01J8X4ORGN1P2Q3R4S5T6U7V8",
  workspace_id: "01J8X4WS0N1P2Q3R4S5T6U7V8",
  title: "Q4 plan",
  kind: "file",
  operation: "edit",
  version: 0,
  revision: "41",
  contract_version: "uniwork-office-engine-contract/1",
  protocol_version: "1",
  download_path: "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download",
} as const;
const session = {
  launch_ticket: ticket,
  launch_url: `uniwork-office://open?ticket=${ticket}`,
  expires_at: "2026-09-30T10:02:00Z",
  document_id: descriptor.id,
  operation: "edit",
  version: 0,
};
const exchange = { receipt_id: "receipt_1", document: descriptor, redeemed_at: "2026-09-30T10:01:02Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Office launch endpoint contracts", () => {
  beforeEach(() => {
    setAccessToken("tok");
    configureRuntime({ apiUrl: "http://api.test" });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
    setSchemaLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
  });

  it("keeps the create request strict and posts the documented URL", async () => {
    expect(createOfficeLaunchSessionRequestSchema.parse({ operation: "edit", deployment_id: "production-eu", client_id: "uniwork-office", return_hint: "office" })).toEqual({ operation: "edit", deployment_id: "production-eu", client_id: "uniwork-office", return_hint: "office" });
    expect(() => createOfficeLaunchSessionRequestSchema.parse({ operation: "edit", deployment_id: "production-eu", client_id: "uniwork-office", server_url: "https://evil.test" })).toThrow();
    vi.mocked(fetch).mockResolvedValueOnce(json(session, 201));
    await expect(createOfficeLaunchSession(descriptor.id, { operation: "edit", deployment_id: "production-eu", client_id: "uniwork-office" })).resolves.toEqual(session);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(`http://api.test/api/v1/documents/${descriptor.id}/office/sessions`);
  });

  it("keeps exchange strict and sends only the main-process request shape", async () => {
    expect(exchangeOfficeLaunchSessionRequestSchema.parse({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1" })).toEqual({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1" });
    expect(() => exchangeOfficeLaunchSessionRequestSchema.parse({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1", refresh_token: "secret" })).toThrow();
    vi.mocked(fetch).mockResolvedValueOnce(json(exchange));
    await expect(exchangeOfficeLaunchSession({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1" })).resolves.toEqual(exchange);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("http://api.test/api/v1/office/sessions/exchange");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1" });
  });

  it("returns null for malformed create and exchange responses", async () => {
    for (const body of [{ nope: true }, { launch_ticket: ticket }, null, [], "malformed"]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(createOfficeLaunchSession(descriptor.id, { operation: "view", deployment_id: "production-eu", client_id: "uniwork-office" })).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(exchangeOfficeLaunchSession({ launch_ticket: ticket, deployment_id: "production-eu", client_id: "uniwork-office", device_session_id: "device-1" })).resolves.toBeNull();
    }
  });

  it("redacts launch values from compatibility warnings", async () => {
    const warn = vi.fn();
    setSchemaLogger({ debug: () => {}, info: () => {}, warn, error: () => {} });
    vi.mocked(fetch).mockResolvedValueOnce(json({ launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}`, deep_link: `uniwork-office://open?ticket=${ticket}`, nested: [ticket] }));
    await createOfficeLaunchSession(descriptor.id, { operation: "view", deployment_id: "production-eu", client_id: "uniwork-office" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ticket);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityState } from "../../capabilities";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getPublicConfig, postWebVital } from "./config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("config endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getPublicConfig returns flags and the sample rate, scoped to an organization", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { rum_sampling: true }, rum_sample_rate: 0.2 }));
    const cfg = await getPublicConfig("org1");
    expect(cfg).toEqual({
      flags: { rum_sampling: true },
      rum_sample_rate: 0.2,
      work_management_capabilities: {},
      office_installers: { dev: [], beta: [], stable: [] },
    });
    expect(cfg.office_deployment_id).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/v1/config?organization_id=org1");
  });

  it("getPublicConfig degrades a malformed response to no flags and no sampling", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: "nope", rum_sample_rate: 7 }));
    expect(await getPublicConfig()).toEqual({ flags: {}, rum_sample_rate: 0, work_management_capabilities: {}, office_installers: { dev: [], beta: [], stable: [] } });
    vi.mocked(fetch).mockResolvedValueOnce(json([1, 2]));
    expect(await getPublicConfig()).toEqual({ flags: {}, rum_sample_rate: 0, work_management_capabilities: {}, office_installers: { dev: [], beta: [], stable: [] } });
  });

  it("getPublicConfig carries the default-config deployment id through unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_deployment_id: "default" }));
    expect((await getPublicConfig()).office_deployment_id).toBe("default");
  });

  it("getPublicConfig carries the server's office channel and drops a drifted one (no installer, never another channel)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_channel: "dev" }));
    expect((await getPublicConfig()).office_channel).toBe("dev");
    for (const drifted of ["", "nightly", 42, null, { channel: "stable" }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { a: true }, rum_sample_rate: 0.5, office_channel: drifted }));
      const cfg = await getPublicConfig();
      expect(cfg.office_channel).toBeUndefined();
      expect(cfg.flags).toEqual({ a: true });
    }
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0 }));
    expect((await getPublicConfig()).office_channel).toBeUndefined();
  });

  it("getPublicConfig leaves the deployment id undefined when the server never advertises one (fail closed)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0 }));
    expect((await getPublicConfig()).office_deployment_id).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_deployment_id: "   " }));
    expect((await getPublicConfig()).office_deployment_id).toBeUndefined();
  });

  it("accepts deployment installer URLs per channel and rejects arbitrary protocols", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      flags: {}, rum_sample_rate: 0,
      office_installer_urls: { dev: "https://downloads.test/dev.exe", beta: "https://downloads.test/beta.exe", stable: "javascript:alert(1)" },
    }));
    const cfg = await getPublicConfig();
    expect(cfg.office_installers).toEqual({
      dev: [{ platform: "win32-x64", kind: ".exe", channel: "dev", url: "https://downloads.test/dev.exe" }],
      beta: [{ platform: "win32-x64", kind: ".exe", channel: "beta", url: "https://downloads.test/beta.exe" }], stable: [],
    });
  });
  it("uses platform catalogues per channel and ignores unknown, unsafe or malformed rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_installers: {
      dev: [{ platform: "linux-x64-deb", url: "http://localhost:18584/office.deb", kind: ".deb" }, { platform: "unknown", url: "javascript:alert(1)", kind: ".future" }],
      beta: [{ platform: "darwin-arm64", url: "https://downloads.test/office.dmg", kind: ".dmg" }],
      stable: [{ platform: "win32-x64", url: "javascript:alert(1)", kind: ".exe" }],
    }}));
    expect((await getPublicConfig()).office_installers).toEqual({
      dev: [{ platform: "linux-x64-deb", url: "http://localhost:18584/office.deb", kind: ".deb", channel: "dev" }],
      beta: [{ platform: "darwin-arm64", url: "https://downloads.test/office.dmg", kind: ".dmg", channel: "beta" }], stable: [],
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_installers: { dev: [{ platform: "win32-x64", kind: 42 }], stable: [] } }));
    expect((await getPublicConfig()).office_installers).toEqual({ dev: [], beta: [], stable: [] });
  });

  it("degrades malformed capability entries to the unavailable fallback", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        flags: {},
        rum_sample_rate: 0,
        work_management_capabilities: { "tasks.vcs": { status: 7 } },
      }),
    );
    const config = await getPublicConfig();
    expect(config.work_management_capabilities).toEqual({});
    expect(capabilityState(config, "tasks.vcs")).toEqual({
      status: "unavailable",
      reason_code: "capability_unknown",
      explanation_key: "capabilities.unknown",
    });
  });

  it("postWebVital sends the sample and resolves on 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(postWebVital("lcp", 1830, "/[orgSlug]/[workspaceSlug]/tasks")).resolves.toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      metric: "lcp",
      value: 1830,
      route: "/[orgSlug]/[workspaceSlug]/tasks",
    });
  });
});

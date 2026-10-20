import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityState } from "../../capabilities";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getPublicConfig, postWebVital } from "./config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// Nothing published: what every catalogue degrades to.
const NO_DOWNLOADS = {
  office_installers: { dev: [], beta: [], stable: [] },
  unichat_installers: { dev: [], beta: [], stable: [] },
  unichat_stores: { ios: "", android: "", testflight: "", play_internal: "" },
};

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
      ...NO_DOWNLOADS,
      documents: {
        limits: {
          upload_max_bytes: 209715200,
          save_warn_ratio: 0.9,
          web_open: {
            docx: { warn_bytes: 31457280 },
            pptx: { warn_bytes: 26214400 },
            pdf: { warn_bytes: 52428800 },
            xlsx: { warn_bytes: 5242880 },
          },
        },
      },
    });
    expect(cfg.office_deployment_id).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/v1/config?organization_id=org1");
  });

  it("getPublicConfig degrades a malformed response to no flags and no sampling", async () => {
    const empty = {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {},
      ...NO_DOWNLOADS,
      documents: {
        limits: {
          upload_max_bytes: 209715200,
          save_warn_ratio: 0.9,
          web_open: {
            docx: { warn_bytes: 31457280 },
            pptx: { warn_bytes: 26214400 },
            pdf: { warn_bytes: 52428800 },
            xlsx: { warn_bytes: 5242880 },
          },
        },
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: "nope", rum_sample_rate: 7 }));
    expect(await getPublicConfig()).toEqual(empty);
    vi.mocked(fetch).mockResolvedValueOnce(json([1, 2]));
    expect(await getPublicConfig()).toEqual(empty);
  });

  it("getPublicConfig carries the default-config deployment id through unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_deployment_id: "default" }));
    expect((await getPublicConfig()).office_deployment_id).toBe("default");
  });

  it("getPublicConfig carries the desktop API origin and drops a drifted one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_api_origin: "https://api.test" }));
    expect((await getPublicConfig()).office_api_origin).toBe("https://api.test");
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { a: true }, rum_sample_rate: 0, office_api_origin: 42 }));
    const drifted = await getPublicConfig();
    expect(drifted.office_api_origin).toBeUndefined();
    expect(drifted.flags).toEqual({ a: true });
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

  it("reads the UniChat catalogue with Office's platform rules and keeps only HTTPS store links", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0,
      unichat_installers: {
        dev: [
          { platform: "darwin-arm64", url: "https://downloads.test/UniChat_0.1.0-dev.1_unsigned_darwin_arm64.dmg", kind: ".dmg", version: "0.1.0-dev.1", unsigned: true },
          { platform: "unknown", url: "javascript:alert(1)", kind: ".future" },
        ],
        beta: "nope",
        stable: [{ platform: "win32-x64", url: "javascript:alert(1)", kind: ".exe" }],
      },
      unichat_stores: { ios: "https://apps.apple.com/app/id1234567890", android: "http://play.google.com/store/apps/details?id=x", testflight: 42, play_internal: " https://play.google.com/apps/internaltest/1 " },
    }));
    const cfg = await getPublicConfig();
    expect(cfg.unichat_installers).toEqual({
      dev: [{ platform: "darwin-arm64", url: "https://downloads.test/UniChat_0.1.0-dev.1_unsigned_darwin_arm64.dmg", kind: ".dmg", version: "0.1.0-dev.1", unsigned: true, channel: "dev" }],
      beta: [], stable: [],
    });
    expect(cfg.unichat_stores).toEqual({ ios: "https://apps.apple.com/app/id1234567890", android: "", testflight: "", play_internal: "https://play.google.com/apps/internaltest/1" });
    expect(cfg.office_installers).toEqual({ dev: [], beta: [], stable: [] });
  });

  it("degrades a drifted UniChat block to nothing published without dropping the rest", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { a: true }, rum_sample_rate: 0.5, unichat_installers: [1, 2], unichat_stores: "https://apps.apple.com/app/id1" }));
    const cfg = await getPublicConfig();
    expect(cfg.flags).toEqual({ a: true });
    expect(cfg.rum_sample_rate).toBe(0.5);
    expect(cfg.unichat_installers).toEqual({ dev: [], beta: [], stable: [] });
    expect(cfg.unichat_stores).toEqual({ ios: "", android: "", testflight: "", play_internal: "" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, unichat_stores: { ios: "https://user:pw@apps.apple.com/app/id1", android: "itms-apps://x" } }));
    expect((await getPublicConfig()).unichat_stores).toEqual({ ios: "", android: "", testflight: "", play_internal: "" });
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

  it("parses documents.limits with and without chunked_upload_threshold_bytes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        flags: {},
        rum_sample_rate: 0,
        documents: {
          limits: {
            upload_max_bytes: 209715200,
            save_warn_ratio: 0.9,
            web_open: {
              docx: { warn_bytes: 31457280 },
              pptx: { warn_bytes: 26214400 },
              pdf: { warn_bytes: 52428800 },
              xlsx: { warn_bytes: 5242880 },
            },
          },
        },
      }),
    );
    expect((await getPublicConfig()).documents?.limits).toEqual({
      upload_max_bytes: 209715200,
      save_warn_ratio: 0.9,
      web_open: {
        docx: { warn_bytes: 31457280 },
        pptx: { warn_bytes: 26214400 },
        pdf: { warn_bytes: 52428800 },
        xlsx: { warn_bytes: 5242880 },
      },
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        flags: {},
        rum_sample_rate: 0,
        documents: {
          limits: {
            upload_max_bytes: 104857600,
            save_warn_ratio: 0.85,
            chunked_upload_threshold_bytes: 20971520,
            web_open: {
              docx: { warn_bytes: 31457280 },
              pptx: { warn_bytes: 26214400 },
              pdf: { warn_bytes: 52428800 },
              xlsx: { warn_bytes: 5242880 },
            },
          },
        },
      }),
    );
    expect((await getPublicConfig()).documents?.limits).toEqual({
      upload_max_bytes: 104857600,
      save_warn_ratio: 0.85,
      chunked_upload_threshold_bytes: 20971520,
      web_open: {
        docx: { warn_bytes: 31457280 },
        pptx: { warn_bytes: 26214400 },
        pdf: { warn_bytes: 52428800 },
        xlsx: { warn_bytes: 5242880 },
      },
    });
  });

  it("degrades missing or malformed documents.limits fields to the contract fallbacks", async () => {
    const fallbackLimits = {
      upload_max_bytes: 209715200,
      save_warn_ratio: 0.9,
      web_open: {
        docx: { warn_bytes: 31457280 },
        pptx: { warn_bytes: 26214400 },
        pdf: { warn_bytes: 52428800 },
        xlsx: { warn_bytes: 5242880 },
      },
    };

    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, documents: "bad" }));
    expect((await getPublicConfig()).documents?.limits).toEqual(fallbackLimits);

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        flags: {},
        rum_sample_rate: 0,
        documents: {
          limits: {
            upload_max_bytes: -10,
            save_warn_ratio: "nope",
            chunked_upload_threshold_bytes: "bad",
            web_open: {
              docx: { warn_bytes: "bad" },
              pptx: "bad",
              pdf: { warn_bytes: 0 },
              xlsx: { warn_bytes: 6291456 },
            },
          },
        },
      }),
    );
    expect((await getPublicConfig()).documents?.limits).toEqual({
      ...fallbackLimits,
      web_open: {
        ...fallbackLimits.web_open,
        xlsx: { warn_bytes: 6291456 },
      },
    });
  });
});

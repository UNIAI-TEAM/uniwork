import { afterEach, describe, expect, it, vi } from "vitest";
import { appleAppSiteAssociation, assetLinks } from "./well-known";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appleAppSiteAssociation", () => {
  it("answers 404 with no body when UNICHAT_IOS_TEAM_ID is unset", async () => {
    vi.stubEnv("UNICHAT_IOS_TEAM_ID", "");
    const res = appleAppSiteAssociation();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("serves the applinks document for the team's app id", async () => {
    vi.stubEnv("UNICHAT_IOS_TEAM_ID", "ABCDE12345");
    const res = appleAppSiteAssociation();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      applinks: {
        details: [{
          appIDs: ["ABCDE12345.com.uniworkos.chat"],
          components: [{ "/": "/*/*/chat*" }, { "/": "/invite/*" }],
        }],
      },
    });
  });
});

describe("assetLinks", () => {
  it("answers 404 with no body when UNICHAT_ANDROID_SHA256 is unset", async () => {
    vi.stubEnv("UNICHAT_ANDROID_SHA256", "");
    const res = assetLinks();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("answers 404 when the list holds only separators and blanks", () => {
    vi.stubEnv("UNICHAT_ANDROID_SHA256", " , ,");
    expect(assetLinks().status).toBe(404);
  });

  it("serves one statement with the comma-separated fingerprints trimmed", async () => {
    vi.stubEnv("UNICHAT_ANDROID_SHA256", " AA:BB , ,CC:DD");
    const res = assetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.uniworkos.chat",
        sha256_cert_fingerprints: ["AA:BB", "CC:DD"],
      },
    }]);
  });
});

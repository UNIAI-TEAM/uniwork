import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { searchProxy } from "./search-proxy";

afterEach(resetRuntimeConfig);
describe("search request boundaries", () => {
  it("uses the URL locale instead of supplied headers or cookies", () => {
    configureRuntime({ appUrl: "https://uniworkos.com" });
    const response = searchProxy(new NextRequest("https://uniworkos.com/vi/office", { headers: { "x-uniwork-marketing-locale": "en", cookie: "uniwork-locale=en" } }));
    expect(response.headers.get("x-middleware-request-x-uniwork-marketing-locale")).toBe("vi");
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
  it("does not grant public indexing to application paths", () => {
    configureRuntime({ appUrl: "https://uniworkos.com" });
    for (const path of ["/admin", "/acme/team/tasks", "/vi/admin", "/office/private"]) {
      const response = searchProxy(new NextRequest(`https://uniworkos.com${path}`, { headers: { "x-uniwork-marketing-locale": "vi" } }));
      expect(response.headers.get("x-middleware-request-x-uniwork-marketing-locale")).toBeNull();
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
  });
  it("excludes previews and redirects the known www alias", () => {
    configureRuntime({ appUrl: "https://preview.uniworkos.com" });
    expect(searchProxy(new NextRequest("https://preview.uniworkos.com/office")).headers.get("x-robots-tag")).toContain("noindex");
    configureRuntime({ appUrl: "https://uniworkos.com" });
    expect(searchProxy(new NextRequest("https://preview.uniworkos.com/office")).headers.get("x-robots-tag")).toContain("noindex");
    const response = searchProxy(new NextRequest("https://www.uniworkos.com/office?source=test"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://uniworkos.com/office?source=test");
  });
  it("returns real 404 responses before streaming unknown public parameters", async () => {
    for (const path of ["/features/not-a-feature", "/vi/not-a-public-page", "/learn/not-a-guide", "/solutions/missing"]) {
      const response = searchProxy(new NextRequest(`https://uniworkos.com${path}`));
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(await response.text()).toContain('data-testid="app-not-found"');
    }
  });
  it("recognizes the public Host when Next uses an internal bind address", () => {
    configureRuntime({ appUrl: "https://uniworkos.com" });
    const request = (host: string) => new NextRequest("http://0.0.0.0:3000/office", { headers: { host, "x-forwarded-host": "uniworkos.com" } });
    expect(searchProxy(request("uniworkos.com")).headers.get("x-robots-tag")).toBeNull();
    expect(searchProxy(request("preview.uniworkos.com")).headers.get("x-robots-tag")).toContain("noindex");
    expect(searchProxy(request("www.uniworkos.com")).headers.get("location")).toBe("https://uniworkos.com/office");
  });
});

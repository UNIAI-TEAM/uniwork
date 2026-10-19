import { describe, expect, it } from "vitest";
import { resolveShellConfig } from "./runtime-config";

describe("resolveShellConfig", () => {
  it("defaults to dev against localhost with the dev scheme", () => {
    expect(resolveShellConfig({})).toEqual({
      env: "dev",
      appUrl: "http://localhost:3000",
      apiUrl: "http://localhost:8080",
      deploymentId: "default",
      clientId: "uniwork-chat-desktop",
      scheme: "uniworkchat-dev",
      redirectUri: "uniworkchat-dev://auth/callback",
    });
  });

  it("reads prod from the env and normalizes URLs to origins", () => {
    const config = resolveShellConfig({
      UNICHAT_ENV: "prod",
      UNICHAT_APP_URL: "https://app.uniworkos.com/chat/?x=1#y",
      UNICHAT_API_URL: "https://api.uniworkos.com/",
      UNICHAT_DEPLOYMENT_ID: "acme",
    });
    expect(config).toEqual({
      env: "prod",
      appUrl: "https://app.uniworkos.com",
      apiUrl: "https://api.uniworkos.com",
      deploymentId: "acme",
      clientId: "uniwork-chat-desktop",
      scheme: "uniworkchat",
      redirectUri: "uniworkchat://auth/callback",
    });
  });

  it("uses the production scheme for staging and for an unknown env", () => {
    const urls = { UNICHAT_APP_URL: "https://a.example", UNICHAT_API_URL: "https://b.example" };
    expect(resolveShellConfig({ UNICHAT_ENV: "staging", ...urls })).toMatchObject({
      env: "staging",
      scheme: "uniworkchat",
    });
    expect(resolveShellConfig({ UNICHAT_ENV: "canary", ...urls })).toMatchObject({
      env: "prod",
      scheme: "uniworkchat",
    });
  });

  it("throws on a broken or non-http URL, and on a missing URL outside dev", () => {
    expect(() => resolveShellConfig({ UNICHAT_APP_URL: "not a url" })).toThrow(/UNICHAT_APP_URL/);
    expect(() => resolveShellConfig({ UNICHAT_API_URL: "file:///etc/passwd" })).toThrow(/UNICHAT_API_URL/);
    expect(() => resolveShellConfig({ UNICHAT_ENV: "prod", UNICHAT_API_URL: "https://b.example" })).toThrow(
      /UNICHAT_APP_URL/,
    );
  });

  it("falls back to the default deployment id when the value is empty", () => {
    expect(resolveShellConfig({ UNICHAT_DEPLOYMENT_ID: "" }).deploymentId).toBe("default");
  });
});

import { describe, expect, it, vi } from "vitest";
import { downloadOfficeDesktopBundle, getOfficeDesktopDownload } from "./office-desktop";

const request = vi.hoisted(() => vi.fn());
const requestBlob = vi.hoisted(() => vi.fn());
vi.mock("../http", () => ({ request, requestBlob }));
describe("office desktop download endpoint", () => {
  it("requests the organization-scoped channel profile", async () => {
    request.mockResolvedValue({ installer_url: "https://downloads.test/office.exe", server_origin: "https://api.test", channel: "beta", client_id: "uniwork-office", deployment_id: "default" });
    await expect(getOfficeDesktopDownload("org/1", "beta")).resolves.toMatchObject({ channel: "beta" });
    expect(request).toHaveBeenCalledWith("/api/v1/office/desktop/download?organization_id=org%2F1&channel=beta");
  });
  it.each([null, {}, { installer_url: "javascript:alert(1)" }])("returns null for malformed response %#", async (body) => {
    request.mockResolvedValue(body);
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it("rejects unsafe URLs even when every other response field is present", async () => {
    request.mockResolvedValue({ installer_url: "javascript:alert(1)", server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default" });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it("refuses a legacy URL that cannot be a Windows installer", async () => {
    request.mockResolvedValue({ installer_url: "https://downloads.test/office.dmg", server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default" });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it.each(["bad%5Cname.exe", "bad%0Aname.exe", "bad%00name.exe", "bad%3Fname.exe", "bad%3Aname.exe", "bad%22name.exe"])("refuses a filename the bundle cannot preserve: %s", async (filename) => {
    request.mockResolvedValue({ server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default",
      installers: [{ platform: "win32-x64", url: `https://downloads.test/${filename}`, kind: ".exe" }] });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it("accepts encoded spaces and the decoded artifact extension", async () => {
    request.mockResolvedValue({ server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default",
      installers: [{ platform: "win32-x64", url: "https://downloads.test/my%20office%2Eexe", kind: ".exe" }] });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toMatchObject({ installers: [{ platform: "win32-x64" }] });
  });
  it.each(["installer_url", "server_origin"])("returns null for an unparseable %s in an otherwise complete response", async (field) => {
    request.mockResolvedValue({ installer_url: "https://downloads.test/office.exe", server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default", [field]: "https://[broken" });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it("downloads the authenticated ZIP and refuses JSON masquerading as a bundle", async () => {
    const zip = new Blob(["fixture"], { type: "application/zip" });
    requestBlob.mockResolvedValueOnce(zip);
    await expect(downloadOfficeDesktopBundle("org/1", "beta", "darwin-arm64")).resolves.toBe(zip);
    expect(requestBlob).toHaveBeenCalledWith("/api/v1/office/desktop/download?organization_id=org%2F1&channel=beta&bundle=true&platform=darwin-arm64");
    requestBlob.mockResolvedValueOnce(new Blob(["{}"], { type: "application/json" }));
    await expect(downloadOfficeDesktopBundle("org/1", "beta", "darwin-arm64")).rejects.toThrow("invalid desktop installer bundle");
  });
  it("orders configured choices, ignores unknown API keys and does not invent missing builds", async () => {
    request.mockResolvedValue({ server_origin: "https://api.test", channel: "beta", client_id: "uniwork-office", deployment_id: "default",
      supported_platforms: ["win32-x64", "linux-x64-deb", "unknown"],
      installers: [{ platform: "linux-x64-deb", url: "https://downloads.test/office.deb", kind: ".deb", size_bytes: 42 },
        { platform: "unknown", url: "javascript:alert(1)", kind: ".future" },
        { platform: "win32-x64", url: "https://downloads.test/office.exe", kind: ".exe" }],
    });
    const profile = await getOfficeDesktopDownload("org-1", "beta");
    expect(profile?.installers.map((row) => [row.platform, row.channel])).toEqual([["win32-x64", "beta"], ["linux-x64-deb", "beta"]]);
    expect(profile?.supported_platforms).toEqual(["win32-x64", "linux-x64-deb"]);
  });
  it.each([
    [{ platform: "linux-x64-deb", url: "https://downloads.test/office.deb", kind: ".exe" }],
    [{ platform: "linux-x64-deb", url: "http://downloads.test/office.deb", kind: ".deb" }],
    [{ platform: "darwin-arm64", url: "https://[broken", kind: ".dmg" }],
    [{ platform: "darwin-arm64", url: "https://downloads.test/office.dmg?token=x", kind: ".dmg" }],
    [{ platform: "darwin-arm64", url: "https://downloads.test/office.dmg", kind: ".dmg", size_bytes: "42" }],
  ])("degrades a malformed known installer list %#", async (installers) => {
    request.mockResolvedValue({ server_origin: "https://api.test", channel: "stable", client_id: "uniwork-office", deployment_id: "default", installers });
    await expect(getOfficeDesktopDownload("org-1")).resolves.toBeNull();
  });
  it("never uses a dev response for stable", async () => {
    request.mockResolvedValue({ server_origin: "https://api.test", channel: "dev", client_id: "uniwork-office-dev", deployment_id: "default", installers: [] });
    await expect(getOfficeDesktopDownload("org-1", "stable")).resolves.toBeNull();
  });
});

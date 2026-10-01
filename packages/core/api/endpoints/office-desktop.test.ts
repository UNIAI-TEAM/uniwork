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
  it("downloads the authenticated ZIP and refuses JSON masquerading as a bundle", async () => {
    const zip = new Blob(["fixture"], { type: "application/zip" });
    requestBlob.mockResolvedValueOnce(zip);
    await expect(downloadOfficeDesktopBundle("org/1", "beta")).resolves.toBe(zip);
    expect(requestBlob).toHaveBeenCalledWith("/api/v1/office/desktop/download?organization_id=org%2F1&channel=beta&bundle=true");
    requestBlob.mockResolvedValueOnce(new Blob(["{}"], { type: "application/json" }));
    await expect(downloadOfficeDesktopBundle("org/1", "beta")).rejects.toThrow("invalid desktop installer bundle");
  });
});

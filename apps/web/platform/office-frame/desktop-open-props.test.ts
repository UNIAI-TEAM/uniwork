import { afterEach, describe, expect, it, vi } from "vitest";

// The transport is the only mock: getDocument's real schema reads the answer.
const request = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/http")>()),
  request: (...a: unknown[]) => request(...a),
}));

import { desktopOpenAllowed, frameDesktopOpen } from "./desktop-open-props";
import { launchOfficeDeepLink } from "./desktop-handoff";

const savedDocument = { id: "doc-1", organization_id: "org-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7" };

afterEach(() => { request.mockReset(); });

describe("desktop open rule of the module frames", () => {
  it("shows the action only for an open editor and a user who may edit", () => {
    expect(desktopOpenAllowed({ open: true, readonly: false })).toBe(true);
    expect(desktopOpenAllowed({ open: true, readonly: true })).toBe(false);
    expect(desktopOpenAllowed({ open: false, readonly: false })).toBe(false);
  });

  it("wires a frame with the deep-link launch and the saved version, and reads the committed version back after a frame save", async () => {
    const props = frameDesktopOpen({ id: "doc-1", organization_id: "org-1", current_version: 4 }, "dep-1");
    expect(props).toMatchObject({ deploymentId: "dep-1", savedVersion: 4, channel: "stable", launch: launchOfficeDeepLink });
    request.mockResolvedValueOnce({ document: { ...savedDocument, current_version: 5 } });
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBe(5);
    expect(request).toHaveBeenLastCalledWith("/api/v1/documents/doc-1", expect.anything());
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBeNull();
  });

  it("carries the deployment origin into the action for the open link's profile", () => {
    expect(frameDesktopOpen({ id: "doc-1", organization_id: "org-1", current_version: 4 }, "dep-1", "dev", undefined, "https://api.test")).toMatchObject({ deploymentId: "dep-1", apiOrigin: "https://api.test", channel: "dev" });
  });

  it("downloads the plain installer in the browser after the audited click, never through a blob", async () => {
    const url = "https://downloads.test/releases/UniWork-Office_0.11.0-dev.7_amd64.deb";
    request.mockResolvedValueOnce({ server_origin: "https://api.test", channel: "dev", client_id: "uniwork-office-dev", deployment_id: "dep-1",
      installers: [{ platform: "linux-x64-deb", url, kind: ".deb" }] });
    const clicked: { href: string; download: string; target: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ href: this.href, download: this.download, target: this.target }); });
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const props = frameDesktopOpen({ id: "doc-1", organization_id: "org-1", current_version: 4 }, "dep-1", "dev");
    await expect(props.downloadInstaller?.("linux-x64-deb")).resolves.toBe("UniWork-Office_0.11.0-dev.7_amd64.deb");
    expect(request).toHaveBeenCalledWith("/api/v1/office/desktop/download?organization_id=org-1&channel=dev&platform=linux-x64-deb");
    expect(clicked).toEqual([{ href: url, download: "UniWork-Office_0.11.0-dev.7_amd64.deb", target: "_blank" }]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
    request.mockResolvedValueOnce(null);
    await expect(props.downloadInstaller?.("linux-x64-deb")).rejects.toThrow("installer unavailable");
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

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

describe("desktop open rule shared by the G3 host and the module frames", () => {
  it("shows the action only for an open editor and a user who may edit", () => {
    expect(desktopOpenAllowed({ open: true, readonly: false })).toBe(true);
    expect(desktopOpenAllowed({ open: true, readonly: true })).toBe(false);
    expect(desktopOpenAllowed({ open: false, readonly: false })).toBe(false);
  });

  it("wires a frame with the G3 launch and the saved version, and reads the committed version back after a frame save", async () => {
    const props = frameDesktopOpen({ id: "doc-1", organization_id: "org-1", current_version: 4 }, "dep-1");
    expect(props).toMatchObject({ deploymentId: "dep-1", savedVersion: 4, channel: "stable", launch: launchOfficeDeepLink });
    request.mockResolvedValueOnce({ document: { ...savedDocument, current_version: 5 } });
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBe(5);
    expect(request).toHaveBeenLastCalledWith("/api/v1/documents/doc-1", expect.anything());
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBeNull();
  });
});

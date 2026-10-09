import { afterEach, describe, expect, it, vi } from "vitest";

const getDocument = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/endpoints/documents", () => ({ getDocument }));

import { desktopOpenAllowed, frameDesktopOpen } from "./desktop-open-props";
import { launchOfficeDeepLink } from "./desktop-handoff";

afterEach(() => { getDocument.mockReset(); });

describe("desktop open rule shared by the G3 host and the module frames", () => {
  it("shows the action only for an open editor and a user who may edit", () => {
    expect(desktopOpenAllowed({ open: true, readonly: false })).toBe(true);
    expect(desktopOpenAllowed({ open: true, readonly: true })).toBe(false);
    expect(desktopOpenAllowed({ open: false, readonly: false })).toBe(false);
  });

  it("wires a frame with the G3 launch and the saved version, and reads the committed version back after a frame save", async () => {
    const props = frameDesktopOpen({ id: "doc-1", organization_id: "org-1", current_version: 4 }, "dep-1");
    expect(props).toMatchObject({ deploymentId: "dep-1", savedVersion: 4, channel: "stable", launch: launchOfficeDeepLink });
    getDocument.mockResolvedValueOnce({ current_version: 5 });
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBe(5);
    getDocument.mockRejectedValueOnce(new Error("offline"));
    await expect(props.versionAfterSave?.({ accepted: true })).resolves.toBeNull();
  });
});

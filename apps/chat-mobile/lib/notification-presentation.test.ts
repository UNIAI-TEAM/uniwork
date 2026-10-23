import { describe, expect, it } from "vitest";
import { showInForeground } from "./notification-presentation";

const APP = "https://app.uniworkos.com";
const OPEN = { orgSlug: "acme", wsSlug: "hq" };

describe("showInForeground", () => {
  it("keeps a push about the open workspace quiet: the app already shows it", () => {
    expect(showInForeground({ url: `${APP}/acme/hq/chat?room=r&call=c` }, OPEN, APP, "uniworkchat")).toBe(false);
  });

  it("shows a push about another workspace, or one it cannot place", () => {
    expect(showInForeground({ url: `${APP}/acme/sales/chat?room=r&call=c` }, OPEN, APP, "uniworkchat")).toBe(true);
    expect(showInForeground({ url: `${APP}/other/hq/chat?room=r` }, OPEN, APP, "uniworkchat")).toBe(true);
    expect(showInForeground({ url: `${APP}/acme/hq/tasks/t1` }, OPEN, APP, "uniworkchat")).toBe(true);
    expect(showInForeground({ url: 3 }, OPEN, APP, "uniworkchat")).toBe(true);
    expect(showInForeground(null, OPEN, APP, "uniworkchat")).toBe(true);
  });

  it("shows everything while no workspace is open (the workspace picker)", () => {
    expect(showInForeground({ url: `${APP}/acme/hq/chat?room=r` }, null, APP, "uniworkchat")).toBe(true);
  });
});

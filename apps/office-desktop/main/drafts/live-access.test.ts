import { describe, expect, it, vi } from "vitest";
import { createLiveDraftAccess, type LiveDraftContext } from "./live-access";

const initial = (): LiveDraftContext => ({
  kind: "cloud",
  session: { sessionId: "session", accountId: "account", deploymentId: "lane", generation: 1 },
  identity: { accountId: "account", deploymentId: "lane", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "1", version: "1" } },
});

describe("main live draft recovery access", () => {
  it("reads the current cloud document and grants only fresh edit access", async () => {
    const context = initial();
    const readAccess = vi.fn(async () => "edit" as const);
    const access = createLiveDraftAccess({ context: () => context, readAccess });
    await expect(access()).resolves.toBe("edit");
    expect(readAccess).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", documentId: "doc" });
  });

  it("retains local main-owned access without querying the cloud", async () => {
    const context = { ...initial(), kind: "local" as const };
    const readAccess = vi.fn(async () => "none" as const);
    await expect(createLiveDraftAccess({ context: () => context, readAccess })()).resolves.toBe("edit");
    expect(readAccess).not.toHaveBeenCalled();
  });

  it("denies missing context, mismatched session scope, or a missing reader", async () => {
    const readAccess = vi.fn(async () => "edit" as const);
    await expect(createLiveDraftAccess({ context: () => undefined, readAccess })()).resolves.toBe("none");
    for (const session of [{ ...initial().session, accountId: "other" }, { ...initial().session, deploymentId: "other" }, { ...initial().session, generation: 0 }]) {
      await expect(createLiveDraftAccess({ context: () => ({ ...initial(), session }), readAccess })()).resolves.toBe("none");
    }
    await expect(createLiveDraftAccess({ context: initial })()).resolves.toBe("none");
    expect(readAccess).not.toHaveBeenCalled();
  });

  it("denies live view/denial and network failure", async () => {
    await expect(createLiveDraftAccess({ context: initial, readAccess: async () => "none" })()).resolves.toBe("none");
    await expect(createLiveDraftAccess({ context: initial, readAccess: async () => { throw new Error("network"); } })()).resolves.toBe("none");
  });

  it("F-1 regression: refuses view-only detail access and fences a session switch", async () => {
    const context = initial();
    await expect(createLiveDraftAccess({ context: () => context, readAccess: async () => "none" })()).resolves.toBe("none");
    let complete!: (access: "edit") => void;
    const pending = createLiveDraftAccess({ context: () => context, readAccess: () => new Promise<"edit">((resolve) => { complete = resolve; }) })();
    context.session = { ...context.session, sessionId: "new-session" };
    complete("edit");
    await expect(pending).resolves.toBe("none");
  });

  it.each(["account", "deployment", "session", "generation", "document", "workspace", "organization", "base", "logout", "local"] as const)("denies a %s switch while the authenticated request is pending", async (field) => {
    let context: LiveDraftContext | undefined = initial();
    let complete!: (access: "edit") => void;
    const readAccess = vi.fn(() => new Promise<"edit">((resolve) => { complete = resolve; }));
    const pending = createLiveDraftAccess({ context: () => context, readAccess })();
    expect(readAccess).toHaveBeenCalledOnce();
    if (field === "logout") context = undefined;
    else if (field === "local") context = { ...context, kind: "local" };
    else if (field === "account") context = { ...context, session: { ...context.session, accountId: "other" }, identity: { ...context.identity, accountId: "other" } };
    else if (field === "deployment") context = { ...context, session: { ...context.session, deploymentId: "other" }, identity: { ...context.identity, deploymentId: "other" } };
    else if (field === "session") context = { ...context, session: { ...context.session, sessionId: "other" } };
    else if (field === "generation") context = { ...context, session: { ...context.session, generation: 2 } };
    else context = { ...context, identity: { ...context.identity, ...(field === "document" ? { documentId: "other" } : field === "workspace" ? { workspaceId: "other" } : field === "organization" ? { organizationId: "other" } : { base: { revision: "2", version: "2" } }) } };
    complete("edit");
    await expect(pending).resolves.toBe("none");
  });

  it("detects an in-place change of the captured document identity", async () => {
    const context = initial();
    const pending = createLiveDraftAccess({ context: () => context, readAccess: async () => {
      Object.assign(context.identity, { documentId: "other" });
      return "edit";
    } })();
    await expect(pending).resolves.toBe("none");
  });
});

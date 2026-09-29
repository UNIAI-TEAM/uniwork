import { describe, expect, it } from "vitest";
import { createFakeDraftKeyUnwrapPort, draftKeyUnwrapResponseSchema } from "./draft-key-port";

describe("draft key unwrap port", () => {
  it("records the complete request and returns the fake response", async () => {
    const port = createFakeDraftKeyUnwrapPort({ status: "blocked", reason: "edit_acl_missing" });
    const session = { sessionId: "s", deploymentId: "d", accountId: "a", generation: 2 };
    const identity = {
      deploymentId: "d",
      accountId: "a",
      organizationId: "o",
      workspaceId: "w",
      documentId: "doc",
      base: { revision: "r", version: "v" },
    };
    await expect(port.unwrap({ session, identity, draftId: "draft", generation: 3, checksum: "sha256:x" })).resolves.toEqual({ status: "blocked", reason: "edit_acl_missing" });
    expect(port.requests[0]).toMatchObject({ draftId: "draft", generation: 3, checksum: "sha256:x" });
    port.setResponse({ status: "malformed" });
    expect(draftKeyUnwrapResponseSchema.safeParse(await port.unwrap({ session, identity, draftId: "draft", generation: 3, checksum: "sha256:x" })).success).toBe(false);
  });
});

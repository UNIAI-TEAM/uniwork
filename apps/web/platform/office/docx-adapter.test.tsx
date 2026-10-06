// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import { createDocxFormatAdapter } from "./docx-adapter";

const identity: OfficeIdentity = {
  deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc",
  generation: 1, baseVersionId: "version-1", baseRevision: "1",
};
const capability: OfficeCapabilityEntry = {
  format: "docx", operation: "edit", host: "web", engineBuild: "test", contractRevision: "docx/1", status: "available", fidelityWarnings: [],
};

function create(read: () => Promise<Uint8Array>) {
  return createDocxFormatAdapter({
    identity, session: { sessionId: "s", deploymentId: "dep", accountId: "acct", generation: 1 },
    documents: { read, upload: vi.fn(), commit: vi.fn() } as never, capability, title: "Doc",
    draftStore: { clearMemory: vi.fn() } as unknown as IndexedDbDraftStore,
    keyProvider: { clearMemory: vi.fn(async () => undefined), registerCleanup: vi.fn(() => () => undefined) } as unknown as DraftKeyProvider,
  });
}

describe("web DOCX format adapter open failures", () => {
  it("keeps a too-large source as too_large instead of collapsing it to engine_error (UNI-956)", async () => {
    const adapter = create(async () => { throw Object.assign(new Error("too big"), { code: "file_too_large" }); });
    expect(await adapter.open.open()).toMatchObject({ outcome: "failed", format: "docx", failure_class: "too_large" });
    await adapter.session.dispose();
  });

  it("keeps the engine's too_large class and still reports other failures as engine_error", async () => {
    const adapter = create(async () => { throw Object.assign(new Error("input exceeds the byte bound"), { failureClass: "too_large" }); });
    expect(await adapter.open.open()).toMatchObject({ failure_class: "too_large" });
    await adapter.session.dispose();
    const other = create(async () => { throw new Error("network"); });
    expect(await other.open.open()).toMatchObject({ failure_class: "engine_error" });
    await other.session.dispose();
  });
});

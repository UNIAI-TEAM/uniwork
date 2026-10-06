/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { RendererBridge } from "../app";
import { useDocumentTabs, type CloudReopen } from "./use-document-tabs";

const checksum = (n: string) => `sha256:${n.repeat(64)}`;
const bridge = { call: vi.fn(async () => ({ drafts: [] })), onSessionChanged: () => () => undefined } as unknown as RendererBridge;

afterEach(() => { vi.clearAllMocks(); });

// UNI-954 R4-2: every cloud format's upgrade is built from the fresh read, not from the bytes and base of
// the first open: the byte formats (docx, md, html, pdf), the pptx deck session and the xlsx job session.
it.each<DesktopDocumentFormat>(["docx", "md", "html", "pdf", "pptx", "xlsx"])("upgrades a read-only %s cloud tab from the fresh read", (format) => {
  const { result, unmount } = renderHook(() => useDocumentTabs(bridge));
  const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: `doc-${format}`, generation: 1, baseRevision: "1", baseVersionId: "1" };
  act(() => {
    result.current.open({ kind: "cloud", title: `Doc.${format}`, format, readOnlyReason: "flags_unknown", identity, bytes: { format, data: new Uint8Array([0]), checksum: checksum("a"), canSave: false } });
  });
  const before = result.current.current.current.tabs[0]!.data;
  const dispose = vi.spyOn(before.session, "dispose");
  const fresh: CloudReopen = { bytes: { format, data: new Uint8Array([1, 2]), checksum: checksum("b") }, baseRevision: "5", baseVersionId: "4" };

  let upgraded = false;
  act(() => { upgraded = result.current.upgradeCloud(identity.documentId, fresh); });

  expect(upgraded).toBe(true);
  const after = result.current.current.current.tabs[0]!.data;
  expect(after.bytes).toMatchObject({ data: new Uint8Array([1, 2]), checksum: checksum("b"), canSave: true });
  expect(after.identity).toMatchObject({ baseRevision: "5", baseVersionId: "4", documentId: identity.documentId });
  expect(after.readOnlyReason).toBeUndefined();
  expect(after.session).not.toBe(before.session);
  expect(dispose).toHaveBeenCalledTimes(1);
  unmount();
});

it("refuses to upgrade a tab that can already save", () => {
  const { result, unmount } = renderHook(() => useDocumentTabs(bridge));
  const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "1" };
  act(() => { result.current.open({ kind: "cloud", title: "Doc.docx", format: "docx", identity, bytes: { format: "docx", data: new Uint8Array([0]), checksum: checksum("a") } }); });
  expect(result.current.upgradeCloud("doc-1", { bytes: { format: "docx", data: new Uint8Array([1, 2]), checksum: checksum("b") }, baseRevision: "5", baseVersionId: "4" })).toBe(false);
  unmount();
});

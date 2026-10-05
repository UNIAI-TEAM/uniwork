/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = `sha256:${"b".repeat(64)}`;

function mount(format: "md" | "html", source: string, canSave = true) {
  const call = vi.fn(async (channel: string) => channel === "desktop:draft-list" ? { drafts: [] } : {});
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format, dataBase64: Buffer.from(source).toString("base64"), checksum, canSave });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title={`Doc.${format}`} kind="local" onBack={() => undefined} />);
  return { session, call };
}

it("mounts the shared Markdown editor for a .md session", async () => {
  mount("md", "# Tiêu đề\n");
  expect(await screen.findByTestId("md-editor", {}, { timeout: 15000 })).toBeInTheDocument();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
  expect(screen.queryByText("desktop_surface_unbound")).toBeNull();
});

it("mounts the shared HTML editor for a .html session", async () => {
  mount("html", "<p>Xin chào</p>");
  expect(await screen.findByTestId("html-editor", {}, { timeout: 15000 })).toBeInTheDocument();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
});

it("shows the decoded text of a read-only .md instead of a bare capability notice", async () => {
  mount("md", "# Chỉ đọc\n", false);
  expect(await screen.findByTestId("readonly-text", {}, { timeout: 15000 })).toHaveTextContent("# Chỉ đọc");
});

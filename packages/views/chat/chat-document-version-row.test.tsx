import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav, fakeNav } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatDocumentVersionRow } from "./chat-document-version-row";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function versionMessage(document: ChatMessage["document"], body = "3"): ChatMessage {
  return {
    id: "m-ver",
    sender: "u2",
    body,
    kind: "document_version",
    ts: Date.now(),
    reactions: {},
    ...(document ? { document } : {}),
  };
}

function renderRow(message: ChatMessage, senderLabel = "Bình") {
  const nav = fakeNav();
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ChatDocumentVersionRow message={message} senderLabel={senderLabel} compactTop={false} />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

describe("ChatDocumentVersionRow", () => {
  it("prints \"{{name}} đã tải lên phiên bản {{version}}\" and clicks through for a viewer", () => {
    const nav = renderRow(versionMessage({ document_id: "doc1", viewer_has_access: true }));
    const button = screen.getByRole("button", { name: "Bình đã tải lên phiên bản 3" });
    fireEvent.click(button);
    expect(nav.push).toHaveBeenCalledWith("/acme/team/documents/doc1");
  });

  it("stays plain text without access", () => {
    renderRow(versionMessage({ document_id: "doc1", viewer_has_access: false }));
    expect(screen.getByText("Bình đã tải lên phiên bản 3")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stays plain text when the block is absent (old server)", () => {
    renderRow(versionMessage(undefined));
    expect(screen.getByText("Bình đã tải lên phiên bản 3")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the resolved sender label for the reader's own commit", () => {
    renderRow(versionMessage({ document_id: "doc1", viewer_has_access: true }), "Bạn");
    expect(screen.getByRole("button", { name: "Bạn đã tải lên phiên bản 3" })).toBeInTheDocument();
  });
});

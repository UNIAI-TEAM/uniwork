import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { endOfficeDraftSession } from "@uniwork/core/office/draft-session-key";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { OfficeModuleFrame } from "../office/frame/office-module-frame";
import { useNavigation } from "../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { useReportFrameComments } from "./document-comments-context";
import { DocumentDetailView } from "./document-detail-view";

// UNI-1389 (g), one flow: a document opened with ?comment=<id> while the editor frame serves
// comments. The page draws no DocumentCommentsPanel (invariant 8) and the frame host receives
// comments.reveal { comment_id }. The two halves are proved apart by document-detail-view.test.tsx
// and use-frame-comments.test.tsx; this file proves they hold together on one page.

const { t } = initI18n();

const MINT_PATH = "/api/v1/documents/d1/office/frame-token";
const COMMENT = "01J8X4CMTN1P2Q3R4S5T6U7V";

const docx: Document = (() => {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: "ws1", organization_id: "org1", kind: "file", title: "Báo cáo", revision: "3", current_version: 2, my_level: "edit",
    file: { file_id: "f1", version_id: "v2", version: 2, filename: "bao-cao.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 1024, checksum_sha256: "a".repeat(64) },
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"], visibility: parsed.visibility as Document["visibility"], my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"], owner_kind: parsed.owner_kind as Document["owner_kind"], system_kind: parsed.system_kind as Document["system_kind"],
  };
})();

/** What apps/web/platform/office-frame/module-frame-host.tsx wires: the link's comment and the claim report. */
function FrameHost({ document: doc, wsId, readonly }: { wsId: string; document: Document; readonly: boolean }) {
  const { searchParams } = useNavigation();
  const reportFrameComments = useReportFrameComments();
  return (
    <OfficeModuleFrame
      module="docs" wsId={wsId} fileRef={{ kind: "document", id: doc.id }} title={doc.title} frameVersion="1.0.0" readonly={readonly}
      myLevel={doc.my_level} revealCommentId={searchParams.get("comment")} onFrameCommentsChange={reportFrameComments}
      api={{ open: vi.fn(), save: vi.fn(), recents: vi.fn() } as unknown as DocsFrameApi}
    />
  );
}

beforeEach(() => {
  window.innerWidth = 1400; // desktop rail: the inline pane, no sheet portal
  resetAuthStoreForTests();
  setSessionUser({ id: "01J8X4USR0AAAAAAAAAAAAAAAA", display_name: "An", email: "an@example.com" } as User);
  requestMock.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await endOfficeDraftSession();
});

describe("a comment link on a page whose editor frame serves comments", () => {
  it("draws no page panel and reveals the comment in the frame", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.resolve({ document: docx });
      if (path === MINT_PATH) {
        return Promise.resolve({
          token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
          document_id: "d1", workspace_id: "ws1", organization_id: "org1", can_edit: true, module: "docs",
        });
      }
      if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { office_engine: true, office_docx: true } });
      if (path.startsWith("/api/v1/documents/d1/comments")) return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:a" });
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    const nav = fakeNav("/acme/doi/documents/d1");
    nav.searchParams = new URLSearchParams(`comment=${COMMENT}`);
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    render(wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <ThemeProvider defaultTheme="light" enableSystem={false}>
          <DocumentDetailView wsId="ws1" documentId="d1" libraryHref="/acme/doi/documents" onBackToList={vi.fn()} officeEditorHost={FrameHost} />
        </ThemeProvider>
      </FeatureFlagsProvider>,
      nav,
    ));

    // The frame on the other side of the wire: record what the host posts, answer init with `comments`.
    const iframe = (await screen.findByTestId("office-docs-frame-iframe", {}, { timeout: 15_000 })) as HTMLIFrameElement;
    const win = iframe.contentWindow!;
    const received: Envelope[] = [];
    let seq = 0;
    const post = (data: unknown) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source: win }));
    });
    const envelope = (kind: Envelope["kind"], type: string, payload: unknown, id = `f${(seq += 1)}`): Envelope =>
      ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, payload });
    vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
      const m = message as Envelope;
      received.push(m);
      if (m.kind === "request" && m.type === "init") {
        queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: { comments: true } }, m.id)); });
      }
    });

    // Before the frame says anything the page's own panel is the only way to the comment.
    expect(await screen.findByTestId("document-comments-pane")).toBeInTheDocument();

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await post(envelope("event", "ready", { protocolVersion: 1, capabilities: { comments: true }, module: "docs", instanceId: "i-1" }));

    // The frame owns the comments now: no page panel, no second trigger, and the frame is told which comment.
    await waitFor(() => expect(screen.queryByTestId("document-comments-pane")).toBeNull());
    expect(screen.queryByRole("button", { name: t("documents.comments.title") })).toBeNull();
    await waitFor(() => expect(received.filter((m) => m.kind === "request" && m.type === "comments.reveal")).toHaveLength(1));
    expect(received.find((m) => m.type === "comments.reveal")!.payload).toEqual({ comment_id: COMMENT });
  });
});

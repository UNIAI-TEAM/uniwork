import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { documentCommentDraftKey, useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock } from "../test/request-mock";
import { DocumentCommentComposer, type SendOutcome } from "./document-comment-composer";
import { K } from "./document-comments-keys";

// UNI-1969: the composer shows a picked mention as "@Name" and only the body it sends
// (and the stored draft) carries the `[@Name](mention://member/ID)` token.

const { t } = initI18n();
const DOC = "d1";
const AN = "01J8X4USR0000000000000000A";
const BINH = "01J8X4USR0000000000000000B";
const tok = (id: string, name: string) => `[@${name}](mention://member/${id})`;

const me: User = {
  id: "01J8X4USR0000000000000000Z",
  email: "me@example.com",
  display_name: "Minh",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function mount(onSend: (body: string) => Promise<SendOutcome> = () => Promise.resolve("sent")) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={client}>
      <DocumentCommentComposer
        wsId="ws1" documentId={DOC} orgId="org1" placeholderKey={K.collabComposerDiscussion}
        deletedKey={K.collabDiscussionDeleted} onSend={onSend} testId="composer" canSeeMembers
        doc={{ my_level: "manage", owner_kind: undefined, admin_scope: undefined }}
      />
    </QueryClientProvider>
  );
  const view = render(ui);
  const box = () => screen.getByRole("textbox", { name: t(K.collabComposerDiscussion) }) as HTMLTextAreaElement;
  return { box, view, ui };
}

const type = (box: HTMLTextAreaElement, value: string) => fireEvent.change(box, { target: { value } });

async function pick(box: HTMLTextAreaElement, prefix: string, name: string) {
  type(box, `${prefix}@`);
  const option = await screen.findByRole("option", { name: new RegExp(name) });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockResolvedValue({
    candidates: [
      { user_id: AN, display_name: "An Nguyễn", can_view: false },
      { user_id: BINH, display_name: "Bình", can_view: true },
    ],
  });
  useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null });
});

describe("mention display in the document composer", () => {
  it("shows @Name after a pick, never the wire token", async () => {
    const { box } = mount();
    await pick(box(), "Nhờ ", "Bình");
    expect(box()).toHaveValue("Nhờ @Bình ");
    expect(box().value).not.toContain("mention://");
  });

  it("sends the same token body as before", async () => {
    const onSend = vi.fn((_body: string) => Promise.resolve<SendOutcome>("sent"));
    const { box } = mount(onSend);
    await pick(box(), "Nhờ ", "Bình");
    type(box(), `${box().value}xem giúp`);
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0]).toBe(`Nhờ ${tok(BINH, "Bình")} xem giúp`);
  });

  it("restores @Name from the stored draft after a reload", () => {
    const key = documentCommentDraftKey({ accountId: me.id, orgId: "org1", wsId: "ws1", documentId: DOC });
    useDocumentCommentDraftStore.getState().setDraft(key, `Nhờ ${tok(BINH, "Bình")} xem`);
    const { box } = mount();
    expect(box()).toHaveValue("Nhờ @Bình xem");
  });

  it("keeps the no-access chip for a can_view false pick", async () => {
    const { box } = mount();
    await pick(box(), "", "An Nguyễn");
    expect(box()).toHaveValue("@An Nguyễn ");
    expect(await screen.findByTestId(`composer-mention-chip-${AN}`)).toHaveTextContent(t(K.collabMentionNoAccessBadge));
  });

  it("drops the mention when part of @Name is deleted", async () => {
    const onSend = vi.fn((_body: string) => Promise.resolve<SendOutcome>("sent"));
    const { box } = mount(onSend);
    await pick(box(), "", "Bình");
    type(box(), "@Bìn xem");
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0]).toBe("@Bìn xem");
  });

  it("sends two different ids for two people who share a display name", async () => {
    requestMock.mockResolvedValue({
      candidates: [
        { user_id: AN, display_name: "Bình", email: "an@example.com", can_view: true },
        { user_id: BINH, display_name: "Bình", email: "binh@example.com", can_view: true },
      ],
    });
    const onSend = vi.fn((_body: string) => Promise.resolve<SendOutcome>("sent"));
    const { box } = mount(onSend);
    type(box(), "@");
    let options = await screen.findAllByRole("option", { name: /Bình/ });
    fireEvent.mouseDown(options[0]!);
    fireEvent.click(options[0]!);
    type(box(), `${box().value}@`);
    options = await screen.findAllByRole("option", { name: /Bình/ });
    fireEvent.mouseDown(options[1]!);
    fireEvent.click(options[1]!);
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const body = onSend.mock.calls[0]![0];
    expect(body).toContain(`mention://member/${AN})`);
    expect(body).toContain(`mention://member/${BINH})`);
  });
});

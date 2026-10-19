import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { BodyMentionNotice } from "./document-body-mention-notice";
import { useBodyMentionHint } from "./use-body-mention-hint";

// UNI-1968 W2: the post-save no-access hint. Proves the diff is per
// acknowledged save (a mention that arrived with the document or survived
// unchanged is never re-prompted), shares the notice's targets, and falls
// back to "ask a manager" copy when the viewer cannot administer.

initI18n();

const ME = "01J8X4USR0AAAAAAAAAAAAAAAA";
const BLOCKED = "01J8X4USR0BBBBBBBBBBBBBBBB";

const pageWith = (mentions: { id: string; label: string }[]) => ({
  type: "doc",
  content: mentions.map((m) => ({
    type: "paragraph",
    content: [{ type: "mention", attrs: { id: m.id, label: m.label, type: "member" } }],
  })),
});

// A Document trimmed to what the hook reads — the acknowledged body.
const ackedDoc = (content: unknown, revision: string): Document =>
  ({ id: "d1", content, revision }) as unknown as Document;

const saveState = (over: Partial<DocumentSaveState>): DocumentSaveState => ({
  phase: "idle",
  revision: "1",
  dirty: false,
  idempotencyKey: null,
  errorClass: null,
  errorCode: null,
  errorFields: undefined,
  sentEditLockId: undefined,
  sendSeq: 0,
  acked: null,
  ...over,
});

/** The test's dial: Probe hands its setState + share/admin knobs here. */
const probe: {
  setSave: (s: DocumentSaveState) => void;
  admin: boolean;
  share?: (id: string) => Promise<void>;
} = { setSave: () => {}, admin: true };

/** Probe: drives the hook with a mutable save state and renders the notice. */
function Probe({ base, initial }: { base: unknown; initial: DocumentSaveState }) {
  const [state, setState] = useState(initial);
  const hint = useBodyMentionHint({ wsId: "ws1", documentId: "d1", state, baseContent: base });
  probe.setSave = setState;
  return (
    <BodyMentionNotice
      wsId="ws1"
      documentId="d1"
      documentWorkspaceId="ws1"
      targets={hint.targets}
      canAdminister={probe.admin}
      onDismiss={hint.dismiss}
      onShared={hint.refreshAfterShare}
      onShareView={probe.share}
    />
  );
}

const save = (content: unknown, revision = "2") =>
  act(() => {
    probe.setSave(saveState({ phase: "saved", revision, acked: ackedDoc(content, revision) }));
  });

beforeEach(async () => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ candidates: [] });
  resetAuthStoreForTests();
  setSessionUser({ id: ME, display_name: "An", email: "an@example.com" } as User);
  probe.setSave = () => {};
  probe.admin = true;
  probe.share = undefined;
  await setLocale("vi");
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  resetAuthStoreForTests();
  await setLocale("vi");
});

const notice = () => screen.queryByTestId("document-body-mention-notice");

describe("UNI-1968 body mention no-access hint", () => {
  it("shows only for ids an acknowledged save newly added and cannot view", async () => {
    requestMock.mockResolvedValue({
      candidates: [
        { user_id: BLOCKED, display_name: "Bình", can_view: false },
        { user_id: "u-view", display_name: "Hà", can_view: true },
      ],
    });
    // The page opened already mentioning Hà — she is never "new".
    render(wrap(<Probe base={pageWith([{ id: "u-view", label: "Hà" }])} initial={saveState({})} />));

    await save(pageWith([{ id: "u-view", label: "Hà" }, { id: BLOCKED, label: "Bình" }]));

    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Bình chưa xem được tài liệu này nên đã không nhận thông báo.");
    expect(notice()).not.toHaveTextContent("Hà");
  });

  it("ignores a viewer-only addition and a non-saved phase", async () => {
    requestMock.mockResolvedValue({
      candidates: [{ user_id: BLOCKED, display_name: "Bình", can_view: false }],
    });
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    // A viewer-only addition: no hint.
    await save(pageWith([{ id: "u-view", label: "Hà" }]));
    expect(notice()).toBeNull();

    // A saving phase that happens to carry acked is ignored.
    act(() => {
      probe.setSave(saveState({ phase: "saving", acked: ackedDoc(pageWith([{ id: BLOCKED, label: "Bình" }]), "3") }));
    });
    expect(notice()).toBeNull();
  });

  it("never re-prompts a mention that survived a save unchanged, but prompts a re-add", async () => {
    requestMock.mockResolvedValue({
      candidates: [{ user_id: BLOCKED, display_name: "Bình", can_view: false }],
    });
    render(wrap(<Probe base={pageWith([{ id: BLOCKED, label: "Bình" }])} initial={saveState({})} />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    // Saves that keep or drop the mention: no hint — she arrived with the doc.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "2");
    await save(pageWith([]), "3");
    expect(notice()).toBeNull();

    // Re-added in a save after the removal was acknowledged: a real change.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "4");
    await waitFor(() => expect(notice()).toBeInTheDocument());
  });

  it("share at view grants every target and closes the notice", async () => {
    probe.share = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
    requestMock.mockResolvedValue({
      candidates: [{ user_id: BLOCKED, display_name: "Bình", can_view: false }],
    });
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());

    await act(async () => {
      screen.getByTestId("document-body-mention-notice-share").click();
    });
    expect(probe.share).toHaveBeenCalledWith(BLOCKED);
    await waitFor(() => expect(notice()).toBeNull());
  });

  it("dismiss closes the hint and an unchanged save never re-prompts", async () => {
    requestMock.mockResolvedValue({
      candidates: [{ user_id: BLOCKED, display_name: "Bình", can_view: false }],
    });
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());

    await act(async () => {
      screen.getByTestId("document-body-mention-notice-dismiss").click();
    });
    expect(notice()).toBeNull();

    // A later acknowledged save that keeps the same mention: no re-prompt.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "3");
    expect(notice()).toBeNull();
  });

  it("a viewer without manage gets the ask-a-manager line and no share button", async () => {
    probe.admin = false;
    requestMock.mockResolvedValue({
      candidates: [{ user_id: BLOCKED, display_name: "Bình", can_view: false }],
    });
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho Bình.");
    expect(screen.queryByTestId("document-body-mention-notice-share")).toBeNull();
  });
});

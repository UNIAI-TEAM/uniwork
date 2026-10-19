import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import type { Document } from "@uniwork/core/types/document";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import { requestMock, wrap } from "../test/api-mock";
import { BodyMentionNotice } from "./document-body-mention-notice";
import { useBodyMentionHint } from "./use-body-mention-hint";

// UNI-1968 W2: the post-save no-access hint. Proves the diff is per
// acknowledged save (a mention that arrived with the document or survived
// unchanged is never re-prompted), shares the notice's targets, and falls
// back to "ask a manager" copy when the viewer cannot administer.
// RFM-01/RFM-03: no candidates request fires on open — each newly added id
// asks for itself (q = the mention's label), so a no-access person is named
// even past the 50-row viewers-first page the unfiltered query returns.

initI18n();

const ME = "01J8X4USR0AAAAAAAAAAAAAAAA";
const BLOCKED = "01J8X4USR0BBBBBBBBBBBBBBBB";
const SECOND = "01J8X4USR0CCCCCCCCCCCCCCCC";

const pageWith = (mentions: { id: string; label: string }[]) => ({
  type: "doc",
  content: mentions.map((m) => ({
    type: "paragraph",
    content: [{ type: "mention", attrs: { id: m.id, label: m.label, type: "member" } }],
  })),
});

/** Accent-insensitive fold good enough to mirror uw_fold_search on test names. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Row {
  user_id: string;
  display_name: string;
  can_view: boolean;
}

/**
 * The candidates endpoint as the server answers it: q is a folded substring
 * over the display name, the page is viewers-first and cut at `limit`.
 * `pool` is a getter so a share that lands mid-test flips later answers.
 */
const answerCandidates = (pool: () => Row[]) =>
  requestMock.mockImplementation((path: string) => {
    if (typeof path === "string" && path.includes("mention-candidates")) {
      const url = new URL(path, "http://test");
      const q = url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const rows = pool()
        .filter((r) => q === "" || fold(r.display_name).includes(fold(q)))
        .sort((a, b) => Number(b.can_view) - Number(a.can_view))
        .slice(0, limit);
      return Promise.resolve({ candidates: rows });
    }
    return Promise.resolve({ members: [] });
  });

/** The mention-candidates requests this test has made (the rest are ignored). */
const candidateCalls = () =>
  requestMock.mock.calls.filter((c) => typeof c[0] === "string" && (c[0] as string).includes("mention-candidates"));

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
    answerCandidates(() => [
      { user_id: BLOCKED, display_name: "Bình", can_view: false },
      { user_id: "u-view", display_name: "Hà", can_view: true },
    ]);
    // The page opened already mentioning Hà — she is never "new".
    render(wrap(<Probe base={pageWith([{ id: "u-view", label: "Hà" }])} initial={saveState({})} />));

    await save(pageWith([{ id: "u-view", label: "Hà" }, { id: BLOCKED, label: "Bình" }]));

    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Bình chưa xem được tài liệu này nên đã không nhận thông báo.");
    expect(notice()).not.toHaveTextContent("Hà");
  });

  it("fires no candidates request on open or on a save without new mentions", async () => {
    answerCandidates(() => [{ user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await act(async () => {});
    expect(candidateCalls()).toHaveLength(0);

    // An unchanged save adds nobody: still silent.
    await save(pageWith([]));
    await act(async () => {});
    expect(candidateCalls()).toHaveLength(0);

    // Control: a new mention does fire one lookup.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "3");
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    expect(String(candidateCalls()[0]![0])).toContain("q=B%C3%ACnh");
  });

  it("names a no-access person even when 60 viewers fill the page", async () => {
    const viewers: Row[] = Array.from({ length: 60 }, (_, i) => ({
      user_id: `01J8X4VWR${String(i).padStart(16, "0")}`.slice(0, 26),
      display_name: `Viewer ${i}`,
      can_view: true,
    }));
    answerCandidates(() => [...viewers, { user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));

    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));

    // The per-id lookup asks q=Bình; the 50-row viewers-first page never
    // holds her row, but her own answer does.
    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Bình");
  });

  it("treats an id absent from its own answer as unknown — no hint", async () => {
    answerCandidates(() => [
      { user_id: BLOCKED, display_name: "Bình", can_view: false },
      { user_id: "u-view", display_name: "Hà", can_view: true },
    ]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    // The mentioned person is nobody's candidate (task mention, member who left).
    await save(pageWith([{ id: "u-gone", label: "Người Rời" }]));
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    expect(notice()).toBeNull();
  });

  it("never looks up or hints the editor's own mention", async () => {
    answerCandidates(() => [{ user_id: ME, display_name: "An", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));

    await save(pageWith([{ id: ME, label: "An" }]));
    await act(async () => {});

    expect(candidateCalls()).toHaveLength(0);
    expect(notice()).toBeNull();
  });

  it("ignores a viewer-only addition and a non-saved phase", async () => {
    answerCandidates(() => [{ user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));

    // A viewer-only addition: no hint.
    await save(pageWith([{ id: "u-view", label: "Hà" }]));
    await act(async () => {});
    expect(notice()).toBeNull();

    // A saving phase that happens to carry acked is ignored.
    act(() => {
      probe.setSave(saveState({ phase: "saving", acked: ackedDoc(pageWith([{ id: BLOCKED, label: "Bình" }]), "3") }));
    });
    expect(notice()).toBeNull();
    expect(candidateCalls()).toHaveLength(1);
  });

  it("never re-prompts a mention that survived a save unchanged, but prompts a re-add", async () => {
    answerCandidates(() => [{ user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([{ id: BLOCKED, label: "Bình" }])} initial={saveState({})} />));

    // Saves that keep or drop the mention: no hint — she arrived with the doc.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "2");
    await save(pageWith([]), "3");
    await act(async () => {});
    expect(notice()).toBeNull();
    expect(candidateCalls()).toHaveLength(0);

    // Re-added in a save after the removal was acknowledged: a real change.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "4");
    await waitFor(() => expect(notice()).toBeInTheDocument());
  });

  it("share at view grants every target and closes the notice", async () => {
    const shared = new Set<string>();
    probe.share = vi.fn<(id: string) => Promise<void>>().mockImplementation(async (id) => {
      shared.add(id);
    });
    answerCandidates(() => [
      // can_view flips true only after the share lands — like the server.
      { user_id: BLOCKED, display_name: "Bình", can_view: shared.has(BLOCKED) },
      { user_id: SECOND, display_name: "Chí", can_view: shared.has(SECOND) },
    ]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }, { id: SECOND, label: "Chí" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Bình");
    expect(notice()).toHaveTextContent("Chí");

    await act(async () => {
      screen.getByTestId("document-body-mention-notice-share").click();
    });
    expect(probe.share).toHaveBeenCalledWith(BLOCKED);
    expect(probe.share).toHaveBeenCalledWith(SECOND);
    await waitFor(() => expect(notice()).toBeNull());
  });

  it("a partial share failure keeps the hint and shows the retry label", async () => {
    const shared = new Set<string>();
    probe.share = vi.fn<(id: string) => Promise<void>>().mockImplementation(async (id) => {
      if (id === SECOND) throw new Error("share denied");
      shared.add(id);
    });
    answerCandidates(() => [
      // Bình flips to a viewer once shared; Chí's share fails, so she stays false.
      { user_id: BLOCKED, display_name: "Bình", can_view: shared.has(BLOCKED) },
      { user_id: SECOND, display_name: "Chí", can_view: shared.has(SECOND) },
    ]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }, { id: SECOND, label: "Chí" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());

    await act(async () => {
      screen.getByTestId("document-body-mention-notice-share").click();
    });

    // Bình's share landed and the refetch drops her; Chí stays with the retry copy.
    await waitFor(() => expect(notice()).toHaveTextContent("Thử lại cho Chí"));
    expect(notice()).not.toHaveTextContent("Bình");
    expect(notice()).toHaveTextContent("Chí chưa xem được tài liệu này nên đã không nhận thông báo.");
  });

  it("dismiss closes the hint and an unchanged save never re-prompts", async () => {
    answerCandidates(() => [{ user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());

    await act(async () => {
      screen.getByTestId("document-body-mention-notice-dismiss").click();
    });
    expect(notice()).toBeNull();

    // A later acknowledged save that keeps the same mention: no re-prompt.
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]), "3");
    await act(async () => {});
    expect(notice()).toBeNull();
    expect(candidateCalls()).toHaveLength(1);
  });

  it("a viewer without manage gets the ask-a-manager line and no share button", async () => {
    probe.admin = false;
    answerCandidates(() => [{ user_id: BLOCKED, display_name: "Bình", can_view: false }]);
    render(wrap(<Probe base={pageWith([])} initial={saveState({})} />));
    await save(pageWith([{ id: BLOCKED, label: "Bình" }]));
    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(notice()).toHaveTextContent("Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho Bình.");
    expect(screen.queryByTestId("document-body-mention-notice-share")).toBeNull();
  });
});

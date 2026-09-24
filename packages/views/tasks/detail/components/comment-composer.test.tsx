import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { CoreProvider, defaultStorage } from "@uniwork/core/platform";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import type { TaskComment, User } from "@uniwork/core/types";
import { requestMock, wrap } from "../../../test/api-mock";
import { TaskCommentComposer } from "./comment-composer";
import { TaskReplyComposer } from "./reply-composer";

// Same house-shape mock as timeline.test.tsx (a real textarea standing in
// for the TipTap editor, and a `useComposerSubmit` that mirrors the real
// onAccepted-only-on-success contract), plus one addition this file needs
// that the shared mock doesn't simulate: the real `ContentEditor` forwards
// `onUpdate` through its own internal `setTimeout`, sharing one timer ref
// across every doc change (typing AND `clearContent()`), even at
// `debounceMs={0}` (see content-editor.tsx's `onUpdate`/`clearContent`).
// `getMarkdown()` still reflects the live document immediately — only the
// *forward* to the host's `onUpdate` prop lags. Reproducing that gap is
// exactly what the "send accepts before the forward has fired" test below
// needs to exercise for real, deterministically, under fake timers.
vi.mock("../../../editor", () => {
  const ContentEditor = forwardRef(function MockContentEditor(
    {
      defaultValue = "",
      onUpdate,
      onReady,
      onSubmit,
      placeholder,
    }: {
      defaultValue?: string;
      onUpdate?: (md: string) => void;
      onReady?: () => void;
      onSubmit?: () => void;
      placeholder?: string;
    },
    ref,
  ) {
    const [value, setValue] = useState(defaultValue);
    const forwardTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const scheduleForward = (next: string) => {
      if (forwardTimerRef.current) clearTimeout(forwardTimerRef.current);
      forwardTimerRef.current = setTimeout(() => {
        forwardTimerRef.current = undefined;
        onUpdate?.(next);
      }, 0);
    };
    useImperativeHandle(ref, () => ({
      focus: () => {},
      getMarkdown: () => value,
      clearContent: () => {
        setValue("");
        scheduleForward("");
      },
      flushPendingUpdate: () => value,
      hasActiveUploads: () => false,
    }));
    queueMicrotask(() => onReady?.());
    return (
      <textarea
        aria-label={placeholder ?? "editor"}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          scheduleForward(e.target.value);
        }}
        onKeyDown={(e) => {
          // Mirrors the real Mod-Enter submit shortcut
          // (extensions/index.ts's createSubmitShortcutExtension): it goes
          // straight to the composer's `onSubmit` prop, bypassing the Send
          // button's own `isEmpty` gate entirely — which matters here
          // because `isEmpty` is itself only as fresh as the forwarded
          // `onUpdate` above.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            onSubmit?.();
          }
        }}
      />
    );
  });
  return {
    ContentEditor,
    useLazyEditor: ({
      editorRef,
      initialActive = false,
    }: {
      editorRef: { current: unknown };
      initialActive?: boolean;
    }) => {
      const [active, setActive] = useState(initialActive);
      const [ready, setReady] = useState(initialActive);
      return {
        active,
        ready,
        activate: () => {
          setActive(true);
          setReady(true);
          void editorRef;
        },
        onReady: () => setReady(true),
        uploadOrQueue: () => {},
      };
    },
    useUploadGate: () => ({
      uploading: false,
      onUploadingChange: () => {},
      isBlocked: () => false,
    }),
    useEditorUpload: () => ({ upload: vi.fn(), uploading: false }),
    useComposerSubmit: ({
      editorRef,
      onSubmit,
      onAccepted,
    }: {
      editorRef: { current: { getMarkdown?: () => string; clearContent?: () => void } | null };
      onSubmit: (content: string) => Promise<boolean>;
      onAccepted?: () => void;
    }) => {
      const [submitting, setSubmitting] = useState(false);
      return {
        submitting,
        submit: async () => {
          const md = editorRef.current?.getMarkdown?.() ?? "";
          if (!md.trim() || submitting) return;
          setSubmitting(true);
          try {
            const ok = await onSubmit(md);
            // The real `useComposerSubmit` never touches the editor —
            // clearing is the caller's job, done inside `onAccepted` and only
            // on the branch where nothing new was typed during the send. A
            // mock that clears here fires two clear echoes where production
            // fires one and pins a shape production does not have.
            if (ok) onAccepted?.();
          } finally {
            setSubmitting(false);
          }
        },
      };
    },
  };
});

const DRAFT_DEBOUNCE_MS = 1500;

function renderComposer(onSubmit: (body: string) => Promise<boolean>) {
  return render(
    wrap(<TaskCommentComposer taskId="t1" onSubmit={onSubmit} />),
  );
}

/** Same composer with CoreProvider so logout cleanup is wired like production. */
function renderComposerInApp(onSubmit: (body: string) => Promise<boolean>) {
  return render(
    wrap(
      <CoreProvider>
        <TaskCommentComposer taskId="t1" onSubmit={onSubmit} />
      </CoreProvider>,
    ),
  );
}

async function activate() {
  const standIn = screen.getByRole("button", {
    name: /viết bình luận|write a comment/i,
  });
  fireEvent.click(standIn);
  return screen.findByRole("textbox", {
    name: /viết bình luận|write a comment/i,
  });
}

async function activateAndType(text: string) {
  const editor = await activate();
  fireEvent.change(editor, { target: { value: text } });
  // Let the composer's own debounce commit the draft to the store.
  await waitFor(
    () => expect(useCommentDraftStore.getState().draftFor("t1")).toBe(text),
    { timeout: DRAFT_DEBOUNCE_MS + 2000 },
  );
}

/** Flush pending microtasks (e.g. a resolved `onSubmit` promise's
 * continuation) inside an `act()` boundary, without advancing fake timers —
 * the whole point of the two tests below is that the draft debounce timer
 * must still be pending when this settles. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeAll(() => {
  initI18n();
});

const me: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  useCommentDraftStore.setState({ drafts: {} });
});

// The editor AND `useComposerSubmit` are mocked in this file, so these only
// prove the composer routes the send key into `submit()` rather than around
// it. The real empty / in-flight / upload guards are pinned against the real
// hook in `editor/use-composer-submit.test.tsx`.
describe("TaskCommentComposer send key guards", () => {
  it("does not send when the editor is empty", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer(onSubmit);
    const editor = await activate();

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await flushMicrotasks();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send when the editor holds only whitespace", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer(onSubmit);
    const editor = await activate();

    fireEvent.change(editor, { target: { value: "  \n\t " } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await flushMicrotasks();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send a second time while the first send is in flight", async () => {
    const onSubmit = vi.fn(() => new Promise<boolean>(() => {}));
    renderComposer(onSubmit);
    const editor = await activate();

    fireEvent.change(editor, { target: { value: "một lần thôi" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await flushMicrotasks();
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await flushMicrotasks();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("TaskCommentComposer draft persistence", () => {
  it(
    "gửi thất bại: nháp vẫn còn trong store",
    { timeout: 10_000 },
    async () => {
      const onSubmit = vi.fn().mockResolvedValue(false);
      renderComposer(onSubmit);

      await activateAndType("đang gõ dở");
      expect(useCommentDraftStore.getState().draftFor("t1")).toBe(
        "đang gõ dở",
      );

      fireEvent.click(screen.getByRole("button", { name: /gửi|send/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());

      expect(useCommentDraftStore.getState().draftFor("t1")).toBe(
        "đang gõ dở",
      );
    },
  );

  it(
    "gửi thành công: nháp bị xoá",
    { timeout: 10_000 },
    async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      renderComposer(onSubmit);

      await activateAndType("sắp gửi");
      expect(useCommentDraftStore.getState().draftFor("t1")).toBe("sắp gửi");

      fireEvent.click(screen.getByRole("button", { name: /gửi|send/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());

      expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");
    },
  );

  it(
    "chấp nhận khi nháp còn đang debounce: nháp bị xoá và không quay lại",
    { timeout: 10_000 },
    async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      renderComposer(onSubmit);
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "đang gõ dở" } });
        // Debounce (1500ms) hasn't fired — nothing persisted yet.
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");

        // Mod-Enter, not the Send button: under fake timers the forwarded
        // onUpdate (and thus `isEmpty`) hasn't landed yet either, and the
        // button's own guard would no-op the click for a reason unrelated
        // to what this test targets.
        fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
        await flushMicrotasks();

        expect(onSubmit).toHaveBeenCalledWith("đang gõ dở");
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");

        // The pending write's timer must have been cancelled by accept, not
        // merely outrun — advancing past its original delay must not
        // resurrect the draft.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 100);
        });
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "gõ thêm trong lúc chờ máy chủ xác nhận: chữ mới sống sót thành nháp",
    { timeout: 10_000 },
    async () => {
      let resolveSubmit: (ok: boolean) => void = () => {};
      const onSubmit = vi.fn(
        () => new Promise<boolean>((resolve) => {
          resolveSubmit = resolve;
        }),
      );
      renderComposer(onSubmit);
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "đang gõ dở" } });
        fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
        await flushMicrotasks();
        expect(onSubmit).toHaveBeenCalledWith("đang gõ dở");

        // New content typed while the send is still in flight, before its
        // own debounce timer has a chance to fire.
        fireEvent.change(editor, {
          target: { value: "đang gõ dở thêm nữa" },
        });

        resolveSubmit(true);
        await flushMicrotasks();

        expect(useCommentDraftStore.getState().draftFor("t1")).toBe(
          "đang gõ dở thêm nữa",
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "quay lại công việc: nháp được khôi phục vào trong ô soạn, không chỉ nằm trong store",
    { timeout: 10_000 },
    async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      // A draft already on disk from a previous visit — exactly what the
      // persisted store hands back on remount.
      useCommentDraftStore.setState({ drafts: { t1: "nháp từ lần trước" } });

      renderComposer(onSubmit);

      // The real editor must be mounted with the draft in it, WITHOUT anyone
      // clicking the stand-in first. Every other draft test activates the
      // editor by hand, which is why this hole stayed open: the composer used
      // to render the static stand-in showing the placeholder, so the feature
      // showed no evidence of itself at all.
      const editor = await screen.findByRole("textbox", {
        name: /viết bình luận|write a comment/i,
      });
      expect(editor).toHaveValue("nháp từ lần trước");

      // ...and Send must actually send it. `isEmpty` was already seeded from
      // the draft, so the button looked enabled; with no editor mounted,
      // submit() read "" from the null ref, the empty guard returned, and the
      // click did nothing at all — no error, no feedback.
      fireEvent.click(screen.getByRole("button", { name: /gửi|send/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("nháp từ lần trước"));
      await waitFor(() =>
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe(""),
      );
    },
  );

  it(
    "gửi sạch nhưng lần gõ cuối chưa kịp forward: không phát sinh nháp ma",
    { timeout: 10_000 },
    async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      renderComposer(onSubmit);
      const editor = await activate();

      vi.useFakeTimers();
      try {
        // First keystroke: let its forward land (mirrors the mock's
        // setTimeout(0), even at debounceMs={0}), so `pendingDraftRef`
        // inside the composer settles at "đang gõ". This is the STALE
        // value the regression would compare against.
        fireEvent.change(editor, { target: { value: "đang gõ" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        // Final keystroke before Send: its forward has NOT landed yet
        // (fake timers, not advanced past this point) — the live document
        // is already "đang gõ dở", but `pendingDraftRef` still holds the
        // earlier, incomplete "đang gõ".
        fireEvent.change(editor, { target: { value: "đang gõ dở" } });

        // Mod-Enter, exactly as the coordinator's report describes this
        // being reachable — the Send button's `isEmpty` gate would also
        // still be stale here and is a separate concern from what this test
        // targets.
        fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
        await flushMicrotasks();

        // submit() reads the live editor directly, so the full, final text
        // — including the unforwarded last keystroke — was what actually
        // got sent...
        expect(onSubmit).toHaveBeenCalledWith("đang gõ dở");
        // ...and onAccepted must read that same live content to see
        // "everything on screen was sent", not fall back to the stale
        // (behind-live) "đang gõ" still sitting in `pendingDraftRef` and
        // write THAT back as a phantom draft — a ghost of an already-sent
        // comment reappearing in the box.
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");

        // Let the deferred forward — and clearContent()'s own echo, which
        // supersedes it on the shared timer, just like the real editor —
        // land, and confirm neither reintroduces a draft.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 200);
        });
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

const DRAFTS_KEY = "uniwork_task_comment_drafts";

async function logOut() {
  await act(async () => {
    await useAuthStore.getState().logout();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expectNoDraftAnywhere(key: string, text: string) {
  expect(useCommentDraftStore.getState().draftFor(key)).toBe("");
  expect(defaultStorage.getItem(DRAFTS_KEY) ?? "").not.toContain(text);
}

// The sidebar logs out with `await logout()` and only then `replace(login)`.
// Cleanup runs inside `logout`, so every write that lands after it — the
// unmount flush, the debounce timer, a send the server accepts late — would
// put the previous person's text back for the next person on this browser.
describe("TaskCommentComposer after logout", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue(undefined);
  });

  it(
    "rời trang sau khi đăng xuất lúc nháp còn đang debounce: nháp không quay lại bộ nhớ hay storage",
    { timeout: 10_000 },
    async () => {
      const view = renderComposerInApp(vi.fn().mockResolvedValue(true));
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "nháp của người A" } });
        await advance(0);
        // Forwarded to the composer; the 1500ms write is still pending.
        expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");

        await logOut();
        expect(defaultStorage.getItem(DRAFTS_KEY)).toBeNull();

        view.unmount();
        expectNoDraftAnywhere("t1", "nháp của người A");

        await advance(DRAFT_DEBOUNCE_MS + 100);
        expectNoDraftAnywhere("t1", "nháp của người A");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // Leaving is a route transition: the task page can stay mounted past the
  // debounce while the login route loads.
  it(
    "trang còn mở khi hết debounce sau đăng xuất: nháp không được ghi lại",
    { timeout: 10_000 },
    async () => {
      const view = renderComposerInApp(vi.fn().mockResolvedValue(true));
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "nháp của người A" } });
        await advance(0);

        await logOut();
        await advance(DRAFT_DEBOUNCE_MS + 100);
        expectNoDraftAnywhere("t1", "nháp của người A");

        view.unmount();
        expectNoDraftAnywhere("t1", "nháp của người A");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "gửi còn chờ máy chủ lúc đăng xuất rồi được nhận: chữ gõ thêm không thành nháp",
    { timeout: 10_000 },
    async () => {
      let resolveSubmit: (ok: boolean) => void = () => {};
      const onSubmit = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSubmit = resolve;
          }),
      );
      renderComposerInApp(onSubmit);
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "đã gửi" } });
        fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
        await flushMicrotasks();
        expect(onSubmit).toHaveBeenCalledWith("đã gửi");
        fireEvent.change(editor, { target: { value: "đã gửi và gõ thêm" } });

        await logOut();
        resolveSubmit(true);
        await flushMicrotasks();

        expectNoDraftAnywhere("t1", "gõ thêm");
        await advance(DRAFT_DEBOUNCE_MS + 100);
        expectNoDraftAnywhere("t1", "gõ thêm");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // Lives here rather than in reply-composer.test.tsx because it needs this
  // file's editor mock; the reply box is this same composer under another key.
  it(
    "ô trả lời: rời trang sau khi đăng xuất lúc nháp còn đang debounce không để lại nháp trả lời",
    { timeout: 10_000 },
    async () => {
      const parent: TaskComment = {
        id: "r1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        display_name: "Ngọc",
        body: "Câu gốc",
        type: "comment",
        revision: 1,
        reactions: [],
      };
      const view = render(
        wrap(
          <CoreProvider>
            <TaskReplyComposer
              taskId="t1"
              parent={parent}
              onSubmit={vi.fn().mockResolvedValue(true)}
              onCancel={() => {}}
            />
          </CoreProvider>,
        ),
      );
      const editor = await activate();

      vi.useFakeTimers();
      try {
        fireEvent.change(editor, { target: { value: "trả lời của người A" } });
        await advance(0);

        await logOut();
        view.unmount();
        expectNoDraftAnywhere("t1:r1", "trả lời của người A");

        await advance(DRAFT_DEBOUNCE_MS + 100);
        expectNoDraftAnywhere("t1:r1", "trả lời của người A");
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

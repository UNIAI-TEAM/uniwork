import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import { wrap } from "../../../test/api-mock";
import { TaskCommentComposer } from "./comment-composer";

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
            if (ok) {
              editorRef.current?.clearContent?.();
              onAccepted?.();
            }
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

beforeEach(() => {
  useCommentDraftStore.setState({ drafts: {} });
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

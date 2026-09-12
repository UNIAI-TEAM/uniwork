import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import { wrap } from "../../../test/api-mock";
import { TaskCommentComposer } from "./comment-composer";

// Same house-shape mock as timeline.test.tsx: a real textarea standing in for
// the TipTap editor, and a `useComposerSubmit` that mirrors the real
// onAccepted-only-on-success contract.
vi.mock("../../../editor", () => {
  const ContentEditor = forwardRef(function MockContentEditor(
    {
      defaultValue = "",
      onUpdate,
      onReady,
      placeholder,
    }: {
      defaultValue?: string;
      onUpdate?: (md: string) => void;
      onReady?: () => void;
      placeholder?: string;
    },
    ref,
  ) {
    const [value, setValue] = useState(defaultValue);
    useImperativeHandle(ref, () => ({
      focus: () => {},
      getMarkdown: () => value,
      clearContent: () => setValue(""),
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
          onUpdate?.(e.target.value);
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

        fireEvent.click(screen.getByRole("button", { name: /gửi|send/i }));
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
        fireEvent.click(screen.getByRole("button", { name: /gửi|send/i }));
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
});

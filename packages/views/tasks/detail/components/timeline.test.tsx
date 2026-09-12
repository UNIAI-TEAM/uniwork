import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { AuditEvent, TaskComment, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailTimeline } from "./timeline";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const createMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "c-new",
    task_id: "t1",
    author_id: "u1",
    body: "Hello timeline",
    created_at: "2026-09-09T00:00:00Z",
  }),
);

const mockUseComments = vi.hoisted(() =>
  vi.fn(() => ({
    data: [
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        display_name: "Me",
        body: "Existing note",
        type: "comment",
        revision: 0,
        created_at: "2026-09-01T00:00:00Z",
        reactions: [],
      },
    ] as TaskComment[],
    isLoading: false,
    isError: false,
  })),
);

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useComments: mockUseComments,
    useCreateCommentSuite: () => ({
      mutateAsync: createMutateAsync,
      isPending: false,
    }),
    useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteComment: () => ({ mutate: vi.fn(), isPending: false }),
    useResolveComment: () => ({ mutate: vi.fn(), isPending: false }),
    useUnresolveComment: () => ({ mutate: vi.fn(), isPending: false }),
    useAddCommentReaction: () => ({ mutate: vi.fn(), isPending: false }),
    useRemoveCommentReaction: () => ({ mutate: vi.fn(), isPending: false }),
    useTaskSubscribers: () => ({ data: [], isLoading: false }),
    useSubscribeTask: () => ({ mutate: vi.fn(), isPending: false }),
    useUnsubscribeTask: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const useResourceHistoryMock = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as AuditEvent[] })),
);

vi.mock("@uniwork/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/audit")>();
  return {
    ...actual,
    useResourceHistory: useResourceHistoryMock,
  };
});

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({
    data: {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {
        "tasks.agent_runs": {
          status: "unavailable",
          reason_code: "agent_runtime_missing",
          explanation_key: "capabilities.agent_runtime_missing",
        },
        "tasks.vcs": {
          status: "unavailable",
          reason_code: "vcs_provider_missing",
          explanation_key: "capabilities.vcs_provider_missing",
        },
      },
    },
  }),
}));

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
    // Mount-ready on first paint so lazy hosts can swap in.
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
    ReadonlyContent: ({ content }: { content: string }) => <div>{content}</div>,
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

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

function shell(ui: ReactNode) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

function mockComments(comments: TaskComment[]) {
  mockUseComments.mockReturnValue({
    data: comments,
    isLoading: false,
    isError: false,
  });
}

function mockResourceHistory(events: AuditEvent[]) {
  useResourceHistoryMock.mockReturnValue({ data: events });
}

function renderTimeline({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  return render(
    shell(<TaskDetailTimeline workspaceId={workspaceId} taskId={taskId} />),
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  createMutateAsync.mockClear();
  window.history.replaceState(null, "", "/");
  mockComments([
    {
      id: "c1",
      task_id: "t1",
      author_id: "u1",
      author_kind: "human",
      display_name: "Me",
      body: "Existing note",
      type: "comment",
      revision: 0,
      created_at: "2026-09-01T00:00:00Z",
      reactions: [],
    },
  ]);
  mockResourceHistory([]);
});

describe("TaskDetailTimeline", () => {
  it("compose comment calls create suite mutation", async () => {
    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.getByText("Existing note")).toBeInTheDocument();

    const standIn = screen.getByRole("button", {
      name: /viết bình luận|write a comment/i,
    });
    fireEvent.click(standIn);

    const editor = await screen.findByRole("textbox", {
      name: /viết bình luận|write a comment/i,
    });
    fireEvent.change(editor, { target: { value: "Hello timeline" } });

    fireEvent.click(
      screen.getByRole("button", { name: /gửi|send|đăng|post/i }),
    );

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalled();
    });
    expect(createMutateAsync.mock.calls[0]?.[0]).toMatchObject({
      body: { body: "Hello timeline" },
    });
  });

  it("does not mount AgentRun or pull-request chrome on the timeline", () => {
    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.queryByTestId("task-detail-runtime-stubs")).toBeNull();
    expect(screen.queryByTestId("task-detail-agent-run-panel")).toBeNull();
    expect(screen.queryByTestId("task-detail-pull-requests")).toBeNull();
  });

  it("trộn hoạt động từ nhật ký với bình luận theo thứ tự thời gian", async () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận sau",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([
      {
        id: "a1",
        organization_id: "o1",
        actor_kind: "human",
        actor_id: "u1",
        action: "task.updated",
        resource_type: "task",
        resource_id: "t1",
        changes: { status: { from: "todo", to: "in_progress" } },
        metadata: {},
        correlation_id: "x",
        occurred_at: "2026-09-12T09:00:00Z",
      },
    ]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    const rows = await screen.findAllByTestId(
      /^task-timeline-(comment|activity)-/,
    );
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "task-timeline-activity-a1",
      "task-timeline-comment-c1",
    ]);
  });

  it("không hiện dòng giải thích hoạt động chưa khả dụng nữa", () => {
    mockComments([]);
    mockResourceHistory([]);
    renderTimeline({ workspaceId: "w1", taskId: "t1" });
    expect(screen.queryByText(/chưa khả dụng/i)).not.toBeInTheDocument();
  });
});

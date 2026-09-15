import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Profiler,
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import { useTaskDetailUiStore } from "@uniwork/core/tasks/stores/task-detail-ui-store";
import type {
  Agent,
  AuditEvent,
  Member,
  TaskComment,
  TaskSubscriber,
  User,
  Workspace,
} from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskFindQueryContext } from "../find/find-query-context";
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
const addReactionMutate = vi.hoisted(() => vi.fn());
const removeReactionMutate = vi.hoisted(() => vi.fn());

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

const mockUseTaskSubscribers = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as TaskSubscriber[], isLoading: false })),
);
const mockUseMembers = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as Member[] })),
);
const mockUseWorkspaceAgents = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as Agent[] })),
);

vi.mock("@uniwork/core/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/workspaces")>();
  return { ...actual, useMembers: mockUseMembers };
});

vi.mock("@uniwork/core/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/agents")>();
  return { ...actual, useWorkspaceAgents: mockUseWorkspaceAgents };
});

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
    useAddCommentReaction: () => ({ mutate: addReactionMutate, isPending: false }),
    useRemoveCommentReaction: () => ({ mutate: removeReactionMutate, isPending: false }),
    useTaskSubscribers: mockUseTaskSubscribers,
    useTaskAttachments: () => ({ data: [], isLoading: false }),
    useUploadTaskAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSubscribeTask: () => ({ mutate: vi.fn(), isPending: false }),
    useUnsubscribeTask: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const useResourceHistoryMock = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as AuditEvent[], isError: false })),
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

function mockResourceHistory(events: AuditEvent[], isError = false) {
  useResourceHistoryMock.mockReturnValue({ data: events, isError });
}

function auditEvent(over: Partial<AuditEvent> & { id: string }): AuditEvent {
  return {
    organization_id: "o1",
    actor_kind: "human",
    actor_id: "u1",
    action: "task.updated",
    resource_type: "task",
    resource_id: "t1",
    changes: {},
    metadata: {},
    correlation_id: "x",
    occurred_at: "2026-09-12T09:00:00Z",
    ...over,
  };
}

function renderTimeline({
  workspaceId,
  taskId,
  findQuery,
}: {
  workspaceId: string;
  taskId: string;
  findQuery?: string;
}) {
  const timeline = <TaskDetailTimeline workspaceId={workspaceId} taskId={taskId} />;
  // Only find cases pass a query. The rest render the exact tree they always
  // did, so a case that later rerenders the bare timeline keeps the same tree
  // instead of remounting it.
  return render(
    shell(
      findQuery === undefined ? (
        timeline
      ) : (
        <TaskFindQueryContext.Provider value={findQuery}>{timeline}</TaskFindQueryContext.Provider>
      ),
    ),
  );
}

beforeAll(() => {
  initI18n();
});

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  resetAuthStoreForTests();
  setSessionUser(me);
  createMutateAsync.mockClear();
  addReactionMutate.mockClear();
  removeReactionMutate.mockClear();
  // Drafts are a module singleton: a leftover draft from another case would
  // now auto-activate a composer (initialActive) and change what renders.
  useCommentDraftStore.setState({ drafts: {} });
  // Expanded resolved threads are remembered per task in a module singleton.
  useTaskDetailUiStore.setState({ tasks: {} });
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
  mockUseTaskSubscribers.mockReturnValue({ data: [], isLoading: false });
  mockUseMembers.mockReturnValue({ data: [] });
  mockUseWorkspaceAgents.mockReturnValue({ data: [] });
});

describe("TaskDetailTimeline", () => {
  it("toggle reaction dựa trên trạng thái hiện tại, không dùng lỗi add để suy ra remove", () => {
    mockComments([{ ...mockUseComments().data[0]!, reactions: [
      { id: "r1", comment_id: "c1", actor_type: "member", actor_id: "u1", emoji: "👍", created_at: "2026-09-15T00:00:00Z" },
      { id: "r2", comment_id: "c1", actor_type: "member", actor_id: "u2", emoji: "❤️", created_at: "2026-09-15T00:00:01Z" },
    ] }]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: /👍 1:/ }));
    fireEvent.click(screen.getByRole("button", { name: /❤️ 1:/ }));

    expect(removeReactionMutate).toHaveBeenCalledWith(
      { commentId: "c1", emoji: "👍" },
      expect.any(Object),
    );
    expect(addReactionMutate).toHaveBeenCalledWith(
      { commentId: "c1", emoji: "❤️" },
      expect.any(Object),
    );
  });

  it("shows real follower avatars beside the follow action and caps the visible group", () => {
    mockUseTaskSubscribers.mockReturnValue({
      data: [
        { task_id: "t1", actor_type: "member", actor_id: "u1", reason: "manual", created_at: "2026-09-15T00:00:00Z" },
        { task_id: "t1", actor_type: "member", actor_id: "u2", reason: "assignee", created_at: "2026-09-15T00:00:01Z" },
        { task_id: "t1", actor_type: "agent", actor_id: "a1", reason: "manual", created_at: "2026-09-15T00:00:02Z" },
        { task_id: "t1", actor_type: "member", actor_id: "u3", reason: "manual", created_at: "2026-09-15T00:00:03Z" },
        { task_id: "t1", actor_type: "member", actor_id: "u4", reason: "manual", created_at: "2026-09-15T00:00:04Z" },
      ],
      isLoading: false,
    });
    mockUseMembers.mockReturnValue({
      data: [
        { workspace_id: "w1", user_id: "u1", role: "member", email: "me@x.com", display_name: "Me", avatar_url: "/avatars/me.png" },
        { workspace_id: "w1", user_id: "u2", role: "member", email: "lan@x.com", display_name: "Lan", avatar_url: "/avatars/lan.png" },
        { workspace_id: "w1", user_id: "u3", role: "member", email: "minh@x.com", display_name: "Minh", avatar_url: "/avatars/minh.png" },
        { workspace_id: "w1", user_id: "u4", role: "member", email: "hoa@x.com", display_name: "Hoa", avatar_url: "/avatars/hoa.png" },
      ],
    });
    mockUseWorkspaceAgents.mockReturnValue({
      data: [
        { id: "a1", organization_id: "o1", name: "Agent 17", handle: "agent-17", description: "", avatar_url: "/avatars/agent-17.png", status: "active", owner_user_id: "u1" },
      ],
    });

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    const followers = screen.getByLabelText(
      "Người theo dõi: Me, Lan, Agent 17, Minh, Hoa",
    );
    expect(within(followers).getByRole("img", { name: "Me" })).toHaveAttribute(
      "src",
      "/avatars/me.png",
    );
    expect(within(followers).getByRole("img", { name: "Agent 17" })).toHaveAttribute(
      "src",
      "/avatars/agent-17.png",
    );
    expect(within(followers).getAllByRole("img")).toHaveLength(4);
    expect(within(followers).getByText("+1")).toBeInTheDocument();
  });

  it("compose comment calls create suite mutation", async () => {
    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.getByText("Existing note")).toBeInTheDocument();

    const dock = screen.getByTestId("task-comment-composer-dock");
    const standIn = within(dock).getByRole("button", {
      name: /viết bình luận|write a comment/i,
    });
    fireEvent.click(standIn);

    const editor = await screen.findByRole("textbox", {
      name: /viết bình luận|write a comment/i,
    });
    fireEvent.change(editor, { target: { value: "Hello timeline" } });

    fireEvent.click(
      within(dock).getByRole("button", { name: /gửi|send|đăng|post/i }),
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

  it("dòng đầu của một công việc nói là đã tạo, không phải đã đổi một loạt trường", async () => {
    mockComments([]);
    mockResourceHistory([
      auditEvent({
        id: "a1",
        action: "task.created",
        changes: { title: { to: "Viết đặc tả" }, status: { to: "todo" } },
      }),
    ]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    const row = await screen.findByTestId("task-timeline-activity-a1");
    expect(row).toHaveTextContent("Tạo việc");
    expect(row).not.toHaveTextContent("Cập nhật việc");
  });

  it("không thêm dòng hoạt động cho bình luận và reaction vì thẻ bình luận đã kể", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([
      auditEvent({ id: "a1", action: "task.comment_added" }),
      auditEvent({ id: "a2", action: "comment.reaction_added" }),
      auditEvent({ id: "a3", action: "task.subscribed" }),
    ]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.queryByTestId("task-timeline-activity-a1")).toBeNull();
    expect(screen.queryByTestId("task-timeline-activity-a2")).toBeNull();
    expect(screen.queryByTestId("task-timeline-activity-a3")).toBeNull();
    expect(screen.getByTestId("task-timeline-comment-c1")).toBeInTheDocument();
  });

  it("hành động lạ từ server mới vẫn hiện nguyên tên, không biến mất", async () => {
    mockComments([]);
    mockResourceHistory([
      auditEvent({ id: "a9", action: "task.archived_by_a_newer_server" }),
    ]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(await screen.findByTestId("task-timeline-activity-a9")).toHaveTextContent(
      "task.archived_by_a_newer_server",
    );
  });

  it("hoạt động lỗi hiện dòng lỗi riêng, không giả làm chưa có gì", () => {
    mockComments([]);
    mockResourceHistory([], true);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(
      screen.getByTestId("task-timeline-activity-error"),
    ).toHaveTextContent(/không tải được hoạt động/i);
    expect(screen.queryByText("Chưa có bình luận.")).toBeNull();
  });

  it("không hiện dòng giải thích hoạt động chưa khả dụng nữa", () => {
    mockComments([]);
    mockResourceHistory([]);
    renderTimeline({ workspaceId: "w1", taskId: "t1" });
    expect(screen.queryByText(/chưa khả dụng/i)).not.toBeInTheDocument();
  });

  it("gấp luồng đã giải quyết thành một dòng, ẩn nội dung bên trong", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c1",
        body: "trả lời trong luồng đã giải quyết",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.getByTestId("resolved-thread-bar")).toBeInTheDocument();
    expect(screen.queryByText("bình luận gốc")).not.toBeInTheDocument();
    expect(
      screen.queryByText("trả lời trong luồng đã giải quyết"),
    ).not.toBeInTheDocument();
  });

  it("bấm vào thanh gấp mở luồng đã giải quyết ra", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    fireEvent.click(screen.getByTestId("resolved-thread-bar"));
    expect(screen.getByText("bình luận gốc")).toBeInTheDocument();
  });

  it("mở link đến một bình luận trong luồng đã giải quyết thì tự mở luồng ra", async () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c1",
        body: "trả lời được liên kết tới",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);
    window.history.replaceState(null, "", "/#comment-c2");

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(
      await screen.findByText("trả lời được liên kết tới"),
    ).toBeInTheDocument();
  });

  it("giữ ô soạn bình luận dính đáy khi cuộn", () => {
    mockComments([]);
    mockResourceHistory([]);
    renderTimeline({ workspaceId: "w1", taskId: "t1" });
    expect(screen.getByTestId("task-comment-composer-dock")).toHaveClass(
      "sticky",
    );
  });

  it("bấm chip điều hướng luồng thì cuộn tới và mở luồng đã giải quyết đó", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng một",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng hai đã giải quyết",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
      {
        id: "c3",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c2",
        body: "trả lời trong luồng hai",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:02:00Z",
        reactions: [],
      },
      {
        id: "c4",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng ba",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:03:00Z",
        reactions: [],
      },
      {
        id: "c5",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng bốn",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:04:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.queryByText("trả lời trong luồng hai")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("thread-nav-c2"));

    expect(screen.getByText("trả lời trong luồng hai")).toBeInTheDocument();
  });

  it("trả lời từ giao diện gửi kèm parent_id của bình luận gốc", async () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        display_name: "Me",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    const replyBox = await screen.findByTestId("reply-composer-c1");
    fireEvent.click(
      within(replyBox).getByRole("button", {
        name: /viết bình luận|write a comment/i,
      }),
    );
    const replyEditor = await within(replyBox).findByRole("textbox", {
      name: /viết bình luận|write a comment/i,
    });
    fireEvent.change(replyEditor, { target: { value: "trả lời của tôi" } });
    fireEvent.click(
      within(replyBox).getByRole("button", { name: /gửi|send/i }),
    );

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    // The whole point of the slice: the reply must reach the server as a
    // reply, not as another root comment.
    expect(createMutateAsync.mock.calls[0]?.[0]).toMatchObject({
      body: { body: "trả lời của tôi", parent_id: "c1" },
    });
  });

  it("một trả lời hiện lồng dưới bình luận gốc của nó", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c1",
        body: "trả lời lồng bên trong",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    // One timeline row, not two: the reply is inside its root's row.
    const rows = screen.getAllByTestId(/^task-timeline-comment-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "task-timeline-comment-c1",
    ]);
    const row = screen.getByTestId("task-timeline-comment-c1");
    expect(
      within(row).getByTestId("task-comment-c2"),
    ).toBeInTheDocument();
    // ...and the reply has no reply affordance of its own (one level deep).
    expect(screen.queryByTestId("comment-reply-c2")).toBeNull();
  });

  it("gấp lại luồng vừa nhảy tới thì nó ở yên, không bật mở lại", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng một",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng hai đã giải quyết",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
      {
        id: "c3",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c2",
        body: "trả lời trong luồng hai",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:02:00Z",
        reactions: [],
      },
      {
        id: "c4",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng ba",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:03:00Z",
        reactions: [],
      },
      {
        id: "c5",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng bốn",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:04:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    fireEvent.click(screen.getByTestId("thread-nav-c2"));
    expect(screen.getByText("trả lời trong luồng hai")).toBeInTheDocument();

    // Closing the bar must stick. While the scroll request was still
    // "active", the expandedResolved change re-ran the scroll effect, which
    // found the thread resolved-and-collapsed and re-expanded it.
    fireEvent.click(screen.getByTestId("resolved-thread-bar"));

    expect(screen.queryByText("trả lời trong luồng hai")).not.toBeInTheDocument();
    // The root card too, not just the reply — only the collapsed bar remains.
    // (The thread-nav chip still carries the root's preview text, so assert on
    // the card's testid rather than on the words.)
    expect(screen.queryByTestId("task-comment-c2")).toBeNull();
  });

  it("một lần tải lại bình luận không cuộn và tô sáng lại mục cũ trong hash", async () => {
    const comments: TaskComment[] = [
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "mục được liên kết",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
    ];
    mockComments(comments);
    mockResourceHistory([]);
    window.history.replaceState(null, "", "/#comment-c1");

    const { rerender } = renderTimeline({ workspaceId: "w1", taskId: "t1" });
    await waitFor(() =>
      expect(screen.getByTestId("task-comment-c1")).toBeInTheDocument(),
    );

    // A refetch gives `threads` a new identity — posting a comment or
    // toggling a reaction does exactly this. The honoured scroll request must
    // already be retired, or every refetch re-fires the jump.
    mockComments([...comments]);
    rerender(
      shell(<TaskDetailTimeline workspaceId="w1" taskId="t1" />),
    );

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledTimes(1),
    );
  });

  describe("ghi nhớ luồng đã giải quyết đang mở", () => {
    const resolvedThread: TaskComment[] = [
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "bình luận gốc",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        resolved_at: "2026-09-12T10:05:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        parent_id: "c1",
        body: "trả lời bên trong",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        reactions: [],
      },
    ];

    it("mở một luồng, rời trang rồi quay lại cùng task thì luồng vẫn mở", () => {
      mockComments(resolvedThread);
      const first = renderTimeline({ workspaceId: "w1", taskId: "t1" });
      fireEvent.click(screen.getByTestId("resolved-thread-bar"));
      expect(screen.getByText("trả lời bên trong")).toBeInTheDocument();
      first.unmount();

      renderTimeline({ workspaceId: "w1", taskId: "t1" });

      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByText("trả lời bên trong")).toBeInTheDocument();
    });

    it("một task khác không thừa hưởng luồng đang mở", () => {
      mockComments(resolvedThread);
      const first = renderTimeline({ workspaceId: "w1", taskId: "t1" });
      fireEvent.click(screen.getByTestId("resolved-thread-bar"));
      first.unmount();

      // Same comment ids under another task id: only the task id separates them.
      renderTimeline({ workspaceId: "w1", taskId: "t2" });

      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.queryByText("trả lời bên trong")).not.toBeInTheDocument();
    });

    it("link tới bình luận vẫn mở luồng mà người dùng đã gấp lại lần trước", async () => {
      mockComments(resolvedThread);
      const first = renderTimeline({ workspaceId: "w1", taskId: "t1" });
      const bar = screen.getByTestId("resolved-thread-bar");
      fireEvent.click(bar);
      fireEvent.click(bar);
      expect(screen.queryByText("trả lời bên trong")).not.toBeInTheDocument();
      first.unmount();

      window.history.replaceState(null, "", "/#comment-c2");
      renderTimeline({ workspaceId: "w1", taskId: "t1" });

      expect(await screen.findByText("trả lời bên trong")).toBeInTheDocument();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    });

    it("thay đổi ghi nhớ của task khác không render lại timeline này", async () => {
      mockComments(resolvedThread);
      window.history.replaceState(null, "", "/#comment-c2");
      let commits = 0;
      render(
        shell(
          <Profiler id="timeline" onRender={() => { commits += 1; }}>
            <TaskDetailTimeline workspaceId="w1" taskId="t1" />
          </Profiler>,
        ),
      );
      // Hash expands the thread, scrolls, then retires the request.
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      const settled = commits;

      act(() => {
        useTaskDetailUiStore.getState().setResolvedExpanded("t2", "other", true);
        useTaskDetailUiStore.getState().setSubtasksCollapsed("t2", true);
      });

      expect(commits).toBe(settled);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    // In-page find opens matching resolved threads through a temporary set,
    // not the store. Collapsing one of those must still work, and must not
    // be remembered either way.
    it("gấp một luồng đang mở vì tìm thì nó gấp lại mà không ghi vào bộ nhớ; mở lại bằng tay thì được nhớ", () => {
      mockComments(resolvedThread);
      renderTimeline({ workspaceId: "w1", taskId: "t1", findQuery: "BÊN TRONG" });
      const bar = screen.getByTestId("resolved-thread-bar");
      expect(bar).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("trả lời bên trong")).toBeInTheDocument();

      fireEvent.click(bar);

      expect(bar).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("trả lời bên trong")).not.toBeInTheDocument();
      expect(useTaskDetailUiStore.getState().tasks).toEqual({});

      fireEvent.click(bar);

      expect(screen.getByText("trả lời bên trong")).toBeInTheDocument();
      expect(useTaskDetailUiStore.getState().tasks.t1?.resolvedExpanded).toEqual(["c1"]);
    });

    it("tìm chỉ mở luồng đã giải quyết có bình luận khớp, không đụng luồng không khớp", () => {
      mockComments(resolvedThread);
      renderTimeline({ workspaceId: "w1", taskId: "t1", findQuery: "không có ở đây" });

      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("trả lời bên trong")).not.toBeInTheDocument();
    });

    // A body stored decomposed (NFD) must match a query typed composed (NFC).
    it("truy vấn gõ dạng NFC mở luồng có bình luận lưu dạng NFD", () => {
      const decomposed = "Biểu mẫu đã duyệt".normalize("NFD");
      mockComments(
        resolvedThread.map((comment) =>
          comment.id === "c2" ? { ...comment, body: decomposed } : comment,
        ),
      );
      renderTimeline({ workspaceId: "w1", taskId: "t1", findQuery: "biểu mẫu".normalize("NFC") });

      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(decomposed)).toBeInTheDocument();
    });
  });

  it("không hiện bảng điều hướng luồng khi có ba luồng trở xuống", () => {
    mockComments([
      {
        id: "c1",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng một",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:00:00Z",
        reactions: [],
      },
      {
        id: "c2",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng hai",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:01:00Z",
        reactions: [],
      },
      {
        id: "c3",
        task_id: "t1",
        author_id: "u1",
        author_kind: "human",
        body: "luồng ba",
        type: "comment",
        revision: 0,
        created_at: "2026-09-12T10:02:00Z",
        reactions: [],
      },
    ]);
    mockResourceHistory([]);

    renderTimeline({ workspaceId: "w1", taskId: "t1" });

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

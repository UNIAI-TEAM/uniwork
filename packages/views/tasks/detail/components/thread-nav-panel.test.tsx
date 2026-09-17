import { useState, type ReactElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  createShortcutChord,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import type { TaskComment } from "@uniwork/core/types";
import { ThreadNavPanel } from "./thread-nav-panel";
import type { ThreadNavThread } from "./thread-nav-helpers";

initI18n();

type OpenChange = (open: boolean, details: { reason: string }) => void;

const mockState = vi.hoisted(() => ({
  open: false,
  triggerProps: undefined as Record<string, unknown> | undefined,
  onOpenChange: undefined as OpenChange | undefined,
}));

vi.mock("./task-actor-avatar", () => ({
  TaskActorAvatar: ({ name }: { name: string }) => (
    <span data-testid={`avatar-${name}`} />
  ),
}));

vi.mock("@uniwork/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
}));

vi.mock("@uniwork/ui/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: OpenChange;
    }) => {
      mockState.open = open;
      mockState.onOpenChange = onOpenChange;
      return <div data-testid="popover">{children}</div>;
    },
    PopoverTrigger: ({
      render,
      children,
      ...props
    }: {
      render: React.ReactElement;
      children: React.ReactNode;
    } & Record<string, unknown>) => {
      mockState.triggerProps = props;
      return React.cloneElement(
        render as React.ReactElement<Record<string, unknown>>,
        {
          onClick: () =>
            mockState.onOpenChange?.(!mockState.open, { reason: "trigger-press" }),
        },
        children,
      );
    },
    PopoverContent: ({
      children,
      onKeyDown,
      onFocusCapture,
      ...rest
    }: {
      children: React.ReactNode;
      onKeyDown?: React.KeyboardEventHandler;
      onFocusCapture?: React.FocusEventHandler;
    } & Record<string, unknown>) =>
      mockState.open ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- PopoverContent stand-in; forwards key/focus handlers under test
        <div
          role="dialog"
          tabIndex={-1}
          data-testid={
            typeof rest["data-testid"] === "string"
              ? rest["data-testid"]
              : "panel"
          }
          onKeyDown={onKeyDown}
          onFocusCapture={onFocusCapture}
        >
          {children}
        </div>
      ) : null,
  };
});

function comment(
  id: string,
  body: string,
  overrides: Partial<TaskComment> = {},
): TaskComment {
  return {
    id,
    task_id: "t1",
    author_id: "u1",
    author_kind: "human",
    body,
    type: "comment",
    revision: 0,
    created_at: new Date().toISOString(),
    reactions: [],
    ...overrides,
  };
}

function thread(
  id: string,
  body: string,
  overrides: Partial<ThreadNavThread> = {},
): ThreadNavThread {
  return {
    id,
    entry: comment(id, body),
    resolved: false,
    replyCount: 0,
    involvesMe: false,
    ...overrides,
  };
}

const THREADS: ThreadNavThread[] = [
  thread("t1", "Invite links require a workspace first"),
  thread("t2", "Move the required check into the service layer", { replyCount: 3 }),
  thread("t3", "Expiry: 7 days or 14 days?", { resolved: true }),
  thread("t4", "Mail template CTA collapses in Outlook", { involvesMe: true }),
];

function Harness({
  threads = THREADS,
  onJump = vi.fn(),
  onHoverThread = vi.fn(),
}: {
  threads?: ThreadNavThread[];
  onJump?: (id: string) => void;
  onHoverThread?: (id: string | null) => void;
}) {
  const [state, setState] = useState({ open: false, pinned: false });
  return (
    <ThreadNavPanel
      threads={threads}
      onJump={onJump}
      onHoverThread={onHoverThread}
      open={state.open}
      pinned={state.pinned}
      onOpenChange={(open, pinned) => setState({ open, pinned })}
      getActorName={(_kind, id) => (id === "u1" ? "Me" : id)}
    />
  );
}

function emit(open: boolean, reason: string) {
  act(() => {
    mockState.onOpenChange?.(open, { reason });
  });
}

beforeEach(() => {
  mockState.open = false;
  mockState.triggerProps = undefined;
  mockState.onOpenChange = undefined;
  useShortcutStore.getState().resetAll();
});

afterEach(cleanup);

describe("ThreadNavPanel", () => {
  it("renders nothing when the task has no threads", () => {
    render(<Harness threads={[]} />);
    expect(screen.queryByTestId("task-thread-nav-trigger")).toBeNull();
  });

  it("shows the thread count on the trigger", () => {
    render(<Harness />);
    expect(screen.getByTestId("task-thread-nav-trigger")).toHaveTextContent("4");
  });

  it("re-renders the shortcut hint when the binding changes", () => {
    render(<Harness />);
    const keys = () =>
      [...screen.getByTestId("tooltip").querySelectorAll("kbd")]
        .map((k) => k.textContent?.trim())
        .join("");
    expect(keys()).toContain("O");

    act(() => {
      useShortcutStore
        .getState()
        .setShortcut("openThreadNav", createShortcutChord("G", { primary: true, shift: true }));
    });
    expect(keys()).toContain("G");
    expect(keys()).not.toContain("O");

    act(() => {
      useShortcutStore.getState().setShortcut("openThreadNav", null);
    });
    expect(screen.getByTestId("tooltip").querySelectorAll("kbd")).toHaveLength(0);
  });

  it("wires the trigger to open on hover, not only on press", () => {
    render(<Harness />);
    expect(mockState.triggerProps?.openOnHover).toBe(true);
    expect(mockState.triggerProps?.delay).toBeGreaterThan(0);
    expect(mockState.triggerProps?.closeDelay).toBeGreaterThan(0);
  });

  it("lists every thread once open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
    expect(screen.getByTestId("task-thread-nav-panel")).toBeInTheDocument();
    expect(screen.getByText("Invite links require a workspace first")).toBeInTheDocument();
    expect(screen.getByText("Expiry: 7 days or 14 days?")).toBeInTheDocument();
  });

  it("focuses search when opened by a press", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
    const search = screen.getByPlaceholderText(/search threads|tìm luồng/i);
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  describe("hover previews, press pins", () => {
    it("does not take focus when opened by hover", async () => {
      render(<Harness />);
      const before = document.activeElement;
      emit(true, "trigger-hover");
      expect(screen.getByTestId("task-thread-nav-panel")).toBeInTheDocument();
      await waitFor(() => {
        expect(document.activeElement).toBe(before);
      });
    });

    it("closes again when the pointer leaves an unpinned preview", () => {
      render(<Harness />);
      emit(true, "trigger-hover");
      emit(false, "trigger-hover");
      expect(screen.queryByTestId("task-thread-nav-panel")).toBeNull();
    });

    it("pins instead of closing when the trigger is pressed over a preview", async () => {
      render(<Harness />);
      emit(true, "trigger-hover");
      emit(false, "trigger-press");
      expect(screen.getByTestId("task-thread-nav-panel")).toBeInTheDocument();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByPlaceholderText(/search threads|tìm luồng/i),
        ),
      );
    });

    it("survives the pointer leaving once pinned", () => {
      render(<Harness />);
      fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
      emit(false, "trigger-hover");
      expect(screen.getByTestId("task-thread-nav-panel")).toBeInTheDocument();
    });

    it("closes a pinned panel on a second press", () => {
      render(<Harness />);
      fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
      fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
      expect(screen.queryByTestId("task-thread-nav-panel")).toBeNull();
    });
  });

  it("jumps and closes when a row is clicked", () => {
    const onJump = vi.fn();
    render(<Harness onJump={onJump} />);
    fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
    fireEvent.click(screen.getByTestId("thread-nav-t2"));
    expect(onJump).toHaveBeenCalledWith("t2");
    expect(screen.queryByTestId("task-thread-nav-panel")).toBeNull();
  });

  it("filters to unresolved threads", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("task-thread-nav-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /unresolved|chưa giải quyết/i }));
    expect(screen.getByTestId("thread-nav-t1")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-nav-t3")).toBeNull();
  });
});

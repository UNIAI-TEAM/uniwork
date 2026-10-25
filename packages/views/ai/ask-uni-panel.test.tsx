import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { user, workspace } from "./ask-uni-fixtures";
import { AskUniPanel } from "./ask-uni-panel";

initI18n();

// Only the switch between screens is under test, so the heavy children are stubs.
const askMock = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/ai/stream", () => ({ useAskUniStream: () => ({ state: { status: "idle" }, ask: askMock, stop: vi.fn() }) }));
vi.mock("./ask-uni-header", () => ({ AskUniHeader: () => <div>header</div> }));
vi.mock("./ask-uni-sources-bar", () => ({ AskUniSourcesBar: () => <div>sources</div> }));
vi.mock("./ask-uni-composer", () => ({
  AskUniComposer: ({ onSend }: { onSend: (input: { question: string }) => unknown }) => (
    <button type="button" onClick={() => onSend({ question: "Từ giờ gọi tôi là anh Vinh" })}>
      composer
    </button>
  ),
}));
vi.mock("./ask-uni-empty", () => ({ AskUniEmptyState: () => <div>empty</div> }));
vi.mock("./ask-uni-thread", () => ({ AskUniThread: () => <div>thread</div> }));
vi.mock("./ask-uni-memory", () => ({ AskUniMemory: ({ orgSlug }: { orgSlug: string }) => <div>memory-screen {orgSlug}</div> }));
vi.mock("./ask-uni-memory-help", () => ({ AskUniMemoryHelp: ({ orgSlug }: { orgSlug: string }) => <div>memory-help {orgSlug}</div> }));
vi.mock("./ask-uni-model-picker", () => ({ useAskModelSelection: () => ({ model: "auto", effort: "medium", look: null }) }));
vi.mock("./ask-uni-page-context", () => ({ useEffectiveFocus: () => null }));
vi.mock("./use-ask-uni-attachments", () => ({ useAskUniAttachments: () => ({ attach: vi.fn() }) }));

const mount = () =>
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniPanel />
      </WorkspaceProvider>,
    ),
  );

beforeEach(() => {
  askMock.mockReset();
  useAiPanelStore.setState({ view: "thread", conversationId: null, workspaceId: "ws1", memoryHelp: false });
});

describe("AskUniPanel screens", () => {
  it("shows the memory help strip above the composer, and sending closes it", () => {
    useAiPanelStore.setState({ memoryHelp: true });
    mount();
    // The organization routes take the slug ("acme"), never the id ("o1").
    expect(screen.getByText("memory-help acme")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "composer" }));
    expect(askMock).toHaveBeenCalledWith({ question: "Từ giờ gọi tôi là anh Vinh" }, undefined);
    expect(useAiPanelStore.getState().memoryHelp).toBe(false);
    expect(screen.queryByText("memory-help acme")).toBeNull();
  });

  it("renders the memory screen for memory and the conversation for thread", () => {
    useAiPanelStore.setState({ view: "memory" });
    const { unmount } = mount();
    expect(screen.getByText("memory-screen acme")).toBeInTheDocument();
    expect(screen.queryByText("sources")).toBeNull();
    expect(screen.queryByRole("button", { name: "composer" })).toBeNull();
    unmount();
    useAiPanelStore.setState({ view: "thread" });
    mount();
    expect(screen.getByRole("button", { name: "composer" })).toBeInTheDocument();
    expect(screen.queryByText(/memory-help/)).toBeNull();
  });
});

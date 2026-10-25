import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { user, workspace } from "./ask-uni-fixtures";
import { AskUniPanel } from "./ask-uni-panel";

initI18n();

// Only the switch between screens is under test, so the heavy children are stubs.
vi.mock("@uniwork/core/ai/stream", () => ({ useAskUniStream: () => ({ state: { status: "idle" }, ask: vi.fn(), stop: vi.fn() }) }));
vi.mock("./ask-uni-header", () => ({ AskUniHeader: () => <div>header</div> }));
vi.mock("./ask-uni-sources-bar", () => ({ AskUniSourcesBar: () => <div>sources</div> }));
vi.mock("./ask-uni-composer", () => ({ AskUniComposer: () => <div>composer</div> }));
vi.mock("./ask-uni-empty", () => ({ AskUniEmptyState: () => <div>empty</div> }));
vi.mock("./ask-uni-thread", () => ({ AskUniThread: () => <div>thread</div> }));
vi.mock("./ask-uni-memory", () => ({ AskUniMemory: () => <div>memory-screen</div> }));
vi.mock("./ask-uni-memory-import", () => ({ AskUniMemoryImport: ({ orgId }: { orgId: string }) => <div>import-screen {orgId}</div> }));
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

beforeEach(() => useAiPanelStore.setState({ view: "thread", conversationId: null, workspaceId: "ws1" }));

describe("AskUniPanel screens", () => {
  it("renders the import screen, without sources bar or composer, when view is memory-import", () => {
    useAiPanelStore.setState({ view: "memory-import" });
    mount();
    expect(screen.getByText("import-screen o1")).toBeInTheDocument();
    expect(screen.queryByText("sources")).toBeNull();
    expect(screen.queryByText("composer")).toBeNull();
  });

  it("renders the memory screen for memory and the conversation for thread", () => {
    useAiPanelStore.setState({ view: "memory" });
    const { unmount } = mount();
    expect(screen.getByText("memory-screen")).toBeInTheDocument();
    unmount();
    useAiPanelStore.setState({ view: "thread" });
    mount();
    expect(screen.getByText("composer")).toBeInTheDocument();
  });
});

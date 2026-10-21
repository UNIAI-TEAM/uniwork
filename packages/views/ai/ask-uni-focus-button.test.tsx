import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniFocusButton } from "./ask-uni-focus-button";
import { capabilities, composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

function mount(flagOn: boolean) {
  const service = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: flagOn } }));
  return render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniFocusButton kind="task" id="t1" title="Nộp app lên store" />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(composerRoutes);
  useAiPanelStore.setState({ open: false, pendingFocus: null, conversationId: null });
});

describe("AskUniFocusButton", () => {
  it("opens the dock with the focus and its title", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Hỏi UNI về task này" }));
    expect(useAiPanelStore.getState().open).toBe(true);
    expect(useAiPanelStore.getState().pendingFocus).toEqual({ kind: "task", id: "t1", label: "Nộp app lên store" });
  });

  it("hidden when the flag is off", async () => {
    const view = mount(false);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    view.unmount();
  });

  it("hidden when AI is off", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/ai/capabilities") ? { ...capabilities(), enabled: false } : {}),
    );
    mount(true);
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/ai/capabilities"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });
});

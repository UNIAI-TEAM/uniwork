import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniComposerNotes } from "./ask-uni-composer-notes";
import { capabilities, composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

function serve(mode: string) {
  requestMock.mockImplementation((path: string) =>
    path.endsWith("/ai/capabilities") ? Promise.resolve({ ...capabilities(), actions: { enabled: true, ceiling: "auto", mode } }) : composerRoutes(path),
  );
}

const mount = (tainted: boolean) =>
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniComposerNotes wsId="ws1" tainted={tainted} />
      </WorkspaceProvider>,
    ),
  );

beforeEach(() => {
  requestMock.mockReset();
  useAskModelChoice.setState({ model: "", effort: "" });
});

describe("AskUniComposerNotes", () => {
  it("says every change still asks first in a tainted conversation on Tự động", async () => {
    serve("auto");
    mount(true);
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("mọi thay đổi vẫn hỏi bạn trước");
    // Content UNI or an app wrote taints too, so the note does not say a person wrote it.
    expect(note).toHaveTextContent("không do bạn viết");
  });

  it("shows nothing when the conversation is clean or the mode is not Tự động", async () => {
    serve("auto");
    const clean = mount(false);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    clean.unmount();
    requestMock.mockReset();
    serve("plan");
    mount(true);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("puts the taint and the Opus quota notes in one strip, one line each", async () => {
    serve("auto");
    useAskModelChoice.setState({ model: "opus", effort: "" });
    mount(true);
    await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.");
    const strip = screen.getByRole("status");
    expect(strip.querySelectorAll("p")).toHaveLength(2);
    expect(strip).toHaveTextContent("mọi thay đổi vẫn hỏi bạn trước");
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniComposerNotes, AskUniComposerNotesSign } from "./ask-uni-composer-notes";
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
        <AskUniComposerNotesSign wsId="ws1" tainted={tainted} />
      </WorkspaceProvider>,
    ),
  );

beforeEach(() => {
  requestMock.mockReset();
  useAskModelChoice.setState({ model: "", effort: "", notesHiddenUntil: 0 });
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
    useAskModelChoice.setState({ model: "opus" });
    mount(true);
    await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.");
    const strip = screen.getByRole("status");
    expect(strip.querySelectorAll("p")).toHaveLength(2);
    expect(strip).toHaveTextContent("mọi thay đổi vẫn hỏi bạn trước");
  });

  it("folds the notes into a warning sign for a day, and opens them again from it", async () => {
    serve("auto");
    useAskModelChoice.setState({ model: "opus" });
    mount(true);
    await screen.findByRole("status");
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn lưu ý trong 1 ngày" }));
    expect(screen.queryByRole("status")).toBeNull();
    const until = useAskModelChoice.getState().notesHiddenUntil;
    expect(until).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    const sign = screen.getByRole("button", { name: "Xem 2 lưu ý" });
    expect(sign.className).toContain("text-tint-orange-foreground");
    fireEvent.click(sign);
    expect(await screen.findByRole("status")).toHaveTextContent("Opus dùng nhiều hạn mức");
    expect(screen.queryByRole("button", { name: /Xem \d lưu ý/ })).toBeNull();
    expect(useAskModelChoice.getState().notesHiddenUntil).toBe(0);
  });

  it("keeps the notes folded within the day and shows them again once it has passed", async () => {
    serve("auto");
    useAskModelChoice.setState({ model: "opus", notesHiddenUntil: Date.now() + 60_000 });
    const folded = mount(false);
    expect(await screen.findByRole("button", { name: "Xem 1 lưu ý" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    folded.unmount();
    useAskModelChoice.setState({ notesHiddenUntil: Date.now() - 1 });
    mount(false);
    expect(await screen.findByRole("status")).toHaveTextContent("Opus dùng nhiều hạn mức");
    expect(screen.queryByRole("button", { name: /Xem \d lưu ý/ })).toBeNull();
  });

  it("shows no sign when nothing stands, even while folded", async () => {
    serve("plan");
    useAskModelChoice.setState({ notesHiddenUntil: Date.now() + 60_000 });
    mount(true);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });
});

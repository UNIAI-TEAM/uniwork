import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskUniPageContext } from "./ask-uni-page-context";

function Page({ id, label = "T" }: { id: string; label?: string }) {
  useAskUniPageContext({ kind: "task", id, label });
  return null;
}
function Maybe({ on }: { on: boolean }) {
  useAskUniPageContext(on ? { kind: "task", id: "t1", label: "T" } : null);
  return null;
}

afterEach(() => useAiPanelStore.setState({ page: null, pageDismissed: null }));
const page = () => useAiPanelStore.getState().page;

describe("useAskUniPageContext", () => {
  it("sets the page on mount and clears it on unmount", () => {
    const r = render(<Page id="t1" />);
    expect(page()).toEqual({ kind: "task", id: "t1", label: "T" });
    r.unmount();
    expect(page()).toBeNull();
  });

  it("null means no page", () => {
    const r = render(<Maybe on />);
    r.rerender(<Maybe on={false} />);
    expect(page()).toBeNull();
  });

  it("keeps the next page when the old one unmounts after it mounted", () => {
    const a = render(<Page id="a" />);
    render(<Page id="b" />);
    a.unmount();
    expect(page()).toMatchObject({ id: "b" });
  });

  it("a renamed label keeps a dismissed chip dismissed", () => {
    const r = render(<Page id="t1" label="Old" />);
    useAiPanelStore.getState().dismissPage();
    r.rerender(<Page id="t1" label="New" />);
    expect(page()).toMatchObject({ label: "New" });
    expect(useAiPanelStore.getState().pageDismissed).toBe("task:t1");
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentPageHeader } from "./document-page-header";

const { t } = initI18n();
const doc: Document = {
  id: "d1", workspace_id: "ws1", organization_id: "o1", kind: "page", title: "Ghi chú",
  revision: "3", visibility: "workspace", my_level: "edit", content_text: "", current_version: 1,
  position: 0, breadcrumbs: [], created_by: "", created_by_kind: "human", updated_by: "",
  updated_by_kind: "human", created_at: "", updated_at: "",
};

function mount(over: Partial<Document> = {}, editable = true) {
  const onFocusBody = vi.fn();
  render(wrap(<DocumentPageHeader wsId="ws1" doc={{ ...doc, ...over }} editable={editable}
    onTitleChange={vi.fn()} onFocusBody={onFocusBody} />));
  return { onFocusBody };
}

function patches() {
  return requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === "PATCH");
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: object }) =>
    path === "/api/v1/documents/d1" && opts?.method === "PATCH"
      ? Promise.resolve({ document: { ...doc, ...opts.body, revision: "4" } })
      : Promise.resolve({}));
});

describe("DocumentPageHeader", () => {
  it("recomputes title height when the available width changes without editing or saving the title", () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    const disconnect = vi.fn();
    let width = 720;
    let height = 48;
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => height);
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { callbacks.set(target, this.callback); }
      unobserve(target: Element) { callbacks.delete(target); }
      disconnect = disconnect;
    });
    const { unmount } = render(wrap(<DocumentPageHeader wsId="ws1" doc={doc} editable
      onTitleChange={vi.fn()} onFocusBody={vi.fn()} />));
    try {
      const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
      expect(title.style.height).toBe("48px");
      const notify = () => act(() => callbacks.get(title)?.([
        { target: title, contentRect: new DOMRectReadOnly(0, 0, width, height),
          borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] },
      ], {} as ResizeObserver));
      width = 350;
      height = 120;
      notify();
      expect(title.style.height).toBe("120px");
      width = 720;
      height = 48;
      notify();
      expect(title.style.height).toBe("48px");
      expect(title).toHaveValue(doc.title);
      expect(patches()).toHaveLength(0);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      unmount();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("debounces title PATCH and does not resend the acknowledged value on blur", async () => {
    mount();
    const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
    fireEvent.change(title, { target: { value: "Họp tuần" } });
    expect(patches()).toHaveLength(0);
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 1500 });
    expect(patches()[0]?.[1]).toMatchObject({ body: { title: "Họp tuần", revision: "3" } });
    fireEvent.blur(title);
    expect(patches()).toHaveLength(1);
  });

  it("flushes on blur and saves an empty title as the localized untitled value", async () => {
    mount();
    const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.blur(title);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.[1]).toMatchObject({ body: { title: t("documents.detail.untitled") } });
  });

  it("moves Enter to the body and selects the default new-page title", () => {
    const { onFocusBody } = mount({ title: t("documents.page.new_page") });
    const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
    expect(title).toHaveFocus();
    expect((title as HTMLTextAreaElement).selectionEnd).toBe((title as HTMLTextAreaElement).value.length);
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onFocusBody).toHaveBeenCalledOnce();
  });

  it("PATCHes a selected emoji and removes it without introducing a picker dependency", async () => {
    mount({ icon: "📝" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.page_ui.change_icon") }));
    fireEvent.click(await screen.findByRole("button", { name: t("documents.page_ui.choose_icon", { emoji: "📚" }) }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.[1]).toMatchObject({ body: { icon: "📚", revision: "3" } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.page_ui.change_icon") }));
    fireEvent.click(await screen.findByRole("button", { name: t("documents.page_ui.remove_icon") }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]?.[1]).toMatchObject({ body: { icon: "", revision: "4" } });
  });

  it("renders a plain heading and decorative icon when read-only", () => {
    mount({ icon: "📝" }, false);
    expect(screen.getByRole("heading", { level: 1, name: "Ghi chú" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("waits for unsaved body content and then PATCHes metadata against its acknowledged revision", async () => {
    const header = (canPersist: boolean) => wrap(<DocumentPageHeader wsId="ws1" doc={doc} editable
      onTitleChange={vi.fn()} onFocusBody={vi.fn()} canPersist={canPersist} getRevision={() => "8"} />);
    const { rerender } = render(header(false));
    const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
    fireEvent.change(title, { target: { value: "Sau bản lưu nội dung" } });
    fireEvent.blur(title);
    expect(patches()).toHaveLength(0);
    rerender(header(true));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.[1]).toMatchObject({ body: { title: "Sau bản lưu nội dung", revision: "8" } });
  });
});

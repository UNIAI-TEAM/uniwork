import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectTextMatches, useTaskFind } from "./use-task-find";

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("collectTextMatches", () => {
  it("truy vấn rỗng hoặc không có trong trang thì không có kết quả", () => {
    expect(collectTextMatches(makeRoot("<p>xin chào</p>"), "")).toEqual([]);
    expect(collectTextMatches(makeRoot("<p>xin chào</p>"), "zzz")).toEqual([]);
  });

  it("tìm không phân biệt hoa thường, theo thứ tự tài liệu, kèm vị trí trong nút chữ", () => {
    const matches = collectTextMatches(
      makeRoot("<h1>Kế hoạch</h1><p>bản KẾ HOẠCH hai</p>"),
      "kế hoạch",
    );
    expect(matches.map((m) => m.node.parentElement?.tagName)).toEqual(["H1", "P"]);
    expect(matches.map((m) => [m.start, m.end])).toEqual([
      [0, 8],
      [4, 12],
    ]);
  });

  it("đếm mọi lần xuất hiện không chồng nhau trong một nút", () => {
    expect(collectTextMatches(makeRoot("<p>aaaa</p>"), "aa").map((m) => m.start)).toEqual([0, 2]);
  });

  it("không ghép một kết quả qua ranh giới phần tử", () => {
    const root = makeRoot("<p>foo <strong>bar</strong> foobar</p>");
    expect(collectTextMatches(root, "foo")).toHaveLength(2);
    expect(collectTextMatches(root, "foobar")).toHaveLength(1);
  });

  it("bỏ chữ trong script, style và [data-find-ignore]", () => {
    const root = makeRoot(
      "<style>kim{}</style><script>kim</script><div data-find-ignore><span>kim</span></div><p>kim</p>",
    );
    const matches = collectTextMatches(root, "kim");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.node.parentElement?.tagName).toBe("P");
  });

  // The collapsed sub-task list (task-detail-ui-store) stays mounted under
  // `hidden`; counting its text would report matches nobody can see.
  it("bỏ chữ nằm trong cây con có thuộc tính hidden", () => {
    const root = makeRoot("<div hidden><span>kim</span></div><p>kim</p>");
    const matches = collectTextMatches(root, "kim");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.node.parentElement?.tagName).toBe("P");
  });
});

type RectInit = { top: number; height: number; width?: number };

function rect({ top, height, width = 0 }: RectInit): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  };
}

describe("useTaskFind", () => {
  let container: HTMLElement;

  beforeEach(() => {
    // jsdom has no Range geometry at all. A zero-size rect makes
    // scroll-to-match a no-op instead of a TypeError inside a frame callback.
    Range.prototype.getClientRects = () =>
      [rect({ top: 0, height: 0 })] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect({ top: 0, height: 0 });
    container = document.createElement("div");
    container.innerHTML = "<h1>Find me</h1><p>find me twice: find</p>";
    document.body.appendChild(container);
  });

  afterEach(() => {
    delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
    delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    container.remove();
    vi.unstubAllGlobals();
  });

  // Flush the frame-deferred recomputes the open/query/content effects schedule.
  async function flushFrames(count = 3): Promise<void> {
    for (let i = 0; i < count; i++) {
      await act(
        () => new Promise<void>((done) => requestAnimationFrame(() => done())),
      );
    }
  }

  // jsdom implements neither `CSS.highlights` nor `Highlight`, so this is
  // exactly a browser without the CSS Custom Highlight API.
  it("không có CSS Highlight API vẫn đếm và đi qua kết quả, vòng quanh ở hai đầu", async () => {
    expect(typeof CSS === "undefined" || !("highlights" in CSS)).toBe(true);
    const { result } = renderHook(() => useTaskFind({ container, contentKey: 0 }));
    expect(result.current.supported).toBe(false);

    act(() => {
      result.current.openFind();
      result.current.setQuery("find");
    });
    await flushFrames();

    expect(result.current.matchCount).toBe(3);
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.goNext());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goPrev());
    expect(result.current.activeIndex).toBe(2);

    act(() => result.current.setQuery("absent"));
    await flushFrames();
    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("đưa kết quả ngoài tầm nhìn vào giữa bằng cách cuộn container, không gọi scrollIntoView gốc", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    container.getBoundingClientRect = () => rect({ top: 0, height: 200 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 200 });
    // The match sits 500px down the content; it moves up as the container scrolls.
    Range.prototype.getClientRects = () =>
      [rect({ top: 500 - container.scrollTop, height: 20, width: 40 })] as unknown as DOMRectList;

    const { result } = renderHook(() => useTaskFind({ container, contentKey: 0 }));
    act(() => {
      result.current.openFind();
      result.current.setQuery("find me");
    });
    await flushFrames();

    // offset 500 - half the viewport (100) + half the match (10)
    expect(container.scrollTop).toBe(410);
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("có CSS Highlight API thì tô mọi kết quả và kết quả đang chọn, đóng thanh thì xoá cả hai", async () => {
    class FakeHighlight {
      priority = 0;
      readonly ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", FakeHighlight);

    const { result, unmount } = renderHook(() => useTaskFind({ container, contentKey: 0 }));
    expect(result.current.supported).toBe(true);
    act(() => {
      result.current.openFind();
      result.current.setQuery("find");
    });
    await flushFrames();

    expect(highlights.get("task-find")?.ranges).toHaveLength(3);
    expect(highlights.get("task-find-active")?.ranges).toHaveLength(1);
    expect(highlights.get("task-find-active")?.priority).toBe(1);

    act(() => result.current.closeFind());
    await flushFrames();
    expect(highlights.size).toBe(0);
    // Unmount while the fake API is still installed: the unmount cleanup
    // clears highlights, and afterEach restores jsdom's own `CSS` before the
    // shared cleanup would unmount.
    unmount();
  });

  // The names above are only half the contract: without a matching
  // ::highlight() rule the browser registers the ranges and paints nothing.
  it("stylesheet chung có luật ::highlight cho cả hai tên mà hook đăng ký", () => {
    const css = readFileSync(resolve(process.cwd(), "../ui/styles/base.css"), "utf8");
    expect(css).toMatch(/::highlight\(task-find\)\s*\{/);
    expect(css).toMatch(/::highlight\(task-find-active\)\s*\{/);
  });
});

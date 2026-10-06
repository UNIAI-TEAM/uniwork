import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./use-media-query";

/** jsdom reports a 1024px viewport (packages/ui/test/media-stub.ts). */
const QUERY = "(min-width: 768px)";

describe("useMediaQuery: hợp đồng SSR/hydration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("server snapshot là false, khung client đầu khi hydrate cũng false, rồi về giá trị thật", async () => {
    expect(window.matchMedia(QUERY).matches).toBe(true);

    const seen: boolean[] = [];
    function Probe() {
      const matches = useMediaQuery(QUERY);
      seen.push(matches);
      return <span data-testid="value">{String(matches)}</span>;
    }

    // SSR dùng getServerSnapshot: giá trị thật (true) không được lọt vào HTML.
    const html = renderToString(<Probe />);
    expect(html).toContain("false");
    seen.length = 0;

    // React 19 báo hydration mismatch qua console.error; khung đầu của client
    // phải khớp HTML server nên không được có dòng nào như vậy.
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Probe />);
    });

    // Khung render đầu khi hydrate phải là false, đúng như server đã vẽ.
    expect(seen[0]).toBe(false);
    // Rồi effect đồng bộ về giá trị thật, không cần remount.
    expect(seen.at(-1)).toBe(true);
    expect(container.querySelector("[data-testid=value]")?.textContent).toBe("true");
    const hydrationErrors = error.mock.calls.filter((args) => /hydrat/i.test(String(args[0])));
    expect(hydrationErrors).toEqual([]);

    await act(async () => root?.unmount());
    container.remove();
  });
});

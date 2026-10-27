import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { meetingKeys } from "@uniwork/core/meetings";
import { requestMock, wrap } from "../../test/api-mock";
import { LiveItemsAnnouncer, useUnseenLiveItems } from "./live-items-unseen";

beforeAll(() => {
  initI18n();
});

const item = (id: string, title: string, source = "LIVE", status = "PENDING") => ({
  id,
  source,
  title,
  status,
  evidence: [],
});

let items: unknown[] = [];

beforeEach(() => {
  items = [item("a", "Gửi báo giá")];
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/action-items") ? Promise.resolve({ items }) : Promise.resolve({}),
  );
});

function setup(seeing: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(({ seeing }) => useUnseenLiveItems("m1", seeing), {
    initialProps: { seeing },
    wrapper: ({ children }) => wrap(<>{children}</>, client),
  });
  const more = async (next: unknown[]) => {
    items = next;
    await act(async () => {
      await client.invalidateQueries({ queryKey: meetingKeys.actionItems("m1") });
      // React Query hands the answer to its observers on the next tick.
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  // The first answer is the baseline; wait for it rather than for the request.
  const ready = () => waitFor(() => expect(client.getQueryData(meetingKeys.actionItems("m1"))).toBeDefined());
  return { ...hook, more, ready };
}

describe("useUnseenLiveItems (UNI-1995 #21)", () => {
  it("counts the live items the scribe adds after the viewer arrived, not the ones already there", async () => {
    const { result, more, ready } = setup(false);
    await ready();
    expect(result.current.count).toBe(0);

    await more([item("a", "Gửi báo giá"), item("b", "Đặt phòng họp"), item("c", "Gõ tay", "MANUAL")]);
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.latest?.title).toBe("Đặt phòng họp");
    expect([...result.current.ids]).toEqual(["b"]);
  });

  it("clears the count once the viewer has the items on screen, keeping that visit's news marked until it ends", async () => {
    const { result, more, rerender, ready } = setup(false);
    await ready();
    await more([item("a", "Gửi báo giá"), item("b", "Đặt phòng họp")]);
    await waitFor(() => expect(result.current.count).toBe(1));

    rerender({ seeing: true });
    await waitFor(() => expect(result.current.count).toBe(0));
    // What was news when the viewer came keeps its dot for the visit.
    expect([...result.current.ids]).toEqual(["b"]);
    // Written while the viewer looks: seen at once, no dot.
    await more([item("a", "Gửi báo giá"), item("b", "Đặt phòng họp"), item("d", "Chốt lịch")]);
    expect(result.current.count).toBe(0);
    expect([...result.current.ids]).toEqual(["b"]);

    rerender({ seeing: false });
    expect(result.current.count).toBe(0);
    expect(result.current.ids.size).toBe(0);
    rerender({ seeing: true });
    expect(result.current.ids.size).toBe(0);
  });

  it("does not count an item someone already handled", async () => {
    const { result, more, ready } = setup(false);
    await ready();
    await more([item("a", "Gửi báo giá"), item("b", "Đã giao", "LIVE", "CONVERTED")]);
    expect(result.current.count).toBe(0);
  });
});

describe("LiveItemsAnnouncer", () => {
  it("says politely what UNI wrote down while the section is off screen, and nothing while it is on", () => {
    const { rerender } = render(wrap(<LiveItemsAnnouncer count={1} latest={{ id: "b", title: "Đặt phòng họp" }} seeing={false} />));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("UNI ghi thêm 1 việc. Mới nhất: Đặt phòng họp");

    rerender(wrap(<LiveItemsAnnouncer count={2} latest={{ id: "c", title: "Chốt lịch" }} seeing={false} />));
    expect(region).toHaveTextContent("UNI ghi thêm 2 việc. Mới nhất: Chốt lịch");

    rerender(wrap(<LiveItemsAnnouncer count={0} seeing />));
    expect(region).toHaveTextContent("");
  });
});

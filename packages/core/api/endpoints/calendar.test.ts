import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCalendarEvents } from "./calendar";

vi.mock("../http", () => ({
  request: vi.fn(),
}));

import { request } from "../http";

describe("listCalendarEvents", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("returns [] on malformed payload", async () => {
    vi.mocked(request).mockResolvedValue({ nope: true });
    await expect(listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" })).resolves.toEqual([]);
  });

  it("parses events envelope", async () => {
    vi.mocked(request).mockResolvedValue({
      events: [
        {
          id: "task:t1",
          kind: "task",
          entity_id: "t1",
          title: "A",
          start: "2026-09-10",
          end: "2026-09-11",
          all_day: true,
        },
      ],
    });
    const ev = await listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" });
    expect(ev[0]?.entityId).toBe("t1");
    expect(ev[0]?.allDay).toBe(true);
  });
});

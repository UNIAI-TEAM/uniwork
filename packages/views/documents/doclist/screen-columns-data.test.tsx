import { render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DocumentSummaryRow } from "../library-rows";
import { DocPersonCell } from "./cells";
import type { DocListScreenColumnId } from "./columns";
import { docListRowFields } from "./row-fields";
import { DocScreenCell, DocScreenLine, type DocListMemberLookup } from "./screen-cells";

// The screen columns of Gần đây, Có gắn sao, Được chia sẻ với tôi and Tôi đã
// chia sẻ (UNI-2045 W4-W7), from the list fields SV-1..SV-4, in both
// languages; and what each draws against today's server, which sends none.
// recent: dot + "Bạn đã sửa|mở|bình luận" · date; starred: date · "Bạn gắn sao";
// shared: avatar + sharer · date; shared_with: "3 người · 1 workspace · 1 link" · latest date.

initI18n();

const NOW = new Date(2026, 9, 21, 9, 5, 0);
const local = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();

function doc(over: Record<string, unknown> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo.docx",
    visibility: "restricted",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "edit",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  } as DocumentSummaryRow;
}

const members: DocListMemberLookup = (id) => (id === "u3" ? { name: "Bình (danh bạ)", avatarUrl: "https://cdn.test/binh.png" } : "former");

function cell(column: DocListScreenColumnId, row: DocumentSummaryRow, member: DocListMemberLookup = members) {
  return render(<DocScreenCell column={column} fields={docListRowFields(row)} member={member} />);
}

function line(column: DocListScreenColumnId, row: DocumentSummaryRow): string | null {
  const { container, unmount } = render(<DocScreenLine column={column} fields={docListRowFields(row)} member={members} />);
  const text = container.querySelector("[data-doclist-screen-line]")?.textContent ?? null;
  unmount();
  return text;
}

async function inLocale(locale: "vi" | "en", run: () => void | Promise<void>) {
  await setLocale(locale);
  try {
    await run();
  } finally {
    await setLocale("vi");
  }
}

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recent: activity column", () => {
  it("draws the dot and 'Bạn đã sửa' with the date below (vi)", () => {
    const { container } = cell("activity", doc({ last_activity: { kind: "edited", at: local(10, 21, 8, 0) } }));
    expect(screen.getByText("Bạn đã sửa")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(container.querySelector("[data-activity-kind='edited']")).not.toBeNull();
  });

  it("says opened and commented in both languages", async () => {
    const opened = doc({ last_activity: { kind: "opened", at: local(10, 20, 16, 30) } });
    const commented = doc({ last_activity: { kind: "commented", at: local(10, 18, 10, 0) } });
    expect(line("activity", opened)).toBe("Bạn đã mở · Hôm qua, 16:30");
    expect(line("activity", commented)).toBe("Bạn đã bình luận · 18/10");
    await inLocale("en", () => {
      expect(line("activity", opened)).toBe("You opened · Yesterday, 16:30");
      expect(line("activity", commented)).toBe("You commented · Oct 18");
      expect(line("activity", doc({ last_activity: { kind: "edited", at: local(10, 21, 8, 0) } }))).toBe("You edited · 08:00");
    });
  });

  it("keeps the date and drops the words for a kind this client does not know", () => {
    const { container } = cell("activity", doc({ last_activity: { kind: "printed", at: local(10, 18, 10, 0) } }));
    expect(screen.getByText("18/10")).toBeInTheDocument();
    expect(container.querySelector("[data-activity-kind]")).toBeNull();
  });

  it("writes '—' against today's server (no last_activity)", () => {
    cell("activity", doc());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(line("activity", doc())).toBeNull();
  });
});

describe("starred: starred column", () => {
  it("shows the star date with 'Bạn gắn sao' below (vi) and 'You starred' (en)", async () => {
    const row = doc({ favorited_at: local(10, 18, 10, 0) });
    cell("starred", row);
    expect(screen.getByText("18/10")).toBeInTheDocument();
    expect(screen.getByText("Bạn gắn sao")).toBeInTheDocument();
    expect(line("starred", row)).toBe("18/10 · Bạn gắn sao");
    await inLocale("en", () => {
      expect(line("starred", row)).toBe("Oct 18 · You starred");
      expect(line("starred", doc({ favorited_at: local(10, 18, 10, 0).replace("2026", "2025") }))).toBe("Oct 18, 2025 · You starred");
    });
  });

  it("writes '—' without favorited_at", () => {
    cell("starred", doc());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Bạn gắn sao")).toBeNull();
  });
});

describe("shared: who shared it", () => {
  const shared = (over: Record<string, unknown> = {}) =>
    doc({ shared: { by: "u3", by_kind: "human", by_name: "Trần Thị Bình", at: local(10, 19, 9, 30), ...over } });

  it("draws the sharer's avatar and name with the date below", async () => {
    const { container } = cell("shared", shared());
    expect(screen.getByText("Trần Thị Bình")).toBeInTheDocument();
    expect(screen.getByText("19/10")).toBeInTheDocument();
    // The photo comes from the member list; the name is the server's.
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/binh.png");
    expect(line("shared", shared())).toBe("Trần Thị Bình · 19/10");
    await inLocale("en", () => {
      expect(line("shared", shared())).toBe("Trần Thị Bình · Oct 19");
    });
  });

  it("draws the initial when the member list has no photo for the sharer", () => {
    const { container } = cell("shared", shared({ by: "u7" }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("writes '—' for a sharer whose name the server withholds (by_name null), keeping the date", () => {
    cell("shared", shared({ by: "u9", by_name: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("19/10")).toBeInTheDocument();
    expect(line("shared", shared({ by: "u9", by_name: null }))).toBe("— · 19/10");
  });

  it("writes '—' against today's server (no shared)", () => {
    cell("shared", doc());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(line("shared", doc())).toBeNull();
  });
});

describe("shared_with: what the owner shared", () => {
  const summary = (people: number, workspaces: number, links: number, latest: string | null = local(10, 19, 9, 30)) =>
    doc({ share_summary: { people, workspaces, links, latest_at: latest } });

  it("counts people · workspaces · links with the latest date below (vi)", () => {
    cell("shared_with", summary(3, 1, 1));
    expect(screen.getByText("3 người · 1 workspace · 1 link")).toBeInTheDocument();
    expect(screen.getByText("19/10")).toBeInTheDocument();
  });

  it("speaks English plurals", async () => {
    await inLocale("en", () => {
      expect(line("shared_with", summary(3, 1, 1))).toBe("3 people · 1 workspace · 1 link · Oct 19");
      expect(line("shared_with", summary(1, 2, 2))).toBe("1 person · 2 workspaces · 2 links · Oct 19");
    });
  });

  it("drops the parts that are zero", async () => {
    expect(line("shared_with", summary(0, 0, 2))).toBe("2 link · 19/10");
    expect(line("shared_with", summary(2, 0, 0))).toBe("2 người · 19/10");
    await inLocale("en", () => {
      expect(line("shared_with", summary(1, 0, 0))).toBe("1 person · Oct 19");
    });
  });

  it("shows only what is left when every count is zero, and '—' when nothing is", () => {
    expect(line("shared_with", summary(0, 0, 0))).toBe("19/10");
    cell("shared_with", summary(0, 0, 0, null));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("writes '—' against today's server (no share_summary)", () => {
    cell("shared_with", doc());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(line("shared_with", doc())).toBeNull();
  });
});

describe("editor: avatar from updated_by_user", () => {
  it("draws the photo when the server sends one", () => {
    const fields = docListRowFields(doc({ updated_by_user: { name: "Nguyễn Văn An", avatar_url: "https://cdn.test/an.png" } }));
    expect(fields.updatedByUser).toEqual({ name: "Nguyễn Văn An", avatarUrl: "https://cdn.test/an.png" });
    const { container } = render(<DocPersonCell name={fields.updatedByUser?.name} avatarUrl={fields.updatedByUser?.avatarUrl} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/an.png");
  });

  it("draws the initial without a photo", () => {
    const fields = docListRowFields(doc({ updated_by_user: { name: "Nguyễn Văn An" } }));
    expect(fields.updatedByUser).toEqual({ name: "Nguyễn Văn An", avatarUrl: null });
    const { container } = render(<DocPersonCell name={fields.updatedByUser?.name} avatarUrl={fields.updatedByUser?.avatarUrl} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("reads null (outside the organization) and absent (today's server) apart", () => {
    expect(docListRowFields(doc({ updated_by_user: null })).updatedByUser).toBeNull();
    expect(docListRowFields(doc()).updatedByUser).toBeUndefined();
  });
});

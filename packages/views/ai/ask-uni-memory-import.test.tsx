import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { user, workspace } from "./ask-uni-fixtures";
import { AskUniMemoryImport } from "./ask-uni-memory-import";

const i18n = initI18n();

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(toastMock, { error: vi.fn(), success: vi.fn() }) }));

// The fixture workspace is organization "o1" with the slug "acme": the routes take the slug.
const LIST = "/api/v1/orgs/acme/ai/memory";
const SPLIT = `${LIST}/import/split`;
const IMPORT = `${LIST}/import`;
const cand = (text: string, kind = "fact", extra: Record<string, boolean> = {}) => ({ text, kind, instruction_like: false, duplicate: false, ...extra });

let remaining = 40;
let split: unknown;
let importAnswer: () => Promise<unknown>;
const writeText = vi.fn(() => Promise.resolve());

beforeEach(async () => {
  await i18n.changeLanguage("vi");
  toastMock.mockReset();
  requestMock.mockReset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  remaining = 40;
  split = { candidates: [cand("Trả lời ngắn", "preference"), cand("Tôi là kế toán")], skipped: [] };
  importAnswer = () => Promise.resolve({ entries: [], on: true, limit: 50, remaining: 0, skipped_duplicates: 0 });
  requestMock.mockImplementation((path: string) => {
    if (path === LIST) return Promise.resolve({ entries: [], on: true, limit: 50, remaining });
    if (path === SPLIT) return Promise.resolve(split);
    if (path === IMPORT) return importAnswer();
    return Promise.resolve(undefined);
  });
  useAiPanelStore.setState({ view: "memory-import", composerPrefill: null, workspaceId: "ws1" });
});
afterEach(() => void i18n.changeLanguage("vi"));

function mount() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniMemoryImport orgSlug={workspace.organization_slug} />
      </WorkspaceProvider>,
    ),
  );
}
const paste = (v: string) => fireEvent.change(screen.getByRole("textbox", { name: "Chữ dán từ AI khác" }), { target: { value: v } });
async function toReview() {
  mount();
  paste("- a\n- b");
  fireEvent.click(screen.getByRole("button", { name: "Tách thành từng mục" }));
  await screen.findByText("Chọn mục muốn giữ");
}
const ticks = () => screen.getAllByRole("checkbox", { name: "Giữ mục này" });
const posted = (path: string) => requestMock.mock.calls.filter(([p, o]) => p === path && (o as { method?: string })?.method === "POST");

describe("AskUniMemoryImport step 1", () => {
  it("shows the Vietnamese export prompt and copies exactly it", async () => {
    mount();
    const prompt = i18n.t("ai.memory.importer.prompt");
    expect(prompt).toContain("SỞ THÍCH");
    expect(screen.getByText(/SỞ THÍCH — cách tôi muốn được trả lời/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt));
  });

  it("shows the English prompt when the interface is English", async () => {
    await i18n.changeLanguage("en");
    mount();
    expect(screen.getByText(/PREFERENCES — how I want to be answered/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(i18n.t("ai.memory.importer.prompt")));
  });

  it("counts characters and disables splitting past 20,000", () => {
    mount();
    const btn = screen.getByRole("button", { name: "Tách thành từng mục" });
    expect(btn).toBeDisabled();
    paste("abc");
    expect(screen.getByText("3/20000")).toBeInTheDocument();
    expect(btn).toBeEnabled();
    paste("a".repeat(20001));
    expect(btn).toBeDisabled();
  });

  it("counts the paste in runes, as the server does: 20,000 emoji may be split", () => {
    mount();
    const btn = screen.getByRole("button", { name: "Tách thành từng mục" });
    paste("😀".repeat(20000));
    expect(screen.getByText("20000/20000")).toBeInTheDocument();
    expect(btn).toBeEnabled();
    paste("😀".repeat(20001));
    expect(btn).toBeDisabled();
  });

  it.each([
    ["ai_memory_import_rate_limited", 429, "Bạn tách quá nhiều lần. Thử lại sau ít phút."],
    ["ai_memory_import_failed", 502, "UNI chưa tách được chữ này. Thử dán lại."],
    ["ai_rate_limited", 429, "AI đang bận, thử lại sau ít phút."],
    ["invalid_request", 400, "Chữ dán không hợp lệ."],
    // The gateway's own codes reuse Ask UNI's shared AI copy.
    ["ai_quota_exceeded", 402, "Tổ chức đã hết hạn mức token AI của tháng."],
    ["ai_disabled", 503, "AI chưa được cấu hình trên server."],
    ["ai_provider_error", 502, "Dịch vụ AI đang gặp sự cố, thử lại sau ít phút."],
    ["ai_provider_timeout", 504, "UNI trả lời quá lâu, thử lại nhé."],
    ["ai_refused", 422, "Mô hình từ chối xử lý chữ này. Bỏ bớt phần nhạy cảm rồi thử lại."],
    ["organization_suspended", 403, "Tổ chức này đang tạm ngưng hoạt động."],
  ])("keeps the paste on %s", async (code, status, copy) => {
    requestMock.mockImplementation((path: string) =>
      path === SPLIT ? Promise.reject(new ApiError("x", code, status)) : Promise.resolve({ entries: [], on: true, limit: 50, remaining }),
    );
    mount();
    paste("giữ lại");
    fireEvent.click(screen.getByRole("button", { name: "Tách thành từng mục" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("textbox", { name: "Chữ dán từ AI khác" })).toHaveValue("giữ lại");
  });
});

describe("AskUniMemoryImport review", () => {
  it("pre-ticks valid rows; instruction-like and duplicate rows stay off with their reason; skipped rows have no tick", async () => {
    split = {
      candidates: [cand("Một"), cand("Hai", "fact", { instruction_like: true }), cand("Ba", "fact", { duplicate: true })],
      skipped: [{ text: "Số tài khoản 123", reason: "secret" }],
    };
    await toReview();
    expect(ticks().map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.getByText("Giống một mệnh lệnh. UNI không làm theo bộ nhớ như lệnh.")).toBeInTheDocument();
    expect(screen.getByText("Đã có trong bộ nhớ")).toBeInTheDocument();
    const group = screen.getByText(/Bỏ qua 1 dòng/).closest("details") as HTMLElement;
    expect(group).not.toHaveAttribute("open");
    expect(within(group).getByText(/Số tài khoản 123/)).toBeInTheDocument();
    expect(within(group).queryByRole("checkbox")).toBeNull();
  });

  it("renders candidate text as plain text", async () => {
    split = { candidates: [cand("<b>đậm</b> [x](http://e.com)")], skipped: [] };
    await toReview();
    expect(screen.getByDisplayValue("<b>đậm</b> [x](http://e.com)")).toBeInTheDocument();
    expect(document.querySelector("b, a")).toBeNull();
  });

  it("ticks only as many as there are free slots and locks the rest until one is unticked", async () => {
    remaining = 2;
    split = { candidates: [cand("A"), cand("B"), cand("C"), cand("D")], skipped: [] };
    await toReview();
    await screen.findByText("Còn 2 chỗ trống");
    await waitFor(() => expect(ticks().map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "true", "false", "false"]));
    expect(ticks()[2]).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ticks()[0] as HTMLElement);
    await waitFor(() => expect(ticks()[2]).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(ticks()[2] as HTMLElement);
    expect(ticks().map((c) => c.getAttribute("aria-checked"))).toEqual(["false", "true", "true", "false"]);
  });

  it("saves the ticked entries with the edited kind and text, then goes back to memory with a toast", async () => {
    await toReview();
    const box = screen.getAllByRole("textbox", { name: "Nội dung mục bộ nhớ" })[1] as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Tôi là kế toán trưởng" } });
    await userEvent.click(screen.getAllByRole("combobox", { name: "Loại" })[0] as HTMLElement);
    await userEvent.click(await screen.findByRole("option", { name: "Về bạn" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm 2 mục vào bộ nhớ" }));
    await waitFor(() => expect(useAiPanelStore.getState().view).toBe("memory"));
    expect(posted(IMPORT)[0]?.[1]).toEqual({
      method: "POST",
      body: { entries: [{ kind: "fact", text: "Trả lời ngắn" }, { kind: "fact", text: "Tôi là kế toán trưởng" }] },
    });
    expect(toastMock).toHaveBeenCalledWith("Đã thêm 2 mục");
  });

  it("mentions skipped duplicates in the toast", async () => {
    importAnswer = () => Promise.resolve({ entries: [], on: true, limit: 50, remaining: 0, skipped_duplicates: 1 });
    await toReview();
    fireEvent.click(screen.getByRole("button", { name: "Thêm 2 mục vào bộ nhớ" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Đã thêm 1 mục, 1 mục đã có, bỏ qua"));
  });

  it("keeps the review list when memory turns out to be full", async () => {
    importAnswer = () => Promise.reject(new ApiError("full", "ai_memory_full", 409));
    await toReview();
    fireEvent.click(screen.getByRole("button", { name: "Thêm 2 mục vào bộ nhớ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Xóa bớt mục cũ rồi thử lại");
    expect(useAiPanelStore.getState().view).toBe("memory-import");
    expect(ticks()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Thêm 2 mục vào bộ nhớ" })).toBeEnabled();
  });

  it("disables saving with nothing ticked or with an empty edited line", async () => {
    await toReview();
    const save = () => screen.getByRole("button", { name: /vào bộ nhớ|Thêm 0 mục/ });
    const box = screen.getAllByRole("textbox", { name: "Nội dung mục bộ nhớ" })[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: "  " } });
    expect(save()).toBeDisabled();
    fireEvent.change(box, { target: { value: "ok" } });
    expect(save()).toBeEnabled();
    ticks().forEach((c) => fireEvent.click(c));
    expect(save()).toBeDisabled();
    expect(posted(IMPORT)).toHaveLength(0);
  });
});

describe("AskUniMemoryImport edge cases", () => {
  it("shows a loading line, then an error with a retry, while the memory list is not there", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path === LIST) return fail ? Promise.reject(new ApiError("x", "boom", 500)) : Promise.resolve({ entries: [], on: true, limit: 50, remaining });
      if (path === SPLIT) return Promise.resolve(split);
      return Promise.resolve(undefined);
    });
    mount();
    paste("- a");
    fireEvent.click(screen.getByRole("button", { name: "Tách thành từng mục" }));
    expect(await screen.findByText("Không tải được bộ nhớ.")).toBeInTheDocument();
    expect(screen.queryByText("Đang tách…")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chọn mục muốn giữ")).toBeInTheDocument();
  });

  it("reports a missing clipboard and a refused write", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không sao chép được");
    cleanup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không sao chép được");
  });

  it("counts runes: 300 emoji are valid, 301 block saving", async () => {
    split = { candidates: [cand("😀".repeat(300))], skipped: [] };
    await toReview();
    const save = screen.getByRole("button", { name: "Thêm 1 mục vào bộ nhớ" });
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" }), { target: { value: "😀".repeat(301) } });
    expect(save).toBeDisabled();
    expect(screen.getByText("Mỗi mục là một dòng, 1–300 ký tự.")).toBeInTheDocument();
  });

  it("renders candidate and skipped text literally", async () => {
    split = { candidates: [cand("<b>x</b> https://a.b")], skipped: [{ text: "<b>y</b> https://c.d", reason: "" }] };
    await toReview();
    expect(screen.getByDisplayValue("<b>x</b> https://a.b")).toBeInTheDocument();
    expect(screen.getByText("<b>y</b> https://c.d")).toBeInTheDocument();
    expect(document.querySelector("b, a")).toBeNull();
  });
});

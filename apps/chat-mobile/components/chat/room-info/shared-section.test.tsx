import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { QuickAction } from "./quick-action";
import { SharedSection } from "./shared-section";

const photo = (id: string, extra: Record<string, string> = {}) => ({ message_id: id, title: "", created_at: "2026-10-20T00:00:00Z", thumb_url: `https://cdn/${id}.jpg`, ...extra });
const summary = (photos: ReturnType<typeof photo>[], photoCount: number) => ({
  counts: { photo: photoCount, gif: 0, video: 0, file: 2, link: 0, voice: 1 },
  recent_photos: photos,
});

describe("SharedSection", () => {
  it("lists the newest photos, opens one at its message, and says how many more the last tile hides", async () => {
    const open = jest.fn();
    await render(<SharedSection shared={summary([photo("p1", { title: "Biển" }), photo("p2", { thumb_url: "" }), photo("p3")], 9)} onOpenMessage={open} />);
    await fireEvent.press(screen.getByRole("imagebutton", { name: "Biển" }));
    expect(open).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("imagebutton", { name: viText("chat.media_image") })).toBeTruthy();
    expect(screen.getByRole("imagebutton", { name: viText("chat.mobile.shared_more_photos", { count: 9 }) })).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
  });

  it("switches kind by tab and says what each one holds", async () => {
    await render(<SharedSection shared={summary([], 0)} onOpenMessage={jest.fn()} />);
    expect(screen.getByText(viText("chat.mobile.shared_tab_hint", { count: 0 }))).toBeTruthy();
    const files = screen.getByRole("tab", { name: viText("chat.mobile.tab_files", { count: 2 }) });
    await fireEvent.press(files);
    expect(screen.getByRole("tab", { name: viText("chat.mobile.tab_files", { count: 2 }), selected: true })).toBeTruthy();
    expect(screen.getByText(viText("chat.mobile.shared_tab_hint", { count: 2 }))).toBeTruthy();
  });
});

describe("QuickAction", () => {
  it("is a button named by its label, or by the longer name it is given", async () => {
    const press = jest.fn();
    await render(<QuickAction icon="search" label="Tìm" accessibilityLabel="Tìm trong cuộc trò chuyện" onPress={press} />);
    await fireEvent.press(screen.getByRole("button", { name: "Tìm trong cuộc trò chuyện" }));
    expect(press).toHaveBeenCalled();
  });
});

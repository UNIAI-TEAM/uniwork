// A face: the photo when there is one (cached by its URL without the
// signature, and cleared when a recycled list cell shows someone else), else
// the person's initials on their colour, with the online dot.
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { act, screen } from "@testing-library/react-native";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { userKey } from "@/lib/user-id";
import { render } from "@/test/render";
import { LivePersonAvatar, PersonAvatar } from "./person-avatar";

const tree = () => JSON.stringify(screen.toJSON());

beforeEach(() => configureRuntime({ apiUrl: "https://api.example" }));
afterEach(() => {
  resetRuntimeConfig();
  usePresenceStore.setState({ onlineUserIds: {} });
});

describe("PersonAvatar", () => {
  it("draws the photo keyed by its URL without the signature, recycled under that key", async () => {
    await render(<PersonAvatar name="An" avatarUrl="https://cdn.example/a.png?sig=1" />);
    expect(tree()).toContain('"recyclingKey":"https://cdn.example/a.png"');
    expect(tree()).not.toContain('"AN"');
  });

  it("reaches a server-relative photo through the API origin", async () => {
    await render(<PersonAvatar name="An" avatarUrl="/files/a.png" />);
    expect(tree()).toContain("https://api.example/files/a.png");
  });

  it("draws initials without a photo, a room's on a squircle, and the online dot", async () => {
    const { rerender } = await render(<PersonAvatar name="An Nguyễn" seed="U1" />);
    // Decorative: the row around it says the name, so the letters are hidden from the screen reader.
    expect(screen.getByText("AN", { includeHiddenElements: true })).toBeTruthy();
    await rerender(<PersonAvatar name="Thiết kế" squircle online />);
    expect(tree()).toContain("bg-success-solid");
  });
});

describe("LivePersonAvatar", () => {
  it("shows the dot while that person is online", async () => {
    await render(<LivePersonAvatar name="Bình" userId="U2" />);
    expect(tree()).not.toContain("bg-success-solid");
    await act(async () => usePresenceStore.setState({ onlineUserIds: { [userKey("U2")]: true } }));
    expect(tree()).toContain("bg-success-solid");
  });
});

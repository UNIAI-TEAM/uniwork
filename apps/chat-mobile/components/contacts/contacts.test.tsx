// The contacts tab's parts, as a person hears them: the strip of people online,
// each person of the A–Z list, and the letters that jump the list.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import type { ContactRow } from "@/lib/contacts-display";
import { userKey } from "@/lib/user-id";
import { render, viText } from "@/test/render";
import { ContactItem, ContactSeparator } from "./contact-item";
import { LetterIndex } from "./letter-index";
import { OnlineStrip } from "./online-strip";

const person = (id: string, label: string, email = `${id}@uni.vn`): ContactRow => ({ user_id: id, email, display_name: label, label });
const online = (...ids: string[]) => usePresenceStore.setState({ onlineUserIds: Object.fromEntries(ids.map((id) => [userKey(id), true as const])) });

beforeEach(() => online());

describe("OnlineStrip", () => {
  it("shows only the people online, counted, and opens the DM of the one tapped", async () => {
    online("u2");
    const open = jest.fn();
    await render(<OnlineStrip people={[person("u1", "An Nguyễn"), person("u2", "Bình Trần")]} onPress={open} />);
    expect(screen.getByRole("header", { name: `${viText("chat.presence_online")} · 1` })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: `An Nguyễn, ${viText("chat.presence_online")}` })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: `Bình Trần, ${viText("chat.presence_online")}` }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u2" }));
  });

  it("draws nothing while no one is online", async () => {
    await render(<OnlineStrip people={[person("u1", "An")]} onPress={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe("ContactItem", () => {
  it("names the person, whether they are online and their email, and opens the DM", async () => {
    const open = jest.fn();
    await render(<ContactItem row={person("u1", "An Nguyễn")} onPress={open} />);
    await fireEvent.press(screen.getByRole("button", { name: "An Nguyễn, u1@uni.vn" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1" }));
    await act(() => online("u1"));
    expect(screen.getByRole("button", { name: `An Nguyễn, ${viText("chat.presence_online")}, u1@uni.vn` })).toBeOnTheScreen();
  });

  it("does not repeat the email when it is all the person is called", async () => {
    await render(<ContactItem row={person("u1", "an@uni.vn", "an@uni.vn")} onPress={jest.fn()} />);
    expect(screen.getByRole("button", { name: "an@uni.vn" })).toBeOnTheScreen();
    expect(screen.getAllByText("an@uni.vn")).toHaveLength(1);
  });

  it("is separated past the avatar", async () => {
    await render(<ContactSeparator />);
    expect(screen.toJSON()).not.toBeNull();
  });
});

describe("LetterIndex", () => {
  it("is a menu of letters, each jumping to its section", async () => {
    const jump = jest.fn();
    await render(<LetterIndex letters={["A", "B", "Đ"]} onJump={jump} />);
    expect(screen.getByLabelText(viText("chat.mobile.alphabet_index"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Đ" }));
    expect(jump).toHaveBeenCalledWith(2);
  });
});

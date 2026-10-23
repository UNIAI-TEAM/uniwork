// The contacts tab's parts, as a person hears them: the strip of people online,
// each person of the A–Z list, the letters that jump the list, and the list of
// a thousand people (audit P1 Perf: a jump past what is drawn never throws).
import { act, fireEvent, screen } from "@testing-library/react-native";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import type { ContactRow } from "@/lib/contacts-display";
import { userKey } from "@/lib/user-id";
import { Text } from "@/components/ui/text";
import { listAnchoring } from "@/test/list-anchoring";
import { render, viText } from "@/test/render";
import { contactSections, type ContactSection } from "@/lib/contacts-display";
import { ContactItem } from "./contact-item";
import { ContactList } from "./contact-list";
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

  it("draws the inset line under it only when separated", async () => {
    const lines = () => JSON.stringify(screen.toJSON()).match(/ms-\[72px\]/g)?.length ?? 0;
    const { rerender } = await render(<ContactItem row={person("u1", "An")} onPress={jest.fn()} />);
    expect(lines()).toBe(0);
    await rerender(<ContactItem row={person("u1", "An")} onPress={jest.fn()} separated />);
    expect(lines()).toBe(1);
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

describe("ContactList", () => {
  // A thousand people, A to Z: "Người 0000" … sorted by their first letter, which cycles through the alphabet.
  const ALPHABET = "ABCDEGHIKLMNOPQRSTUVXY";
  const thousand = (): ContactSection[] =>
    contactSections(
      Array.from({ length: 1000 }, (_, n) => ({ user_id: `u${n}`, email: `u${n}@uni.vn`, display_name: `${ALPHABET[n % ALPHABET.length]}${String(n).padStart(4, "0")}` })),
      { currentUserId: "me", hiddenUserIds: new Set(), query: "" },
    );
  const list = (sections: ContactSection[], extra: Partial<Parameters<typeof ContactList>[0]> = {}) => (
    <ContactList sections={sections} onPress={jest.fn()} showIndex header={null} empty={<></>} refreshing={false} onRefresh={jest.fn()} {...extra} />
  );

  it("mounts about a screenful of a thousand people, not all of them", async () => {
    await render(list(thousand()));
    const drawn = screen.getAllByRole("button", { name: /@uni\.vn$/ }).length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(100);
    // The letter's cell, and the sticky copy over the list.
    expect(screen.getAllByRole("header", { name: "A" }).length).toBeGreaterThan(0);
  });

  it("jumps to a letter far past what is drawn without throwing, and lands in its section", async () => {
    await render(list(thousand()));
    expect(screen.queryAllByRole("header", { name: "Y" })).toHaveLength(0);
    expect(screen.queryByText(/^X05/)).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Y" }));
    });
    // The list moved to the end: the last letters are drawn, and Y's header is the sticky one.
    expect((await screen.findAllByRole("header", { name: "Y" })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^X05/).length).toBeGreaterThan(0);
  });

  it("opens the DM of the person tapped", async () => {
    const open = jest.fn();
    await render(list(contactSections([person("u1", "An"), person("u2", "Bình")], { currentUserId: "me", hiddenUserIds: new Set(), query: "" }), { onPress: open }));
    await fireEvent.press(screen.getByRole("button", { name: "Bình, u2@uni.vn" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u2" }));
  });

  it("hides the letters while a search narrows the list, or when there is one letter", async () => {
    const two = contactSections([person("u1", "An"), person("u2", "Bình")], { currentUserId: "me", hiddenUserIds: new Set(), query: "" });
    const { rerender } = await render(list(two, { showIndex: false }));
    expect(screen.queryByLabelText(viText("chat.mobile.alphabet_index"))).toBeNull();
    await rerender(list(two.slice(0, 1)));
    expect(screen.queryByLabelText(viText("chat.mobile.alphabet_index"))).toBeNull();
    await rerender(list(two));
    expect(screen.getByLabelText(viText("chat.mobile.alphabet_index"))).toBeOnTheScreen();
  });

  it("starts a narrowed list at its first match, not at the row that was on top before", async () => {
    // FlashList 2 keeps the old first visible row in place across a data change unless told not to: a search that
    // still matches the person on top would open with every match above them scrolled out of view.
    const everyone = contactSections([person("u1", "An"), person("u2", "Bình"), person("u3", "Chi"), person("u4", "Dũng")], { currentUserId: "me", hiddenUserIds: new Set(), query: "" });
    const { rerender } = await render(list(everyone));
    expect(listAnchoring(screen.toJSON())).toEqual({ maintained: [], anchors: [] });
    const narrowed = contactSections([person("u0", "Anh"), person("u1", "An"), person("u4", "Dũng")], { currentUserId: "me", hiddenUserIds: new Set(), query: "" });
    await rerender(list(narrowed, { showIndex: false }));
    expect(listAnchoring(screen.toJSON())).toEqual({ maintained: [], anchors: [] });
    expect(screen.getByRole("button", { name: "An, u1@uni.vn" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Anh, u0@uni.vn" })).toBeOnTheScreen();
  });

  it("shows what it is given while there is no one", async () => {
    await render(list([], { empty: <Text>{"trống"}</Text> }));
    expect(screen.getByText("trống")).toBeOnTheScreen();
  });
});

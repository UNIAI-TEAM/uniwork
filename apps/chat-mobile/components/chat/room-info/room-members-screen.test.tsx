// Every member of a conversation (room-members-screen.tsx): a recycling list
// that mounts a screenful of a thousand people, a folded search over names and
// emails, and a tap on someone else that opens the member sheet and, from it,
// the DM.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { render, viText } from "@/test/render";
import { RoomMembersScreen } from "./room-members-screen";

const mockRoom = {
  members: [] as { user_id: string; email: string; role: string }[],
  nameContext: [] as { user_id: string; display_name: string; email?: string }[],
};
jest.mock("../use-room-context", () => ({ useRoomContext: () => mockRoom }));
// The member sheet's own test is room-safety.test.tsx: here a stand-in names who it opened for and offers the DM.
jest.mock("../room-safety", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    MemberSafetySheet: ({ person, ...props }: { person: { userId: string; name: string } | null; onClose: () => void; onMessage: (p: { userId: string; name: string }) => void }) =>
      person ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={`message ${person.name}`} onPress={() => props.onMessage(person)}>
            <Text>sheet</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="close sheet" onPress={props.onClose}>
            <Text>close</Text>
          </Pressable>
        </>
      ) : null,
  };
});

const chat = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };

beforeEach(() => {
  jest.clearAllMocks();
  mockRoom.members = [
    { user_id: "ME", email: "me@acme.vn", role: "member" },
    { user_id: "U2", email: "binh@acme.vn", role: "admin" },
    { user_id: "U3", email: "chi@acme.vn", role: "member" },
  ];
  mockRoom.nameContext = [
    { user_id: "U2", display_name: "Bình Trần" },
    { user_id: "U3", display_name: "Chi Lê" },
  ];
});

describe("RoomMembersScreen", () => {
  it("counts everyone in its title and opens the DM of someone else from their sheet, never one's own row", async () => {
    await render(<RoomMembersScreen chat={chat} roomId="r1" />);
    expect(screen.getByText(`${viText("chat.members_title")} · 3`)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: new RegExp(`^${viText("chat.you")},`) })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Bình Trần,/ }));
    await fireEvent.press(screen.getByRole("button", { name: "message Bình Trần" }));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining("/acme/hq"));
    await fireEvent.press(screen.getByRole("button", { name: "close sheet" }));
    expect(screen.queryByRole("button", { name: "close sheet" })).toBeNull();
  });

  it("narrows to the people whose name or email holds the search, and says when nobody does", async () => {
    await render(<RoomMembersScreen chat={chat} roomId="r1" />);
    const search = screen.getByLabelText(viText("chat.workspace_members_search"));
    await act(async () => fireEvent.changeText(search, "chi@"));
    expect(screen.getByText("Chi Lê")).toBeOnTheScreen();
    expect(screen.queryByText("Bình Trần")).toBeNull();
    await act(async () => fireEvent.changeText(search, "nobody"));
    expect(screen.getByText(viText("chat.mention_no_results"))).toBeOnTheScreen();
  });

  it("mounts about a screenful of a thousand members, not all of them, and titles an empty room without a count", async () => {
    mockRoom.members = Array.from({ length: 1000 }, (_, n) => ({ user_id: `U${n}`, email: `u${n}@acme.vn`, role: "member" }));
    mockRoom.nameContext = [];
    const view = await render(<RoomMembersScreen chat={chat} roomId="r1" />);
    expect(screen.getAllByText(/^u\d+@acme\.vn$/).length).toBeLessThan(60);
    mockRoom.members = [];
    await view.rerender(<RoomMembersScreen chat={chat} roomId="r1" />);
    expect(screen.getByText(viText("chat.members_title"))).toBeOnTheScreen();
    expect(screen.queryByText(viText("chat.mention_no_results"))).toBeNull();
  });
});

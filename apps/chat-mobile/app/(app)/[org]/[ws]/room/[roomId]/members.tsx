// Every member of a conversation (components/chat/room-info/room-members-screen.tsx),
// opened from its details' "Xem tất cả".
import { Stack, useLocalSearchParams } from "expo-router";
import { RoomMembersScreen } from "@/components/chat/room-info/room-members-screen";
import { useChatWorkspace } from "@/components/chat/use-chat-workspace";

export default function RoomMembersRoute() {
  const chat = useChatWorkspace();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat && roomId ? <RoomMembersScreen chat={chat} roomId={roomId} /> : null}
    </>
  );
}

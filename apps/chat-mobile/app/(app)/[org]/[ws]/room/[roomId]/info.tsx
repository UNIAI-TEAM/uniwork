// A conversation's details (spec §2.4, MobRoomInfo board): who it is; mute,
// search, call and (a group) add people as round quick actions; search inside
// it (searchChatRoomMessages; a result opens the room at that message); what it
// has shared (GET …/shared-summary: counts per kind, the newest photos); its
// pins, notes and polls; its members with presence (a tap on someone else
// opens a DM, report or block); for a DM, block and report (room-safety.tsx);
// and leaving it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { voiceCallKindFromServer } from "@uniwork/core/chat/voice-call-kind";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, TextInput, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { DmSafetyRows, MemberSafetySheet, type SafetyPerson } from "@/components/chat/room-safety";
import { RoomInfoHero, RoomQuickActions } from "@/components/chat/room-info/hero";
import { KeptRow } from "@/components/chat/room-info/kept-row";
import { LeaveRoomRow } from "@/components/chat/room-info/leave-row";
import { RoomMembersSection } from "@/components/chat/room-info/members-section";
import { Divider } from "@/components/chat/room-info/quick-action";
import { RoomSearchResults } from "@/components/chat/room-info/search-results";
import { SharedSection } from "@/components/chat/room-info/shared-section";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useRoomContext } from "@/components/chat/use-room-context";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { SearchField } from "@/components/ui/search-field";
import { callEngine } from "@/data/calls/call-store";
import { useLeaveRoom, useSetRoomMuted } from "@/data/mutations/rooms";
import { roomSearchOptions, roomTimelineOptions, sharedSummaryOptions } from "@/data/queries/chat";
import { useMobileFlag } from "@/data/remote-config";
import { toast } from "@/data/stores/toast-store";
import { chatRoutes } from "@/lib/chat-routes";
import { canCallRoom, keptCounts } from "@/lib/conversation-display";
import { inAppDmHref } from "@/lib/deep-link";
import { senderLabelFor } from "@/lib/people-display";

/** The screen once the workspace resolved: its queries and the wiring of the parts (components/chat/room-info/). */
function RoomInfo({ chat, roomId }: { chat: ChatWorkspace; roomId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const leaveRoom = useLeaveRoom(chat.wsId).mutateAsync;
  const setRoomMuted = useSetRoomMuted(chat.wsId).mutateAsync;
  const room = useRoomContext(chat, roomId);
  const searchInput = useRef<TextInput>(null);
  const [q, setQ] = useState("");
  const [memberMenu, setMemberMenu] = useState<SafetyPerson | null>(null);
  const search = useQuery(roomSearchOptions(chat.wsId, roomId, q));
  const shared = useQuery(sharedSummaryOptions(chat.wsId, roomId)).data;
  const muted = room.room?.notifications_muted === true;
  const callsOn = useMobileFlag("unichat_mobile_calls");
  // Pins, notes and polls among the messages the room already loaded; the row opens the room, where the pinned bar is.
  const loaded = qc.getQueryData<RoomTimeline>(roomTimelineOptions(chat.wsId, roomId).queryKey);
  const kept = useMemo(() => keptCounts((loaded?.pages ?? []).flat()), [loaded]);
  const openAt = (messageId?: string) => router.dismissTo(chatRoutes.room(chat, roomId, messageId));

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={t("chat.mobile.room_info")} centered flat />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="pb-10">
        <RoomInfoHero room={room.room} roomId={roomId} title={room.title} peerOnline={room.peerOnline} memberCount={room.members.length || (room.room?.member_count ?? 0)} />
        {room.room ? (
          <RoomQuickActions
            muted={muted}
            callable={canCallRoom(room.room, callsOn)}
            isGroup={room.room.kind === "group"}
            onToggleMute={() => void setRoomMuted({ roomId, muted: !muted }).catch(() => toast.error(t("common.error")))}
            onSearch={() => searchInput.current?.focus()}
            onCall={() => void ensureCallPermissions(false).then(() => callEngine.startCall(roomId, room.title, voiceCallKindFromServer(room.room?.kind), { withCamera: false }))}
            onAddPeople={() => router.push(chatRoutes.newGroup(chat, roomId))}
          />
        ) : null}

        <View className="px-5 pb-3.5">
          <SearchField ref={searchInput} value={q} onChangeText={setQ} placeholder={t("chat.search_messages")} accessibilityLabel={t("chat.search_messages")} />
        </View>
        <RoomSearchResults query={q} fetching={search.isFetching} results={search.data} senderName={room.senderName} onOpen={openAt} />

        <Divider />
        {shared ? <SharedSection shared={shared} onOpenMessage={openAt} /> : null}
        <KeptRow kept={kept} onPress={() => openAt()} />

        <Divider />
        <RoomMembersSection
          members={room.members}
          currentUserId={chat.userId}
          nameOf={(member) => senderLabelFor({ sender: member.user_id }, chat.userId, t("chat.you"), room.nameContext)}
          onOpen={setMemberMenu}
        />

        {room.room?.kind === "dm" && room.room.peer_user_id ? (
          <>
            <Divider />
            <DmSafetyRows wsId={chat.wsId} person={{ userId: room.room.peer_user_id, name: room.title }} />
          </>
        ) : null}

        {room.room !== null && !isDefaultWorkspaceChannel(room.room) ? (
          <>
            <Divider />
            <LeaveRoomRow dm={room.room.kind === "dm"} onLeave={() => leaveRoom(roomId)} />
          </>
        ) : null}
      </ScrollView>
      <MemberSafetySheet
        wsId={chat.wsId}
        person={memberMenu}
        onClose={() => setMemberMenu(null)}
        onMessage={(person) => router.push(inAppDmHref(chat, person.userId))}
      />
    </View>
  );
}

export default function RoomInfoScreen() {
  const chat = useChatWorkspace();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat && roomId ? <RoomInfo chat={chat} roomId={roomId} /> : null}
    </>
  );
}

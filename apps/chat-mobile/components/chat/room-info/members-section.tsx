// The members of a conversation in its details: the first few, then "see all",
// which opens every one of them on a screen of their own, a recycling list
// (room-members-screen.tsx): a default channel holds the whole workspace. A tap
// on someone else opens what can be done with them (a DM, report, block).
// Moved out of the route file, which only composes.
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { RoomMemberRow } from "@/components/people/member-rows";
import { Text } from "@/components/ui/text";

/** Members shown before "Xem tất cả" (the board lists four). */
export const MEMBERS_PREVIEW = 5;

interface Member {
  user_id: string;
  email: string;
  role: string;
}

export function RoomMembersSection(props: {
  members: readonly Member[];
  currentUserId: string;
  nameOf: (member: Member) => string;
  onOpen: (person: { userId: string; name: string }) => void;
  onSeeAll: () => void;
}) {
  const { t } = useTranslation();
  const shown = props.members.slice(0, MEMBERS_PREVIEW);
  return (
    <View className="px-5 pb-2 pt-3.5">
      <View className="mb-1 flex-row items-center">
        <Text className="flex-1 text-footnote font-semibold text-muted-foreground" accessibilityRole="header">
          {props.members.length > 0 ? `${t("chat.members_title")} · ${props.members.length}` : t("chat.members_title")}
        </Text>
        {props.members.length > MEMBERS_PREVIEW ? (
          <Pressable accessibilityRole="button" onPress={props.onSeeAll} hitSlop={10} className="min-h-11 justify-center">
            <Text className="text-footnote font-semibold text-primary">{t("chat.mobile.see_all")}</Text>
          </Pressable>
        ) : null}
      </View>
      {shown.map((member, index) => (
        <RoomMemberRow
          key={member.user_id}
          userId={member.user_id}
          name={props.nameOf(member)}
          email={member.email}
          admin={member.role === "admin"}
          last={index === shown.length - 1}
          onOpen={member.user_id === props.currentUserId ? undefined : props.onOpen}
        />
      ))}
    </View>
  );
}

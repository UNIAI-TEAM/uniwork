// The people rows of the new-message picker, the group picker and a room's
// details. Each row reads its own person's presence (useIsOnline) and is
// memoized, so a presence change redraws the row of the person who came or
// went, not the screen and every row on it (audit P2 Perf, S5 review). Pass
// stable callbacks: a new closure per render would redraw every row again.
import { Ionicons } from "@expo/vector-icons";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "./person-avatar";
import { useIsOnline } from "./use-is-online";

/** A workspace member as the pickers list them: the name the viewer reads them by. */
interface PickPerson {
  user_id: string;
  label: string;
  email: string;
}

const ROW_BODY = "min-w-0 flex-1 flex-row items-center gap-3 self-stretch py-2 pr-4";

/** "Tin nhắn mới": a tap opens the DM with this person; `busy` while it is being opened. */
export const DmPickRow = memo(function DmPickRow(props: { person: PickPerson; last: boolean; busy: boolean; disabled: boolean; onOpen: (userId: string) => void }) {
  const { person, busy } = props;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const online = useIsOnline(person.user_id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[`${t("chat.start_dm")}: ${person.label}`, online ? t("chat.presence_online") : null].filter(Boolean).join(", ")}
      accessibilityState={{ busy }}
      disabled={props.disabled}
      onPress={() => props.onOpen(person.user_id)}
      className={cn("min-h-16 flex-row items-center gap-3 pl-4 active:bg-secondary", busy && "bg-muted")}
    >
      <PersonAvatar name={person.label} size={44} online={online} seed={person.user_id} />
      <View className={cn(ROW_BODY, !props.last && "border-b-hairline border-border")}>
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-body font-display font-bold text-foreground" numberOfLines={1}>
            {person.label}
          </Text>
          {person.email ? (
            <Text className="text-callout text-muted-foreground" numberOfLines={1}>
              {person.email}
            </Text>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={THEME[colorScheme].primary} /> : null}
      </View>
    </Pressable>
  );
});

/** "Tạo nhóm" / "Thêm": a tap picks or unpicks this person; someone already in the group reads as picked and cannot be. */
export const GroupPickRow = memo(function GroupPickRow(props: { person: PickPerson; last: boolean; isIn: boolean; selected: boolean; onToggle: (userId: string) => void }) {
  const { person, isIn } = props;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const online = useIsOnline(person.user_id);
  const checked = props.selected || isIn;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: isIn }}
      accessibilityLabel={[person.label, isIn ? t("chat.already_in_group") : null].filter(Boolean).join(", ")}
      disabled={isIn}
      onPress={() => props.onToggle(person.user_id)}
      className="min-h-16 flex-row items-center gap-3 pl-4 active:bg-secondary"
    >
      <PersonAvatar name={person.label} size={44} online={online} seed={person.user_id} />
      <View className={cn(ROW_BODY, !props.last && "border-b-hairline border-border")}>
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-body font-display font-bold text-foreground" numberOfLines={1}>
            {person.label}
          </Text>
          <Text className="text-callout text-muted-foreground" numberOfLines={1}>
            {isIn ? t("chat.already_in_group") : person.email}
          </Text>
        </View>
        <View className={cn("h-6 w-6 items-center justify-center rounded-full border-2", checked ? "border-primary bg-primary" : "border-border")}>
          {checked ? <Ionicons name="checkmark" size={15} color={THEME[colorScheme].primaryForeground} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

/** A member's row: someone else's opens their menu (a DM, report, block); one's own only reads out. */
function MemberRowShell({ label, onPress, children }: { label: string; onPress?: () => void; children: ReactNode }) {
  const className = "min-h-14 flex-row items-center gap-3";
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} className={className}>
        {children}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className={`${className} active:opacity-70`}>
      {children}
    </Pressable>
  );
}

/** A room member in its details: online, or their email; an admin's badge. No `onOpen` for one's own row. */
export const RoomMemberRow = memo(function RoomMemberRow(props: {
  userId: string;
  name: string;
  email: string;
  admin: boolean;
  last: boolean;
  onOpen?: (person: { userId: string; name: string }) => void;
}) {
  const { userId, name, onOpen } = props;
  const { t } = useTranslation();
  const online = useIsOnline(userId);
  const status = online ? t("chat.presence_online") : props.email;
  const role = props.admin ? t("chat.mobile.room_role_admin_short") : null;
  return (
    <MemberRowShell label={[name, status, role].filter(Boolean).join(", ")} onPress={onOpen ? () => onOpen({ userId, name }) : undefined}>
      <PersonAvatar name={name} size={40} online={online} seed={userId} />
      <View className={cn("min-w-0 flex-1 flex-row items-center gap-2 self-stretch py-1.5", !props.last && "border-b-hairline border-border")}>
        <View className="min-w-0 flex-1">
          <Text className="text-subhead font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
          {status ? (
            <Text className={cn("text-footnote", online ? "text-success-solid" : "text-muted-foreground")} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
        </View>
        {role ? (
          <View className="min-h-6 justify-center rounded-full bg-tint-blue px-2.5">
            <Text className="text-caption font-semibold text-primary">{role}</Text>
          </View>
        ) : null}
      </View>
    </MemberRowShell>
  );
});

// One person of the contacts tab's A–Z list. Moved out of the route file, which only composes.
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { useIsOnline } from "@/components/people/use-is-online";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import type { ContactRow } from "@/lib/contacts-display";

/** Inset past the avatar, inside each letter group. */
function ContactSeparator() {
  return <Separator className="ms-[72px] w-auto" />;
}

interface Props {
  row: ContactRow;
  onPress: (row: ContactRow) => void;
  /** An inset line under the row: every row but the last of its letter. */
  separated?: boolean;
}

/**
 * One person; redraws when that person comes or goes, not when anyone else does. The cell holds no state of
 * its own, so a recycled one (contact-list.tsx) draws its new row.
 */
export const ContactItem = memo(function ContactItem({ row, onPress, separated = false }: Props) {
  const { t } = useTranslation();
  const online = useIsOnline(row.user_id);
  const subtitle = row.label === row.email ? "" : row.email;
  return (
    <View>
      <Pressable
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={[row.label, online ? t("chat.presence_online") : "", subtitle].filter(Boolean).join(", ")}
        className="min-h-[60px] flex-row items-center gap-3 px-4 py-2 active:bg-secondary"
      >
        <PersonAvatar name={row.label} avatarUrl={row.avatar_url} size={44} online={online} seed={row.user_id} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-body font-semibold text-foreground">
            {row.label}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-callout text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {separated ? <ContactSeparator /> : null}
    </View>
  );
});

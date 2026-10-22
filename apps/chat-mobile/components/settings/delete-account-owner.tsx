// What Settings › Delete account (delete-account.tsx) shows an organization owner, from what the server's
// owner_must_transfer names (lib/account-deletion.ts › ownedOrganization). The only active member closes the
// organization together with the erasure, typing its address again (Apple 5.1.1(v): deletion completes in the
// app); an owner whose organization has other members hands it over on the web first.
import { Ionicons } from "@expo/vector-icons";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { OwnedOrganization } from "@/lib/account-deletion";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";

/** An owner who cannot close: hand the organization over on the web (openWeb opens its settings there). */
export function OwnerTransferPanel({
  organization,
  notice,
  foreground,
  onOpenWeb,
}: {
  organization: OwnedOrganization | null;
  /** Why closing stopped being offered (someone joined meanwhile), said above the way out. */
  notice: string | null;
  foreground: string;
  onOpenWeb: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert" className="gap-2.5 rounded-xl border border-destructive/40 p-3.5" style={continuousCorners}>
      <Text className="text-body font-semibold text-foreground">{t("mobile.account.owner_title")}</Text>
      {notice ? <Text className="text-subhead leading-[21px] text-destructive">{notice}</Text> : null}
      <Text className="text-subhead leading-[21px] text-foreground">
        {organization ? t("mobile.account.owner_body_named", { name: organization.name }) : t("mobile.account.owner_body")}
      </Text>
      <Pressable
        accessibilityRole="link"
        // The label, not the children: the icon's glyph is a character a screen reader would spell.
        accessibilityLabel={t("mobile.account.owner_open_web")}
        onPress={onOpenWeb}
        className="min-h-11 flex-row items-center justify-center gap-2 rounded-full bg-muted px-4 py-2.5 active:opacity-70"
      >
        <Text className="text-subhead font-semibold text-foreground">{t("mobile.account.owner_open_web")}</Text>
        <Ionicons name="open-outline" size={16} color={foreground} />
      </Pressable>
    </View>
  );
}

/** The only active member: what closing does, and the organization's address typed again to confirm it. */
export function CloseOrganizationField({
  organization,
  value,
  onChangeText,
  error,
  busy,
  placeholderColor,
  onSubmit,
  inputRef,
}: {
  organization: OwnedOrganization;
  value: string;
  onChangeText: (next: string) => void;
  error: string | null;
  busy: boolean;
  placeholderColor: string;
  onSubmit: () => void;
  inputRef: Ref<TextInput>;
}) {
  const { t } = useTranslation();
  const label = t("mobile.account.close_label", { slug: organization.slug });
  return (
    <View className="gap-2.5 rounded-xl border border-destructive/40 p-3.5" style={continuousCorners}>
      <Text accessibilityRole="header" className="text-body font-semibold text-foreground">
        {t("mobile.account.close_title")}
      </Text>
      <Text className="text-subhead leading-[21px] text-foreground">{t("mobile.account.close_body", { name: organization.name })}</Text>
      <Text className="text-subhead font-semibold text-foreground">{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        placeholder={organization.slug}
        placeholderTextColor={placeholderColor}
        accessibilityLabel={label}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        testID="delete-account-close-slug"
        className={cn("min-h-12 rounded-xl border bg-muted px-3.5 py-3 text-body text-foreground", error ? "border-destructive" : "border-border")}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-subhead text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

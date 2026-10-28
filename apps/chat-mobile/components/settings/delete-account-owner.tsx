// What Settings › Delete account (delete-account.tsx) shows an organization owner, from what the server's
// owner_must_transfer names (lib/owned-organization.ts › ownedOrganization; the state is use-owner-step.ts). The
// only active member closes the organization together with the erasure, typing its address again (Apple 5.1.1(v):
// deletion completes in the app); an owner whose organization has other members hands it over in the sheet
// (delete-account-hand-over.tsx), or on the web when an older server names no organization.
import { Ionicons } from "@expo/vector-icons";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { OwnedOrganization } from "@/lib/owned-organization";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";
import { HandOverPanel } from "./delete-account-hand-over";
import type { Field, OwnerStep } from "./use-owner-step";

/** Whichever owner panel the step is at: the address to close, the hand-over list, or the way out on the web. */
export function OwnerStepPanel({
  step,
  error,
  busy,
  foreground,
  placeholderColor,
  onEdit,
  onSubmit,
  onOpenWeb,
}: {
  step: OwnerStep;
  error: { message: string; field: Field } | null;
  busy: boolean;
  foreground: string;
  placeholderColor: string;
  /** The person typed or picked: the refusal on screen no longer applies. */
  onEdit: () => void;
  onSubmit: () => void;
  onOpenWeb: () => void;
}) {
  const { closing, handingOver, handOver, owner } = step;
  if (closing) {
    return (
      <CloseOrganizationField
        organization={closing}
        value={step.closeSlug}
        onChangeText={(next) => {
          step.setCloseSlug(next);
          onEdit();
        }}
        error={error?.field === "slug" ? error.message : null}
        busy={busy}
        placeholderColor={placeholderColor}
        onSubmit={onSubmit}
        inputRef={step.slugInput}
      />
    );
  }
  if (handingOver) {
    return (
      <HandOverPanel
        organization={handingOver}
        notice={owner?.notice ?? null}
        candidates={handOver.candidates}
        loading={handOver.loading}
        selected={handOver.heir}
        onSelect={(heir) => {
          handOver.choose(heir);
          onEdit();
        }}
        onRetry={handOver.reload}
        error={error?.field === "pick" ? error.message : null}
        busy={busy}
        foreground={foreground}
        onOpenWeb={onOpenWeb}
      />
    );
  }
  return owner ? <OwnerTransferPanel foreground={foreground} onOpenWeb={onOpenWeb} /> : null;
}

/** An owner the server named no organization for (an older server): hand it over on the web, which opens its settings. */
function OwnerTransferPanel({ foreground, onOpenWeb }: { foreground: string; onOpenWeb: () => void }) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert" className="gap-2.5 rounded-xl border border-destructive/40 p-3.5" style={continuousCorners}>
      <Text className="text-body font-semibold text-foreground">{t("mobile.account.owner_title")}</Text>
      <Text className="text-subhead leading-[21px] text-foreground">{t("mobile.account.owner_body")}</Text>
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
function CloseOrganizationField({
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

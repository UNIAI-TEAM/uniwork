// Blocking and reporting where a person is (Apple 1.2, Google Play's
// user-generated content policy), with the web's words (chat.block_*): the
// DM's details get block / unblock and report; a group member's row opens a
// menu with a DM, report and block; the DM itself says when either side
// blocked. A block hides the DM from the one who blocked (ChatService.
// hideDMWithPeer), so blocking from its details goes back to the list.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { blockStatusOptions, setBlocked } from "@/data/queries/safety";
import { toast } from "@/data/stores/toast-store";
import type { ReportTarget } from "@/lib/report";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { ReportSheet } from "./report-sheet";

export interface SafetyPerson {
  userId: string;
  name: string;
}

/** Asks first (the web's confirm), then blocks; an unblock needs no confirm. */
function useBlockToggle(wsId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return (person: SafetyPerson, blocked: boolean, onBlocked?: () => void) => {
    if (blocked) {
      void setBlocked(qc, wsId, person.userId, false).then(
        () => toast.success(t("mobile.safety.unblocked", { name: person.name })),
        () => toast.error(t("chat.unblock_failed")),
      );
      return;
    }
    Alert.alert(t("chat.block_confirm_title"), t("chat.block_confirm_description"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.block_user"),
        style: "destructive",
        onPress: () =>
          void setBlocked(qc, wsId, person.userId, true).then(
            () => {
              toast.success(t("mobile.safety.blocked", { name: person.name }));
              onBlocked?.();
            },
            () => toast.error(t("chat.block_failed")),
          ),
      },
    ]);
  };
}

function SafetyRow({ icon, label, destructive, onPress }: { icon: "ban-outline" | "flag-outline"; label: string; destructive: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    // The label, not the children: the icon's glyph is a character a screen reader would spell.
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="min-h-14 flex-row items-center gap-3 px-5 active:bg-secondary">
      <Ionicons name={icon} size={22} color={destructive ? theme.destructive : theme.mutedForeground} />
      <Text className={destructive ? "text-body font-semibold text-destructive" : "text-body font-semibold text-foreground"}>{label}</Text>
    </Pressable>
  );
}

/** The DM's details: block or unblock the other person, and report them. */
export function DmSafetyRows({ wsId, person }: { wsId: string; person: SafetyPerson }) {
  const { t } = useTranslation();
  const status = useQuery(blockStatusOptions(wsId, person.userId)).data;
  const toggle = useBlockToggle(wsId);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const blockedByMe = status?.blocked_by_me === true;
  // The DM is gone from the list for the one who blocked: back to it.
  const leave = () => router.dismissAll();
  return (
    <View>
      <Text className="px-5 pb-1 pt-3.5 text-footnote font-semibold text-muted-foreground" accessibilityRole="header">
        {t("mobile.safety.section")}
      </Text>
      {status?.blocked_me ? <Text className="px-5 pb-1 text-footnote text-muted-foreground">{t("chat.blocked_me_hint")}</Text> : null}
      <SafetyRow icon="ban-outline" label={blockedByMe ? t("chat.unblock_user") : t("chat.block_user")} destructive={!blockedByMe} onPress={() => toggle(person, blockedByMe, leave)} />
      <SafetyRow icon="flag-outline" label={t("mobile.report.action_user", { name: person.name })} destructive onPress={() => setReport({ kind: "user", userId: person.userId, name: person.name })} />
      <Text className="px-5 pb-3 pt-1 text-footnote leading-[18px] text-muted-foreground">{blockedByMe ? t("chat.block_active_hint") : t("chat.block_dm_hint")}</Text>
      <ReportSheet wsId={wsId} target={report} blockUserId={blockedByMe ? undefined : person.userId} onClose={() => setReport(null)} onReported={(blocked) => blocked && leave()} />
    </View>
  );
}

/** A group member's menu: a DM, report them, block or unblock them. */
export function MemberSafetySheet({ wsId, person, onClose, onMessage }: { wsId: string; person: SafetyPerson | null; onClose: () => void; onMessage: (person: SafetyPerson) => void }) {
  const { t } = useTranslation();
  const status = useQuery(blockStatusOptions(wsId, person?.userId ?? "")).data;
  const toggle = useBlockToggle(wsId);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const blockedByMe = status?.blocked_by_me === true;
  const actions: SheetAction[] = person
    ? [
        ...(status?.blocked_me || blockedByMe ? [] : [{ key: "message", icon: "chatbubble-outline" as const, label: t("mobile.safety.message"), onPress: () => onMessage(person) }]),
        { key: "report", icon: "flag-outline", label: t("mobile.report.action_user", { name: person.name }), destructive: true, onPress: () => setReport({ kind: "user", userId: person.userId, name: person.name }) },
        { key: "block", icon: "ban-outline", label: blockedByMe ? t("chat.unblock_user") : t("chat.block_user"), destructive: !blockedByMe, onPress: () => toggle(person, blockedByMe) },
      ]
    : [];
  return (
    <>
      <ActionSheet visible={person !== null} onClose={onClose} title={person?.name} label={person ? t("mobile.safety.member_actions", { name: person.name }) : undefined} actions={actions} />
      <ReportSheet wsId={wsId} target={report} blockUserId={blockedByMe ? undefined : report?.kind === "user" ? report.userId : undefined} onClose={() => setReport(null)} />
    </>
  );
}

/** Above a DM's messages: which side blocked, so a refused send is not a mystery. */
export function DmBlockBanner({ wsId, peerUserId }: { wsId: string; peerUserId: string }) {
  const { t } = useTranslation();
  const status = useQuery(blockStatusOptions(wsId, peerUserId)).data;
  if (!status?.blocked_by_me && !status?.blocked_me) return null;
  return (
    <View accessibilityRole="alert" className="border-b border-border bg-secondary px-4 py-2">
      <Text className="text-footnote text-muted-foreground">{status.blocked_by_me ? t("chat.block_active_banner") : t("chat.blocked_me_banner")}</Text>
    </View>
  );
}

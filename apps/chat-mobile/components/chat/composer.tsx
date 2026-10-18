// The composer (spec §2.2): text with @mention autocomplete, a photo or a
// file, the quoted reply, editing one's own message, and the typing signal
// (600 ms after the draft stops changing, as packages/views/chat/use-native-typing.ts).
// M3: an empty draft's send button records a voice message, and the attach
// sheet opens the sticker/GIF picker and the reminder sheet.
// R4 (canvas MobileChat / MobStates): a round "+" outside the field opens the
// attach sheet, a pill field holds the input and the sticker button, a round
// brand button sends or records; the reply/edit banner is a card above it.
// Mentions are typed as "@Tên" and stored as tokens on send
// (lib/mentions.ts › serializeComposerDraftToMessageBody), as on the web.
import { Ionicons } from "@expo/vector-icons";
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Keyboard, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { CHAT_FILE_MAX_LABEL, CHAT_FILE_PICKER_TYPES, isChatAcceptedFile, isChatFileTooLarge } from "@/lib/file-accept";
import { formatVoiceCallDuration } from "@/lib/message-display";
import {
  deserializeMessageBodyToComposerDraft,
  filterMentionCandidates,
  formatComposerMentionDisplay,
  insertMentionToken,
  mentionCandidatesFromBody,
  resolveActiveMentionQuery,
  serializeComposerDraftToMessageBody,
  type ChatMentionCandidate,
} from "@/lib/mentions";
import type { PendingFile } from "@/lib/send-pipeline";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { useVoiceRecorder, VOICE_MAX_MS, type VoiceClip } from "./use-voice-recorder";

const TYPING_DEBOUNCE_MS = 600;

export interface ComposerReply {
  id: string;
  sender: string;
  text: string;
}

export interface ComposerEdit {
  id: string;
  body: string;
}

interface Props {
  candidates: ChatMentionCandidate[];
  canSend: boolean;
  allowAttachments: boolean;
  reply: ComposerReply | null;
  edit: ComposerEdit | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (body: string) => void;
  onSendFile: (file: PendingFile) => void;
  onEdit: (messageId: string, body: string) => void;
  onTyping: () => void;
  onSendVoice: (clip: VoiceClip) => void;
  onOpenExpressions: () => void;
  onOpenReminder: () => void;
}

export function Composer(props: Props) {
  const { candidates, canSend, allowAttachments, reply, edit } = props;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allLabel = t("chat.mention_all");
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const voice = useVoiceRecorder(props.onSendVoice);
  const startVoice = () =>
    void voice
      .start()
      .then((started) => {
        if (!started) Alert.alert(t("chat.voice_record_failed"));
      })
      .catch(() => Alert.alert(t("chat.voice_record_failed")));

  // Above the home indicator while the keyboard is down; the keyboard-avoiding view takes over when it is up.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const bottomInset = keyboardOpen ? 0 : insets.bottom;

  // Editing starts from the message's own text, with its mentions as "@Tên".
  useEffect(() => {
    if (!edit) return;
    const text = deserializeMessageBodyToComposerDraft(edit.body);
    setDraft(text);
    setCursor(text.length);
  }, [edit]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  const active = useMemo(() => resolveActiveMentionQuery(draft, cursor, candidates, allLabel), [draft, cursor, candidates, allLabel]);
  const suggestions = useMemo(
    () => (active && candidates.length > 0 ? filterMentionCandidates(candidates, active.query, { allLabel }).slice(0, 6) : []),
    [active, candidates, allLabel],
  );

  const onChange = (text: string) => {
    setDraft(text);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (!text.trim() || edit) return;
    typingTimer.current = setTimeout(props.onTyping, TYPING_DEBOUNCE_MS);
  };

  const pickMention = (candidate: ChatMentionCandidate) => {
    if (!active) return;
    const { nextDraft, nextCursor } = insertMentionToken(draft, active.start, cursor, formatComposerMentionDisplay(candidate, allLabel));
    setDraft(nextDraft);
    setCursor(nextCursor);
  };

  const trimmed = draft.trim();
  const tooLong = trimmed.length > CHAT_MESSAGE_BODY_MAX_LENGTH;
  const submit = () => {
    if (!trimmed || tooLong) return;
    if (edit) {
      // A mention keeps the id it was sent with, even when another person shares the name.
      props.onEdit(edit.id, serializeComposerDraftToMessageBody(trimmed, [...mentionCandidatesFromBody(edit.body), ...candidates], allLabel));
    } else {
      props.onSend(serializeComposerDraftToMessageBody(trimmed, candidates, allLabel));
    }
    setDraft("");
    setCursor(0);
  };

  const sendPicked = (file: PendingFile) => {
    const asset = { name: file.name, mimeType: file.mimeType, size: file.size };
    if (!isChatAcceptedFile(asset)) {
      Alert.alert(t("chat.file_type_unsupported"));
      return;
    }
    if (isChatFileTooLarge(asset)) {
      Alert.alert(t("chat.file_too_large", { max: CHAT_FILE_MAX_LABEL }));
      return;
    }
    props.onSendFile(file);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      // A HEIC original is not on the server's list; ask iOS for a JPEG.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const name = asset.fileName || `photo-${Date.now()}.jpg`;
    sendPicked({ uri: asset.uri, name, mimeType: asset.mimeType ?? "image/jpeg", size: asset.fileSize });
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: CHAT_FILE_PICKER_TYPES, copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    sendPicked({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size });
  };

  if (!canSend) {
    return (
      <View className="border-t border-border bg-background px-4 pt-3" style={{ paddingBottom: 12 + insets.bottom }}>
        <Text className="text-sm text-muted-foreground text-center">{t("chat.mute_composer_placeholder")}</Text>
      </View>
    );
  }

  const banner = edit
    ? {
        title: t("chat.edit_dialog_title"),
        text: deserializeMessageBodyToComposerDraft(edit.body),
        cancel: () => {
          setDraft("");
          props.onCancelEdit();
        },
      }
    : reply
      ? { title: reply.sender, text: t("chat.replying_to", { preview: reply.text }), cancel: props.onCancelReply }
      : null;
  // The "+" and the sticker button: off in a thread and while editing, as the attach sheet always was.
  const attach = allowAttachments && !edit;

  return (
    <View className="border-t border-border bg-background" style={{ paddingBottom: bottomInset }}>
      {suggestions.length > 0 ? (
        <View className="border-b border-border" accessibilityLabel={t("chat.mention_picker_label")}>
          {suggestions.map((candidate) => (
            <Pressable
              key={candidate.kind === "all" ? "all" : candidate.userId}
              accessibilityRole="button"
              onPress={() => pickMention(candidate)}
              className="min-h-11 justify-center px-4 active:bg-secondary"
            >
              <Text className="text-sm text-foreground">
                {candidate.kind === "all" ? `@${allLabel} · ${t("chat.mention_all_hint")}` : `@${candidate.label}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {banner ? (
        <View className="mx-3 mt-2 flex-row items-center gap-2.5 rounded-r-[10px] border-l-[3px] border-primary bg-muted pl-3">
          <Ionicons name={edit ? "create-outline" : "arrow-undo-outline"} size={18} color={theme.primary} />
          <View className="flex-1 py-1.5">
            <Text className="text-[13px] font-semibold text-primary" numberOfLines={1}>
              {banner.title}
            </Text>
            <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
              {banner.text}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("chat.cancel_reply")} onPress={banner.cancel} className="h-11 w-11 items-center justify-center">
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      <View className={cn("flex-row items-end gap-1.5 py-2 pr-2", attach ? "pl-2" : "pl-3")}>
        {attach && !voice.active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.composer_attach")}
            onPress={() => setAttachOpen(true)}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary"
          >
            <Ionicons name="add" size={28} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        {voice.active ? (
          <View className="h-11 flex-1 flex-row items-center gap-2.5 rounded-[22px] bg-tint-red px-3.5" accessible accessibilityLabel={t("chat.voice_recording_aria")}>
            <View className="h-2.5 w-2.5 rounded-full bg-destructive-solid" />
            <Text className="text-base font-semibold text-foreground">
              {formatVoiceCallDuration(voice.elapsedMs / 1000)}{" "}
              <Text className="font-normal text-muted-foreground">/ {formatVoiceCallDuration(VOICE_MAX_MS / 1000)}</Text>
            </Text>
          </View>
        ) : (
          <View className="min-h-11 flex-1 flex-row items-end rounded-[22px] border border-border bg-muted pl-3.5 pr-0.5">
            <TextInput
              value={draft}
              onChangeText={onChange}
              onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
              placeholder={t("chat.message_placeholder")}
              placeholderTextColor={theme.mutedForeground}
              accessibilityLabel={t("chat.message_placeholder")}
              multiline
              className="max-h-32 min-h-[42px] flex-1 py-2.5 text-base text-foreground"
            />
            {attach ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.expression_picker_open")}
                // 42 pt inside the field's border, 44 pt target.
                hitSlop={2}
                onPress={props.onOpenExpressions}
                className="h-[42px] w-[42px] items-center justify-center rounded-full active:bg-secondary"
              >
                <Ionicons name="happy-outline" size={23} color={theme.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        )}
        {voice.active ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} testID="composer-voice-cancel" onPress={() => void voice.cancel()} className="h-11 w-11 items-center justify-center rounded-full">
              <Ionicons name="trash-outline" size={22} color={theme.destructive} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("chat.send")} testID="composer-voice-send" onPress={() => void voice.send()} className="h-11 w-11 items-center justify-center rounded-full bg-primary">
              <Ionicons name="send" size={20} color={theme.primaryForeground} />
            </Pressable>
          </>
        ) : !trimmed && attach ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice_message")} testID="composer-voice" onPress={startVoice} className="h-11 w-11 items-center justify-center rounded-full bg-primary">
            <Ionicons name="mic-outline" size={22} color={theme.primaryForeground} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={edit ? t("chat.edit_dialog_save") : t("chat.send")}
            accessibilityState={{ disabled: !trimmed || tooLong }}
            disabled={!trimmed || tooLong}
            onPress={submit}
            className={cn("h-11 w-11 items-center justify-center rounded-full", !trimmed || tooLong ? "bg-muted" : "bg-primary")}
          >
            <Ionicons name={edit ? "checkmark" : "send"} size={edit ? 24 : 20} color={!trimmed || tooLong ? theme.mutedForeground : theme.primaryForeground} />
          </Pressable>
        )}
      </View>
      {tooLong ? (
        <Text className="px-4 pb-2 text-xs text-destructive">
          {/* The _other form directly: Hermes may lack Intl.PluralRules, which i18next needs to pick a suffix. */}
          {t("chat.composer_state.chars_over_other", { count: trimmed.length - CHAT_MESSAGE_BODY_MAX_LENGTH })}
        </Text>
      ) : null}
      <ActionSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        title={t("chat.composer_attach")}
        layout="tiles"
        actions={[
          { key: "photo", label: t("chat.media_image"), icon: "image-outline", tint: "blue", onPress: () => void pickPhoto() },
          { key: "file", label: t("chat.composer_attach_file"), icon: "attach", tint: "orange", onPress: () => void pickFile() },
          { key: "expressions", label: `${t("chat.expression_tab_sticker")} · ${t("chat.expression_tab_gif")}`, icon: "happy-outline", tint: "yellow", onPress: props.onOpenExpressions },
          { key: "reminder", label: t("chat.composer_create_reminder"), icon: "alarm-outline", tint: "teal", onPress: props.onOpenReminder },
        ]}
      />
    </View>
  );
}

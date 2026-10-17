// The composer (spec §2.2): text with @mention autocomplete, a photo or a
// file, the quoted reply, editing one's own message, and the typing signal
// (600 ms after the draft stops changing, as packages/views/chat/use-native-typing.ts).
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
        <View className="flex-row items-center gap-2 border-l-2 border-primary bg-secondary/60 mx-3 mt-2 px-3 py-1.5 rounded-r-md">
          <View className="flex-1">
            <Text className="text-xs font-semibold text-primary" numberOfLines={1}>
              {banner.title}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {banner.text}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("chat.cancel_reply")} hitSlop={8} onPress={banner.cancel} className="h-11 w-11 items-center justify-center">
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-end gap-1 px-2 py-2">
        {allowAttachments && !edit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.composer_attach")}
            onPress={() => setAttachOpen(true)}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary"
          >
            <Ionicons name="attach" size={24} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={onChange}
          onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
          placeholder={t("chat.message_placeholder")}
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel={t("chat.message_placeholder")}
          multiline
          className="flex-1 max-h-32 min-h-11 rounded-2xl bg-secondary px-4 py-2.5 text-base text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={edit ? t("chat.edit_dialog_save") : t("chat.send")}
          accessibilityState={{ disabled: !trimmed || tooLong }}
          disabled={!trimmed || tooLong}
          onPress={submit}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <Ionicons name={edit ? "checkmark-circle" : "send"} size={edit ? 30 : 24} color={!trimmed || tooLong ? theme.mutedForeground : theme.primary} />
        </Pressable>
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
        actions={[
          { key: "photo", label: t("chat.media_image"), onPress: () => void pickPhoto() },
          { key: "file", label: t("chat.composer_attach_file"), onPress: () => void pickFile() },
        ]}
      />
    </View>
  );
}

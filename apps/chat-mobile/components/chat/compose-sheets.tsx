// Creating a poll, a note or a post from the attach menu, the phone's
// versions of the web's create dialogs. Each sheet closes once the outbox
// has the message. The fields follow the web dialog: a labelled well, a
// counter, and the reason the submit stays quiet until the form is ready.
import { Ionicons } from "@expo/vector-icons";
import { canSubmitNote, NOTE_BODY_MAX_LENGTH } from "@uniwork/core/chat/note-utils";
import {
  canSubmitPoll,
  normalizePollOptions,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
} from "@uniwork/core/chat/poll-utils";
import { canSubmitPost, POST_BODY_MAX_LENGTH, POST_TITLE_MAX_LENGTH } from "@uniwork/core/chat/post-utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";
import { FORM_FIELD, FormSheetFooter, FormSheetHeader, FormSheetLabel } from "./form-sheet";

function inkOf(scheme: "light" | "dark"): string {
  return THEME[scheme].mutedForeground;
}

export function PollSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { question: string; options: string[] }) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const ink = inkOf(colorScheme);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const ready = canSubmitPoll(question, options);
  const create = () => {
    if (!ready) return;
    onCreate({ question: question.trim(), options: normalizePollOptions(options) });
    setQuestion("");
    setOptions(["", ""]);
    onClose();
  };
  const setOption = (index: number, value: string) => setOptions((current) => current.map((item, i) => (i === index ? value : item)));
  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <FormSheetHeader title={t("chat.poll_create_title")} description={t("chat.poll_create_description")} onClose={onClose} />
      <ScrollView className="max-h-96 px-4" keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <FormSheetLabel label={t("chat.poll_question_label")} count={question.length} max={POLL_QUESTION_MAX_LENGTH} />
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={t("chat.poll_topic_placeholder")}
          placeholderTextColor={ink}
          accessibilityLabel={t("chat.poll_question_label")}
          maxLength={POLL_QUESTION_MAX_LENGTH}
          multiline
          textAlignVertical="top"
          className={`${FORM_FIELD} mb-4 min-h-20 py-2.5`}
        />
        <FormSheetLabel label={t("chat.poll_options_label")} />
        <Text className="mb-2 text-caption text-muted-foreground">
          {options.length >= POLL_MAX_OPTIONS
            ? t("chat.poll_max_options_reached", { max: POLL_MAX_OPTIONS })
            : t("chat.poll_options_range_hint", { min: POLL_MIN_OPTIONS, max: POLL_MAX_OPTIONS })}
        </Text>
        {options.map((option, index) => {
          const label = t("chat.poll_option_placeholder", { index: index + 1 });
          return (
            <View key={label} className="mb-2 flex-row items-center gap-1">
              <TextInput
                value={option}
                onChangeText={(value) => setOption(index, value)}
                placeholder={label}
                placeholderTextColor={ink}
                accessibilityLabel={label}
                maxLength={POLL_OPTION_MAX_LENGTH}
                className={`${FORM_FIELD} min-w-0 flex-1 py-2.5`}
              />
              {options.length > POLL_MIN_OPTIONS ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.poll_remove_option", { index: index + 1 })}
                  onPress={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  className="h-11 w-11 items-center justify-center"
                >
                  <Ionicons name="close" size={18} color={ink} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {options.length < POLL_MAX_OPTIONS ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setOptions((current) => [...current, ""])}
            className="mb-2 min-h-11 flex-row items-center gap-1 self-start"
          >
            <Ionicons name="add" size={18} color={THEME[colorScheme].primary} />
            <Text className="text-body font-semibold text-primary">{t("chat.poll_add_option")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <FormSheetFooter hint={ready ? null : t("chat.poll_submit_hint")} label={t("chat.poll_create_submit")} disabled={!ready} onPress={create} />
    </BottomSheet>
  );
}

export function NoteSheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (body: string) => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [body, setBody] = useState("");
  const ready = canSubmitNote(body);
  const create = () => {
    if (!ready) return;
    onCreate(body.trim());
    setBody("");
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <FormSheetHeader title={t("chat.note_create_title")} description={t("chat.note_create_description")} onClose={onClose} />
      <View className="px-4">
        <FormSheetLabel label={t("chat.note_body_label")} count={body.length} max={NOTE_BODY_MAX_LENGTH} />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t("chat.note_body_placeholder")}
          placeholderTextColor={inkOf(colorScheme)}
          accessibilityLabel={t("chat.note_body_label")}
          maxLength={NOTE_BODY_MAX_LENGTH}
          multiline
          textAlignVertical="top"
          className={`${FORM_FIELD} min-h-36 py-2.5`}
        />
      </View>
      <FormSheetFooter hint={ready ? null : t("chat.note_submit_hint")} label={t("chat.note_create_submit")} disabled={!ready} onPress={create} />
    </BottomSheet>
  );
}

export function PostSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; body: string }) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const ink = inkOf(colorScheme);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ready = canSubmitPost(title, body);
  const hint = !title.trim()
    ? !body.trim()
      ? t("chat.post_submit_hint_both")
      : t("chat.post_submit_hint_title")
    : !body.trim()
      ? t("chat.post_submit_hint_body")
      : null;
  const create = () => {
    if (!ready) return;
    onCreate({ title: title.trim(), body: body.trim() });
    setTitle("");
    setBody("");
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <FormSheetHeader title={t("chat.post_create_title")} description={t("chat.post_create_description")} onClose={onClose} />
      <View className="px-4">
        <FormSheetLabel label={t("chat.post_title_label")} count={title.length} max={POST_TITLE_MAX_LENGTH} />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t("chat.post_title_placeholder")}
          placeholderTextColor={ink}
          accessibilityLabel={t("chat.post_title_label")}
          maxLength={POST_TITLE_MAX_LENGTH}
          className={`${FORM_FIELD} mb-4 py-2.5 font-semibold`}
        />
        <FormSheetLabel label={t("chat.post_body_label")} count={body.length} max={POST_BODY_MAX_LENGTH} />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t("chat.post_body_placeholder")}
          placeholderTextColor={ink}
          accessibilityLabel={t("chat.post_body_label")}
          maxLength={POST_BODY_MAX_LENGTH}
          multiline
          textAlignVertical="top"
          className={`${FORM_FIELD} min-h-28 py-2.5`}
        />
      </View>
      <FormSheetFooter hint={hint} label={t("chat.post_create_submit")} disabled={!ready} onPress={create} />
    </BottomSheet>
  );
}

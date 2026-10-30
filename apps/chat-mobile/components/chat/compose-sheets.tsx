// Creating a poll, a note or a post from the attach menu, the phone's
// versions of the web's create dialogs. Each sheet closes once the outbox
// has the message.
import { canSubmitNote } from "@uniwork/core/chat/note-utils";
import { canSubmitPoll, normalizePollOptions, POLL_MAX_OPTIONS } from "@uniwork/core/chat/poll-utils";
import { canSubmitPost } from "@uniwork/core/chat/post-utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

function Field({
  value,
  onChangeText,
  placeholder,
  label,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={THEME[colorScheme].mutedForeground}
      accessibilityLabel={label}
      multiline
      className="mb-3 min-h-12 rounded-control border border-border bg-muted px-3 py-2.5 text-body text-foreground"
    />
  );
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
  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-3 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.poll_create_title")}
      </Text>
      <Field value={question} onChangeText={setQuestion} placeholder={t("chat.poll_question_label")} label={t("chat.poll_question_label")} />
      {options.map((option, index) => (
        <Field
          key={index}
          value={option}
          onChangeText={(value) => setOptions((current) => current.map((item, i) => (i === index ? value : item)))}
          placeholder={t("chat.poll_option_placeholder", { index: index + 1 })}
          label={t("chat.poll_option_placeholder", { index: index + 1 })}
        />
      ))}
      {options.length < POLL_MAX_OPTIONS ? (
        <Pressable accessibilityRole="button" onPress={() => setOptions((current) => [...current, ""])} className="mb-3 min-h-11 justify-center">
          <Text className="text-callout font-semibold text-primary">{t("chat.poll_add_option")}</Text>
        </Pressable>
      ) : null}
      <Button disabled={!ready} onPress={create}>
        <Text>{t("chat.poll_create_submit")}</Text>
      </Button>
    </BottomSheet>
  );
}

export function NoteSheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (body: string) => void }) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const create = () => {
    if (!canSubmitNote(body)) return;
    onCreate(body.trim());
    setBody("");
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-3 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.note_create_title")}
      </Text>
      <Field value={body} onChangeText={setBody} placeholder={t("chat.note_body_placeholder")} label={t("chat.note_create_title")} />
      <Button disabled={!canSubmitNote(body)} onPress={create}>
        <Text>{t("chat.note_create_submit")}</Text>
      </Button>
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
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = () => {
    if (!canSubmitPost(title, body)) return;
    onCreate({ title: title.trim(), body: body.trim() });
    setTitle("");
    setBody("");
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-3 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.post_create_title")}
      </Text>
      <Field value={title} onChangeText={setTitle} placeholder={t("chat.post_title_placeholder")} label={t("chat.post_create_title")} />
      <Field value={body} onChangeText={setBody} placeholder={t("chat.post_body_placeholder")} label={t("chat.post_body_placeholder")} />
      <Button disabled={!canSubmitPost(title, body)} onPress={create}>
        <Text>{t("chat.post_create_submit")}</Text>
      </Button>
    </BottomSheet>
  );
}

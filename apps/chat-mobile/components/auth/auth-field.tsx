// The sign-in screens' text field (spec §5.2): a label above, the input on the muted surface the delete-account
// sheet uses, and under it either the field's error (with an icon, read out at once) or a hint. The visible label is
// for the eye; the input carries it for VoiceOver and TalkBack, with the error as its hint, so a reader that lands on
// the field hears what to fix. While a request runs (`busy`) the field stays editable, so it keeps its focus and the
// keyboard, and what is typed waits: a disabled native input drops the keyboard and cannot be focused again before
// React commits the answer, so a refused password could not be typed again at once. The password field adds
// show/hide, a full 44 pt target inside the field.
import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, TextInput, View, type TextInputProps } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { minTouchTarget } from "@/lib/platform-ui";
import { PASSWORD_MIN } from "@/lib/sign-in-form";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface AuthFieldProps extends Omit<TextInputProps, "style" | "className"> {
  label: string;
  error?: string | null;
  hint?: string | null;
  ref?: Ref<TextInput>;
  /** a control inside the field's end: the password's show/hide */
  trailing?: ReactNode;
  /** a request runs: the field keeps its focus and the keyboard, typing waits for the answer */
  busy?: boolean;
}

/** What a busy field does with typing: nothing (the input shows its value again). */
const waitForAnswer = () => undefined;

export function AuthField(props: AuthFieldProps) {
  const { label, error, hint, trailing, ref, editable = true, busy = false, onChangeText, onFocus, onBlur, ...input } = props;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [focused, setFocused] = useState(false);
  useAnnounce(error);
  return (
    <View className="gap-1.5">
      <Text className="text-subhead font-semibold text-foreground" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View
        className={cn(
          "min-h-12 flex-row items-center rounded-xl border bg-muted",
          error ? "border-destructive" : focused ? "border-primary" : "border-border",
          !editable && "opacity-60",
        )}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint ?? undefined}
          accessibilityState={{ busy, disabled: !editable }}
          editable={editable}
          onChangeText={busy ? waitForAnswer : onChangeText}
          placeholderTextColor={theme.mutedForeground}
          autoCorrect={false}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className="min-h-12 flex-1 px-3.5 py-3 text-body text-foreground"
          {...input}
        />
        {trailing}
      </View>
      <FieldNote error={error} hint={hint} />
    </View>
  );
}

/** Under a field: its error, with an icon and read out at once, or else its hint. */
export function FieldNote({ error, hint }: { error?: string | null; hint?: string | null }) {
  const { colorScheme } = useColorScheme();
  if (error) {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-row items-start gap-1.5">
        <Ionicons name="alert-circle-outline" size={16} color={THEME[colorScheme].destructive} style={{ marginTop: 2 }} />
        <Text className="flex-1 text-subhead text-destructive">{error}</Text>
      </View>
    );
  }
  return hint ? <Text className="text-footnote leading-[18px] text-muted-foreground">{hint}</Text> : null;
}

/** A password: hidden while typed, shown on request; `create` asks the system for a new one (and offers to save it). */
export function PasswordField({ create = false, ...field }: Omit<AuthFieldProps, "trailing" | "secureTextEntry"> & { create?: boolean }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [shown, setShown] = useState(false);
  // Drawn at the platform's minimum target inside the field, as the sign-in screen's audit measures drawn bounds.
  const target = minTouchTarget(Platform.OS);
  const tap = useTapTarget(target);
  return (
    <AuthField
      {...field}
      secureTextEntry={!shown}
      autoCapitalize="none"
      textContentType={create ? "newPassword" : "password"}
      autoComplete={create ? "new-password" : "current-password"}
      passwordRules={create ? `minlength: ${PASSWORD_MIN};` : undefined}
      trailing={
        <Pressable
          {...tap}
          accessibilityRole="button"
          accessibilityLabel={t(shown ? "common.hide_password" : "common.show_password")}
          onPress={() => setShown((value) => !value)}
          disabled={field.editable === false}
          testID={field.testID ? `${field.testID}-toggle` : undefined}
          style={{ width: target, height: target }}
          className="items-center justify-center rounded-full active:opacity-60"
        >
          <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={20} color={THEME[colorScheme].mutedForeground} />
        </Pressable>
      }
    />
  );
}

// The frame every sign-in screen shares (spec §5.2): the safe areas, a back button on the steps after the first, and
// one scrolling column that keeps the focused field above the keyboard (react-native-keyboard-controller, the app's
// keyboard layer) and stops at a readable width on a tablet. Its parts: the heading, the primary action with its
// labelled spinner, a text button, the line under a form that says what failed, and a notice card with its way out.
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { HeaderIconButton } from "@/components/chat/chat-header";
import { useAnnounce } from "@/components/ui/a11y";
import { Button } from "@/components/ui/button";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { backIcon } from "@/lib/platform-ui";
import { THEME } from "@/lib/theme";
import { DISPLAY_MAX_FONT_SCALE } from "@/lib/type-scale";
import { cn } from "@/lib/utils";

/** How far the focused field stays above the keyboard. */
const KEYBOARD_GAP = 24;

export function AuthLayout({ children, onBack, testID }: { children: ReactNode; onBack?: () => void; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-background" testID={testID}>
      <SafeAreaView edges={["top"]} className="bg-background">
        {onBack ? (
          <View className="min-h-12 flex-row items-center px-2">
            <HeaderIconButton icon={backIcon(Platform.OS)} label={t("common.back")} onPress={onBack} testID="auth-back" />
          </View>
        ) : null}
      </SafeAreaView>
      <KeyboardAwareScrollView bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View className={cn("w-full max-w-[440px] flex-1 gap-6 self-center px-6 pb-6", onBack ? "pt-2" : "pt-10")}>{children}</View>
      </KeyboardAwareScrollView>
      <SafeAreaView edges={["bottom"]} />
    </View>
  );
}

/**
 * A screen's title and its one line under it; the sign-in and register screens lead with the app's mark. The title
 * stops growing at DISPLAY_MAX_FONT_SCALE (one word per line at the largest sizes), the line under it keeps scaling.
 */
export function AuthHeading({ title, subtitle, mark = false }: { title: string; subtitle?: string | null; mark?: boolean }) {
  return (
    <View className={cn("gap-2", mark && "items-center")}>
      {mark ? (
        <View className="pb-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <UniChatLogo size={64} />
        </View>
      ) : null}
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
        testID="auth-title"
        className={cn("text-display font-display font-extrabold leading-[34px] tracking-tight text-foreground", mark && "text-center")}
      >
        {title}
      </Text>
      {subtitle ? <Text className={cn("text-body leading-6 text-muted-foreground", mark && "text-center")}>{subtitle}</Text> : null}
    </View>
  );
}

interface SubmitProps {
  label: string;
  /** what the spinner says while this action runs (the label when it never runs long) */
  busyLabel?: string;
  busy?: boolean;
  /** another action runs: dimmed, ignoring taps */
  disabled?: boolean;
  onPress: () => void;
  variant?: "default" | "outline";
  ref?: Ref<View>;
  testID?: string;
}

/** The screen's primary action: a full-width pill that turns into a labelled spinner while it runs. */
export function SubmitButton({ label, busyLabel = label, busy = false, disabled = false, onPress, variant = "default", ref, testID }: SubmitProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Button
      ref={ref}
      variant={variant}
      disabled={disabled}
      accessibilityState={{ busy, disabled }}
      onPress={() => {
        if (!busy) onPress();
      }}
      className="min-h-12 rounded-full py-3"
      testID={testID}
    >
      {busy ? <ActivityIndicator accessibilityLabel={busyLabel} color={variant === "default" ? theme.primaryForeground : theme.foreground} /> : null}
      <Text className="text-body font-semibold">{busy ? busyLabel : label}</Text>
    </Button>
  );
}

/** A secondary action written as words: "Quên mật khẩu?", "Tạo tài khoản". A full tap target around its text. */
export function TextButton({
  label,
  onPress,
  disabled = false,
  tone = "primary",
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "muted";
  testID?: string;
}) {
  const tap = useTapTarget(44);
  return (
    <Pressable
      {...tap}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      className={cn("min-h-11 justify-center px-1 active:opacity-60", disabled && "opacity-50")}
    >
      <Text className={cn("text-subhead font-semibold", tone === "primary" ? "text-primary" : "text-muted-foreground")}>{label}</Text>
    </Pressable>
  );
}

/** The one line that says what failed (or why a step waits), with an icon: an alert, heard as soon as it shows. */
export function FormAlert({ message, testID }: { message: string | null; testID?: string }) {
  const { colorScheme } = useColorScheme();
  useAnnounce(message);
  if (!message) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-row items-start gap-2" testID={testID}>
      <Ionicons name="alert-circle-outline" size={18} color={THEME[colorScheme].destructive} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-callout text-destructive">{message}</Text>
    </View>
  );
}

/** A notice above a form (link mode, a sign-in that ran out), with the one action that answers it. */
export function NoticeCard({ message, action, testID }: { message: string; action?: ReactNode; testID?: string }) {
  const { colorScheme } = useColorScheme();
  useAnnounce(message);
  return (
    <View accessibilityLiveRegion="polite" className="gap-1 rounded-2xl bg-muted px-4 pb-1.5 pt-3.5" testID={testID}>
      <View className="flex-row items-start gap-2.5">
        <Ionicons name="information-circle-outline" size={20} color={THEME[colorScheme].primary} />
        <Text className="flex-1 text-callout leading-5 text-foreground">{message}</Text>
      </View>
      {action ? <View className="flex-row justify-end">{action}</View> : <View className="h-2" />}
    </View>
  );
}

/** "hoặc dùng email" between the providers and the form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="h-px flex-1 bg-border" />
      <Text className="text-footnote text-muted-foreground">{label}</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

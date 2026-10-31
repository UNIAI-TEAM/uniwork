// The frame every sign-in screen shares (spec §5.2): the safe areas, a back button on the steps after the first, and
// one scrolling column that keeps the focused field above the keyboard (react-native-keyboard-controller, the app's
// keyboard layer) and stops at a readable width on a tablet (KeyboardColumn, which Settings' password screen shares
// under its own header). Its parts: the heading, the primary action with its labelled spinner, a text button, the
// line under a form that says what failed, and a notice card with its way out.
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
import { LiveRegion } from "@/components/ui/live-region";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { backIcon, minTouchTarget } from "@/lib/platform-ui";
import { THEME } from "@/lib/theme";
import { DISPLAY_MAX_FONT_SCALE } from "@/lib/type-scale";
import { cn } from "@/lib/utils";
import { useReaderFocus } from "./use-reader-focus";

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
      <KeyboardColumn className={onBack ? "pt-2" : "pt-10"}>{children}</KeyboardColumn>
      <SafeAreaView edges={["bottom"]} />
    </View>
  );
}

/** One scrolling column of a form: the focused field stays above the keyboard, and it stops at a readable width. */
export function KeyboardColumn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={KEYBOARD_GAP}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View className={cn("w-full max-w-[440px] flex-1 gap-6 self-center px-6 pb-6", className)}>{children}</View>
    </KeyboardAwareScrollView>
  );
}

/**
 * A screen's title and its one line under it; the sign-in and register screens lead with the app's mark. The title
 * stops growing at DISPLAY_MAX_FONT_SCALE (one word per line at the largest sizes), the line under it keeps scaling.
 * `announce`: the screen became another one in place (a refusal retitled it), so the reader's focus moves to the
 * heading and hears both lines, as the web's AuthShell announces its new title.
 */
export function AuthHeading({
  title,
  subtitle,
  mark = false,
  announce = false,
}: {
  title: string;
  subtitle?: string | null;
  mark?: boolean;
  announce?: boolean;
}) {
  const ref = useReaderFocus(announce);
  return (
    <View
      ref={ref}
      accessible={announce || undefined}
      accessibilityRole={announce ? "header" : undefined}
      accessibilityLabel={announce ? [title, subtitle].filter(Boolean).join(" ") : undefined}
      className={cn("gap-2", mark && "items-center")}
    >
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

/**
 * The screen's primary action: a full-width pill that turns into a spinner and its words while it runs. The button
 * carries the name a screen reader hears, once; the spinner beside the words is drawn for the eye only.
 */
export function SubmitButton({ label, busyLabel = label, busy = false, disabled = false, onPress, variant = "default", ref, testID }: SubmitProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Button
      ref={ref}
      variant={variant}
      disabled={disabled}
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ busy, disabled }}
      onPress={() => {
        if (!busy) onPress();
      }}
      className="min-h-12 rounded-full py-3"
      testID={testID}
    >
      {busy ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ActivityIndicator accessibilityLabel={busyLabel} color={variant === "default" ? theme.primaryForeground : theme.foreground} />
        </View>
      ) : null}
      <Text className="text-body font-semibold">{busy ? busyLabel : label}</Text>
    </Button>
  );
}

/**
 * A secondary action written as words: "Quên mật khẩu?", "Tạo tài khoản". Drawn at the platform's minimum target
 * around its text, not grown to it by hit slop: the sign-in screen's audit on the emulator measures what is drawn
 * (scripts/mobile-a11y-audit.mjs, 48 dp).
 */
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
  const target = minTouchTarget(Platform.OS);
  const tap = useTapTarget(target);
  return (
    <Pressable
      {...tap}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{ minHeight: target }}
      className={cn("justify-center px-1 active:opacity-60", disabled && "opacity-50")}
    >
      <Text className={cn("text-subhead font-semibold", tone === "primary" ? "text-primary" : "text-muted-foreground")}>{label}</Text>
    </Pressable>
  );
}

/**
 * The one line that says what failed (or why a step waits), with an icon: an alert, heard as soon as it shows. A line
 * that counts down gives `spoken` (use-sign-in.ts › useFailureMessage): only that is heard, once, so a screen reader
 * is not interrupted at every tick of the countdown on screen. TalkBack hears it from a hidden region that stays
 * mounted with the form (components/ui/live-region.tsx), so a failure after a retry is a change it reads; the line
 * drawn is no live region, so it is not read twice. A screen that moves the reader to the line instead passes
 * `announce={false}`: the focus says it, and an announcement beside it would be cut off or said twice.
 */
export function FormAlert({
  message,
  spoken = null,
  announce = true,
  ref,
  testID,
}: {
  message: string | null;
  spoken?: string | null;
  announce?: boolean;
  /** for a screen that moves the reader's focus to the line (use-reader-focus.ts) */
  ref?: Ref<View>;
  testID?: string;
}) {
  const { colorScheme } = useColorScheme();
  const said = announce ? (spoken ?? message) : null;
  useAnnounce(said);
  return (
    <>
      <LiveRegion line={said} testID={testID ? `${testID}-spoken` : undefined} />
      {message ? (
        <View ref={ref} accessibilityRole="alert" className="flex-row items-start gap-2" testID={testID}>
          <Ionicons name="alert-circle-outline" size={18} color={THEME[colorScheme].destructive} style={{ marginTop: 1 }} />
          <Text className="flex-1 text-callout text-destructive">{message}</Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * A notice above a form (link mode, a sign-in that ran out, an organization just joined), with the one action that
 * answers it. Said as it shows, as FormAlert's line is; a screen that moves the reader's focus to it passes `ref` and
 * `announce={false}`.
 */
export function NoticeCard({
  message,
  action,
  announce = true,
  ref,
  testID,
}: {
  message: string;
  action?: ReactNode;
  announce?: boolean;
  ref?: Ref<View>;
  testID?: string;
}) {
  const { colorScheme } = useColorScheme();
  useAnnounce(announce ? message : null);
  return (
    <View className="gap-1 rounded-2xl bg-muted px-4 pb-1.5 pt-3.5" testID={testID}>
      <LiveRegion line={announce ? message : null} />
      {/* One stop for a screen reader, named by the words alone (the icon's glyph is a character it would spell). */}
      <View
        ref={ref}
        accessible
        accessibilityLabel={message}
        className="flex-row items-start gap-2.5"
        testID={testID ? `${testID}-message` : undefined}
      >
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

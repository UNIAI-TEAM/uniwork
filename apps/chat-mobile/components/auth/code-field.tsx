// A six-digit code (spec §5.2: the second factor, the code mailed to another address, email verification): six boxes
// drawn over one real input, so the system's one-time-code suggestion, paste and the number pad all work and a
// screen reader meets a single field. The input is laid over the boxes, nearly transparent rather than hidden, which
// keeps iOS offering the code from Mail or Messages. A full code is handed on at once (`onComplete`); while the check
// runs (`busy`) the input stays editable and takes no typing, so it keeps its focus and the keyboard and a refused
// code can be typed again at once (a disabled native input drops the keyboard and cannot be focused before React
// commits the answer). A lock counting down (`disabled`) takes the field away until it lifts.
import { useState, type Ref } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { FieldNote } from "./auth-field";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { CODE_LENGTH, codeDigits } from "@/lib/sign-in-form";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The digits keep a readable size inside their box at every text size, and the box grows with them up to here. */
const DIGIT_MAX_FONT_SCALE = 1.6;

interface CodeFieldProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  /** the sixth digit arrived */
  onComplete: (code: string) => void;
  error?: string | null;
  /** an error that counts down, as it was first said: what a screen reader hears of it (useFailureMessage › spoken) */
  spokenError?: string | null;
  hint?: string | null;
  /** a check is running: the field stays focused, typing waits */
  busy?: boolean;
  /** no code is taken now (a lock counting down) */
  disabled?: boolean;
  autoFocus?: boolean;
  ref?: Ref<TextInput>;
  testID?: string;
}

export function CodeField(props: CodeFieldProps) {
  const { label, value, onChange, onComplete, error, spokenError = null, hint, busy = false, disabled = false, autoFocus, ref, testID } = props;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [focused, setFocused] = useState(false);
  const digits = [...value];

  const change = (raw: string) => {
    // The check answers first; the input shows the code it holds again.
    if (busy) return;
    const next = codeDigits(raw);
    onChange(next);
    if (next.length === CODE_LENGTH && next !== value) onComplete(next);
  };

  return (
    <View className="gap-1.5">
      <Text className="text-subhead font-semibold text-foreground" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View className={cn("relative", disabled && "opacity-50")}>
        <View className="flex-row gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: CODE_LENGTH }, (_, index) => {
            const active = focused && !busy && index === Math.min(digits.length, CODE_LENGTH - 1);
            return (
              <View
                key={index}
                className={cn(
                  "min-h-14 max-w-[52px] flex-1 items-center justify-center rounded-xl bg-muted",
                  error ? "border border-destructive" : active ? "border-2 border-primary" : "border border-border",
                )}
              >
                <Text maxFontSizeMultiplier={DIGIT_MAX_FONT_SCALE} className="text-title1 font-display font-bold text-foreground">
                  {digits[index] ?? ""}
                </Text>
              </View>
            );
          })}
        </View>
        <TextInput
          ref={ref}
          value={value}
          onChangeText={change}
          accessibilityLabel={label}
          accessibilityHint={spokenError ?? error ?? hint ?? undefined}
          accessibilityState={{ busy, disabled }}
          editable={!disabled}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          caretHidden
          selectionColor="transparent"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID={testID}
          // Over the boxes, nearly invisible: a fully transparent or zero-sized input loses the keyboard's code suggestion.
          style={[StyleSheet.absoluteFill, { opacity: 0.02, color: theme.foreground }]}
        />
      </View>
      <FieldNote error={error} spoken={spokenError} hint={hint} />
    </View>
  );
}

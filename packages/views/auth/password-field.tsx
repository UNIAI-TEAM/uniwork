"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

/**
 * Password input with a reveal toggle. Typing a password blind is where most
 * failed logins actually come from, and the alternative — retyping into a
 * confirm field — costs the user more than showing them what they typed.
 *
 * The toggle is `type="button"`: a bare <button> inside a <form> defaults to
 * submit, so revealing the password would post the form.
 */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
  invalid,
  describedBy,
  autoFocus,
  ref,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  /** Lets the form move focus here after a submit-time error. */
  ref?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        minLength={minLength}
        autoFocus={autoFocus}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // pr-11 keeps the text from running under the toggle; the toggle grows
        // to 44px on a coarse pointer and would otherwise sit on the caret.
        className="h-10 pr-11 text-body pointer-coarse:h-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-pressed={shown}
        aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
        onClick={() => setShown((v) => !v)}
        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
    </div>
  );
}

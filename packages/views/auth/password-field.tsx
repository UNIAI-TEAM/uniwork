"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_INPUT } from "./auth-controls";

/**
 * Password input with a reveal toggle. Typing a password blind is where most
 * failed logins actually come from, and the alternative — retyping into a
 * confirm field — costs the user more than showing them what they typed.
 *
 * The toggle is `type="button"`: a bare <button> inside a <form> defaults to
 * submit, so revealing the password would post the form.
 *
 * `size="form"` is a settings dialog's field: the Input primitive's own
 * ruler and a smaller toggle; the credential screens' 44px box by default.
 */
export function PasswordField({
  id,
  name,
  value,
  onChange,
  autoComplete,
  minLength,
  invalid,
  describedBy,
  autoFocus,
  ref,
  size = "auth",
}: {
  id: string;
  /** Password managers key their fill off `name`, not `id`. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  /** Lets the form move focus here after a submit-time error. */
  ref?: Ref<HTMLInputElement>;
  size?: "auth" | "form";
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        name={name}
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
        // The right padding keeps the text from running under the toggle; the toggle grows
        // to 44px on a coarse pointer (4–48px from the edge, at right-1) and would
        // otherwise sit on the caret, in a dialog's smaller field too.
        className={size === "auth" ? cn(AUTH_INPUT, "pr-11") : "pr-9 pointer-coarse:pr-12"}
      />
      <Button
        type="button"
        variant="ghost"
        size={size === "auth" ? "icon" : "icon-sm"}
        aria-pressed={shown}
        aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
        onClick={() => setShown((v) => !v)}
        // Centred with `inset-y-0 my-auto`, NOT `top-1/2 -translate-y-1/2`:
        // buttonVariants presses every button down with
        // `active:translate-y-px`, and both classes write the same
        // `--tw-translate-y`. With the transform version the press replaced
        // -50% with 1px, the button dropped 17px out from under the pointer,
        // `pointerup` landed on the input and `click` never fired — the eye
        // worked from the keyboard and in `fireEvent` tests and for nobody
        // holding a mouse. e2e/auth-layout.spec.ts presses it with a real one.
        className="absolute inset-y-0 right-1 my-auto text-muted-foreground"
      >
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
    </div>
  );
}

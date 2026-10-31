"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRegister } from "@uniwork/core/auth";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import {
  PASSWORD_MIN,
  displayNameError,
  emailError,
  passwordError,
  type FieldProblem,
} from "@uniwork/core/auth/sign-in-form";
import { paths } from "@uniwork/core/paths";
import type { SessionResponse } from "@uniwork/core/types";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { AppLink } from "../navigation";
import { AUTH_INPUT, AuthSubmit } from "./auth-controls";
import { AuthLegalNote } from "./auth-legal-note";
import { AuthShell } from "./auth-shell";
import { FailureSentence, useFailure, useWaitPhrase } from "./continue-parts";
import { AUTH_LINK } from "./login-view";
import { PasswordField } from "./password-field";
import { SocialSignIn, useFocusWhenFormIsTheOnlyWay } from "./social-sign-in";

type FieldName = "name" | "email" | "password";
const ORDER: readonly FieldName[] = ["name", "email", "password"];

export function RegisterView({
  onSuccess,
  next,
}: {
  onSuccess: (sess: SessionResponse) => void;
  /** Same-origin path to return to once the gates are behind the person; carried by every way out of this screen. */
  next?: string | null;
}) {
  const { t } = useTranslation();
  const reg = useRegister();
  const ids = { name: useId(), email: useId(), password: useId() };
  const hintIds: Partial<Record<FieldName, string>> = { name: useId(), password: useId() };
  const formErrorId = useId();
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };
  useFocusWhenFormIsTheOnlyWay(refs.name);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // What this screen judged before sending (core's rules, the phone's too).
  const [problems, setProblems] = useState<Partial<Record<FieldName, FieldProblem | null>>>({});

  // The server's answer reads through core's table, as on the phone. A field
  // verdict (an address that already has an account, one the server
  // refused) is the address's: the name and the password were judged here.
  // Anything else (offline, the server, a budget spent) is the form's, and a
  // 429 counts its wait down with the button held until it is over.
  const failure = useFailure(reg.error, "register");
  const wait = failure?.kind === "wait" ? failure : null;
  const phrase = useWaitPhrase(wait, reg.reset);
  const serverField = failure?.kind === "field" ? failure : null;
  const formFailure = failure && failure.kind !== "field" ? failure : null;

  const errorOf = (field: FieldName): ReactNode => {
    const problem = problems[field];
    if (problem) return t(problem.key, problem.values);
    return field === "email" && serverField ? <FailureSentence failure={serverField} /> : null;
  };
  const invalid = (field: FieldName) => errorOf(field) !== null;

  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    setProblems((current) => ({ ...current, [field]: null }));
    // A wait stays said until it is over; anything else clears on the next keystroke.
    if (reg.error && !wait) reg.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reg.isPending || wait) return;
    // Every field is judged at once and each says its own; focus goes to the
    // first one to fix, so the eye and the cursor start at the same place.
    const found = { name: displayNameError(displayName), email: emailError(email), password: passwordError(password, true) };
    setProblems(found);
    const first = ORDER.find((field) => found[field]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    reg.mutate(
      { email: email.trim(), password, displayName: displayName.trim() },
      {
        onSuccess,
        onError: (err) => {
          if (readSignInFailure(err, "register").kind === "field") refs.email.current?.focus();
        },
      },
    );
  };

  /** A field's line: its error when it has one, else the hint it was born with. */
  const line = (field: FieldName, hint?: string) => {
    const error = errorOf(field);
    if (error !== null) return <FieldError id={ids[field]}>{error}</FieldError>;
    if (!hint) return null;
    return (
      <FieldDescription id={hintIds[field]} className="text-caption">
        {hint}
      </FieldDescription>
    );
  };
  const describedBy = (field: FieldName) => (invalid(field) ? ids[field] : hintIds[field]);

  return (
    <AuthShell title={t("auth.register")} description={t("auth.registerSubtitle")}>
      <div className="flex flex-col gap-5">
        {/* intent=sign_up: a provider identity that matches no account
            becomes one at once. Opening this screen already said "new
            account", so the choice screen does not ask again (spec §3.2). */}
        <SocialSignIn next={next} intent="sign_up" />
        {/* noValidate: the browser's own bubble is untranslated and disappears
            on the next keystroke. The fields stay `required` so assistive
            tech still announces them as such. */}
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <Field className="gap-2" data-invalid={invalid("name") || undefined}>
              <FieldLabel htmlFor="register-name">{t("auth.displayName")}</FieldLabel>
              <Input
                ref={refs.name}
                id="register-name"
                value={displayName}
                onChange={(e) => edit("name", setDisplayName)(e.target.value)}
                autoComplete="name"
                enterKeyHint="next"
                required
                aria-invalid={invalid("name") || undefined}
                aria-describedby={describedBy("name")}
                className={AUTH_INPUT}
              />
              {line("name", t("auth.continue.create.displayNameHint"))}
            </Field>
            <Field className="gap-2" data-invalid={invalid("email") || undefined}>
              <FieldLabel htmlFor="register-email">{t("auth.email")}</FieldLabel>
              <Input
                ref={refs.email}
                id="register-email"
                type="email"
                value={email}
                onChange={(e) => edit("email", setEmail)(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                enterKeyHint="next"
                required
                aria-invalid={invalid("email") || undefined}
                aria-describedby={describedBy("email")}
                className={AUTH_INPUT}
              />
              {line("email")}
            </Field>
            <Field className="gap-2" data-invalid={invalid("password") || undefined}>
              <FieldLabel htmlFor="register-password">{t("auth.password")}</FieldLabel>
              <PasswordField
                ref={refs.password}
                id="register-password"
                value={password}
                onChange={edit("password", setPassword)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                invalid={invalid("password")}
                describedBy={describedBy("password")}
              />
              {line("password", t("auth.passwordMinHint", { min: PASSWORD_MIN }))}
            </Field>
            {formFailure ? (
              <FieldError id={formErrorId}>
                <FailureSentence failure={formFailure} phrase={phrase} />
              </FieldError>
            ) : null}
          </FieldGroup>

          <div className="flex flex-col gap-3">
            <AuthSubmit
              pending={reg.isPending}
              pendingLabel={t("auth.registering")}
              aria-disabled={wait ? true : undefined}
              aria-describedby={wait ? formErrorId : undefined}
            >
              {t("auth.register")}
            </AuthSubmit>
            <p className="text-center text-body text-muted-foreground">
              {t("auth.hasAccount")}{" "}
              <AppLink href={paths.login({ next })} className={AUTH_LINK}>
                {t("auth.login")}
              </AppLink>
            </p>
            <AuthLegalNote action="signUp" />
          </div>
        </form>
      </div>
    </AuthShell>
  );
}

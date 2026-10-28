"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore, useSetPassword } from "@uniwork/core/auth";
import { readSignInFailure, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { isAppleRelayEmail } from "@uniwork/core/auth/sign-in-rules";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { FailureNotice, useWaitPhrase } from "../../auth/continue-parts";
import { PasswordField } from "../../auth/password-field";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { ForgotPasswordLink } from "./forgot-password-link";
import { SettingsFieldError } from "./settings-layout";
import { useStepUpGate } from "./step-up-proof";

/** The server's floor (validatePassword); the copy says the same number. */
const MIN_PASSWORD = 8;

export type PasswordDialogMode = {
  kind: "set" | "change";
  /**
   * The current password proves the change: an account without a second
   * factor and no held token. Otherwise the field is not asked for and the
   * change rides a step-up (the factor, or the token already held).
   */
  askCurrent: boolean;
};

type PasswordInput = "current" | "next" | "confirm";

/**
 * Set the first password (an account that signs in with Google or Apple) or
 * change it (spec §4.5). Setting is confirmed through the proof dialog,
 * which opens over this one on Save; a change is proved by the current
 * password, or by the second factor when the account has one. Refusals are
 * said under the field they are about, focus goes back there, and a typed
 * password is never kept past a refusal of it.
 */
export function PasswordDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: PasswordDialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.signInMethods.password" });
  const { t: tRoot } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setPassword = useSetPassword();
  const gate = useStepUpGate();
  const ids = useId();
  const [values, setValues] = useState<Record<PasswordInput, string>>({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<PasswordInput, string>>>({});
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const phrase = useWaitPhrase(failure, () => setFailure(null));
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) };
  const [focus, setFocus] = useState<{ field: PasswordInput; turn: number } | null>(null);
  const pending = setPassword.isPending;
  const email = user?.email ?? "";
  const relay = isAppleRelayEmail(email);

  useEffect(() => {
    if (focus) refs[focus.field].current?.focus();
    // refs are stable; only a new turn moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Closing forgets every password typed.
  useEffect(() => {
    if (open) return;
    setValues({ current: "", next: "", confirm: "" });
    setErrors({});
    setFailure(null);
  }, [open]);

  const focusOn = (field: PasswordInput) => setFocus((f) => ({ field, turn: (f?.turn ?? 0) + 1 }));
  const change = (field: PasswordInput, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const refused = (err: unknown) => {
    const read = readSignInFailure(err, "password");
    if (read.code === "password_incorrect" && mode.askCurrent) {
      setValues((v) => ({ ...v, current: "" }));
      setErrors({ current: t("currentIncorrect") });
      return focusOn("current");
    }
    if (read.kind === "field" && read.code === "invalid_request") {
      setErrors({ next: t("tooShort") });
      return focusOn("next");
    }
    setFailure(read);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || gate.asking || failure?.kind === "wait") return;
    const found: Partial<Record<PasswordInput, string>> = {};
    if (mode.askCurrent && !values.current) found.current = t("currentRequired");
    if (values.next.length < MIN_PASSWORD) found.next = t("tooShort");
    else if (values.confirm !== values.next) found.confirm = t("mismatch");
    const first = (["current", "next", "confirm"] as const).find((f) => found[f]);
    setErrors(found);
    setFailure(null);
    if (first) return focusOn(first);
    void gate.run({
      action: mode.kind === "set" ? "set_password" : "change_password",
      // The current password is the proof: ask for another only if the server does.
      upfront: !mode.askCurrent,
      command: () =>
        setPassword.mutateAsync({ newPassword: values.next, currentPassword: mode.askCurrent ? values.current : undefined }),
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t(mode.kind === "set" ? "toastSet" : "toastChanged"));
      },
      onError: refused,
    });
  };

  // Every password here can be shown: a first one is typed twice, blind
  // otherwise, on a phone too. The current one offers the way out of having
  // forgotten it, in its label row, as the proof dialog's does.
  const field = (name: PasswordInput, label: string, autoComplete: "current-password" | "new-password", hint?: string) => {
    const hintId = `${ids}-${name}-hint`;
    const errorId = `${ids}-${name}-error`;
    return (
      <Field>
        {name === "current" ? (
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor={`${ids}-${name}`}>{label}</FieldLabel>
            <ForgotPasswordLink>{tRoot("auth.forgotPassword")}</ForgotPasswordLink>
          </div>
        ) : (
          <FieldLabel htmlFor={`${ids}-${name}`}>{label}</FieldLabel>
        )}
        <PasswordField
          ref={refs[name]}
          id={`${ids}-${name}`}
          size="form"
          autoComplete={autoComplete}
          value={values[name]}
          onChange={(value) => change(name, value)}
          invalid={Boolean(errors[name])}
          describedBy={hint ? `${hintId} ${errorId}` : errorId}
        />
        {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
        <SettingsFieldError id={errorId}>{errors[name] ?? null}</SettingsFieldError>
      </Field>
    );
  };

  const description =
    mode.kind === "change" ? t("signsOutOthers") : relay ? t("setDescriptionRelay") : t("setDescription", { email });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      {/* Opens on the first field, not on "Quên mật khẩu?" ahead of it in the label row. */}
      <FormDialogContent
        showCloseButton={!pending}
        initialFocus={() => (mode.askCurrent ? refs.current.current : refs.next.current) ?? true}
      >
        <form noValidate onSubmit={submit}>
          <FormDialogHeader title={t(mode.kind === "set" ? "setTitle" : "changeTitle")} description={description} />
          <FormDialogBody>
            {mode.kind === "set" && relay ? <RelayAddress address={email} /> : null}
            {mode.askCurrent ? field("current", t("current"), "current-password") : null}
            {field("next", t("new"), "new-password", t("hint", { min: MIN_PASSWORD }))}
            {field("confirm", t("confirm"), "new-password")}
            {failure ? <FailureNotice failure={failure} phrase={phrase} /> : null}
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            submitType="submit"
            submitLabel={t("save")}
            submittingLabel={t("saving")}
            submitting={pending}
            submitDisabled={failure?.kind === "wait"}
          />
        </form>
        {gate.dialog}
      </FormDialogContent>
    </Dialog>
  );
}

/**
 * Apple's hidden address, which the person never typed and cannot guess:
 * shown once, with a copy button, so they can sign in with it later. The
 * confirmation is a status line, not a toast: a dialog would cover it.
 */
function RelayAddress({ address }: { address: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.signInMethods.password" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
      <code className="min-w-0 flex-1 text-caption break-all">{address}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          if (!(await copyText(address))) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
        {t("copyEmail")}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("emailCopied") : ""}
      </span>
    </div>
  );
}

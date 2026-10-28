"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StepUpAction, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import type { StepUpProofInput } from "@uniwork/core/api/endpoints/sign-in-methods-api";
import { hasStepUp, useAuthStore, useSendStepUpEmailCode, useSignInMethods, useStepUp } from "@uniwork/core/auth";
import { readSignInFailure, sentenceValues, type RetryPhrase, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { isAppleRelayEmail } from "@uniwork/core/auth/sign-in-rules";
import { proofChoice, stepUpWindowHintKey, WEB_PROOFS } from "@uniwork/core/auth/step-up";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_LINK } from "../../auth/auth-controls";
import { useSecondsLeft, useWaitPhrase } from "../../auth/continue-parts";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { AppLink } from "../../navigation";
import { SettingsFieldError } from "./settings-layout";

/**
 * "Xác nhận là bạn" (ADR 0047 §5, spec §4.5): the one dialog every sensitive
 * command asks through — sign-in methods, turning on two-factor, deleting the
 * account, handing an organization over. A command does not open it itself:
 * it asks useStepUpGate(), which runs the command at once while a held token
 * serves it and opens the dialog only when none does or the server refused
 * the one it had.
 */

/** A mailed code may be asked for again a minute after the last one (the server's gate). */
const RESEND_MS = 60_000;
const EMAIL_CODE = /^\d{6}$/;

type Ask = {
  id: number;
  action: StepUpAction;
  /** The proofs a proof_required named; null: ask the account's sign-in methods. */
  proofs: readonly StepUpProof[] | null;
  resolve: (confirmed: boolean) => void;
};

/** One command behind a proof (useStepUpGate().run). */
type StepUpRun<T> = {
  action: StepUpAction;
  command: () => Promise<T>;
  onSuccess?: (value: T) => void;
  /** Any failure but a refused proof; a refused proof reopens the dialog and the command runs once more. */
  onError?: (err: unknown) => void;
  /** The person closed the dialog instead of confirming: nothing ran. */
  onCancel?: () => void;
  /**
   * Ask before the first try unless a held token serves `action` (the
   * default). False for a command that carries its own proof (a password
   * change typed with the current password): the dialog opens only when the
   * server asks for one.
   */
  upfront?: boolean;
};

interface StepUpGate {
  /**
   * Resolves true once a token serving `action` is held — at once when one
   * is, after the dialog otherwise — and false when the person cancelled.
   * `proofs` (a proof_required's) always opens the dialog, on those proofs.
   */
  ensure: (action: StepUpAction, proofs?: readonly StepUpProof[] | null) => Promise<boolean>;
  /** The command, proved first when it needs to be, retried once after a refused proof. */
  run: <T>(opts: StepUpRun<T>) => Promise<void>;
  /**
   * The dialog. Render it once, inside the dialog the command is asked from
   * when there is one: Base UI then nests it, so pressing in it never reads
   * as a press outside the dialog under it.
   */
  dialog: ReactNode;
  /** The dialog is open: the caller's own controls hold still. */
  asking: boolean;
}

export function useStepUpGate(): StepUpGate {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState(false);
  const current = useRef<Ask | null>(null);
  const ids = useRef(0);

  const ensure = useCallback((action: StepUpAction, proofs: readonly StepUpProof[] | null = null) => {
    if (proofs === null && hasStepUp(action)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      current.current?.resolve(false);
      ids.current += 1;
      const next: Ask = { id: ids.current, action, proofs, resolve };
      current.current = next;
      setAsk(next);
      setOpen(true);
    });
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    current.current?.resolve(confirmed);
    current.current = null;
    // The asked-for form stays mounted while the dialog animates out.
    setOpen(false);
  }, []);

  const run = useCallback(
    async <T,>(opts: StepUpRun<T>) => {
      if (opts.upfront !== false && !(await ensure(opts.action))) return opts.onCancel?.();
      for (let attempt = 0; ; attempt += 1) {
        let value: T;
        try {
          value = await opts.command();
        } catch (err) {
          const failure = readSignInFailure(err, "methods");
          // The token died with its session, or a mailed code bought it for
          // another action: one more proof, on the proofs the server named.
          if (failure.kind !== "step_up" || attempt > 0) return opts.onError?.(err);
          if (!(await ensure(opts.action, failure.proofs ?? []))) return opts.onCancel?.();
          continue;
        }
        return opts.onSuccess?.(value);
      }
    },
    [ensure],
  );

  const dialog = <StepUpDialog ask={ask} open={open} onDone={finish} />;
  return { ensure, run, dialog, asking: open };
}

function StepUpDialog({ ask, open, onDone }: { ask: Ask | null; open: boolean; onDone: (confirmed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  // The proof's own control (its field, or "Gửi mã tới…"): the dialog opens
  // on it, not on the first tabbable, which is the "Quên mật khẩu?" link in
  // the password field's label row.
  const firstControl = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onDone(false);
      }}
    >
      <FormDialogContent showCloseButton={!busy} initialFocus={() => firstControl.current ?? true}>
        {ask ? (
          <StepUpForm
            key={ask.id}
            action={ask.action}
            proofs={ask.proofs}
            firstControl={firstControl}
            onBusyChange={setBusy}
            onConfirmed={() => onDone(true)}
            onCancel={() => onDone(false)}
          />
        ) : null}
      </FormDialogContent>
    </Dialog>
  );
}

/** What stands under the field: a check of ours (empty, the wrong length) or the server's refusal. */
type Problem = { key: string } | { failure: SignInFailure };

function StepUpForm({
  action,
  proofs: named,
  firstControl,
  onBusyChange,
  onConfirmed,
  onCancel,
}: {
  action: StepUpAction;
  proofs: readonly StepUpProof[] | null;
  firstControl: MutableRefObject<HTMLElement | null>;
  onBusyChange: (busy: boolean) => void;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.stepUp" });
  const { t: tRoot } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const methods = useSignInMethods({ enabled: named === null });
  const stepUp = useStepUp();
  const send = useSendStepUpEmailCode();
  const ids = useId();
  const inputId = `${ids}-input`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const sendErrorId = `${ids}-send-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);

  // The proofs to offer: those a refusal inside this dialog named, else the
  // ones the command's refusal named, else the account's list (null while
  // it loads; a list that failed leaves the account's own state to decide).
  const [renamed, setRenamed] = useState<readonly StepUpProof[] | null>(null);
  const listed = renamed ?? named ?? (methods.isPending ? null : (methods.data?.proofs ?? []));
  const choice = proofChoice({
    proofs: listed ?? [],
    mfaEnabled: Boolean(user?.mfa_enabled_at),
    hasPassword: Boolean(user?.has_password),
    supported: WEB_PROOFS,
  });
  const ways = choice.first ? [choice.first, ...choice.others] : [];
  const [picked, setPicked] = useState<StepUpProof | null>(null);
  const proof = picked && ways.includes(picked) ? picked : (ways[0] ?? null);
  const loading = listed === null;

  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [resent, setResent] = useState(false);
  const [sendFailure, setSendFailure] = useState<SignInFailure | null>(null);
  // Bumped whenever focus belongs in the field again: a refusal, a switch, a code just sent.
  const [focusTurn, setFocusTurn] = useState(0);

  const failure = problem && "failure" in problem ? problem.failure : null;
  const phrase = useWaitPhrase(failure, () => setProblem(null));
  const sendPhrase = useWaitPhrase(sendFailure, () => setSendFailure(null));
  const resendLeft = useSecondsLeft(sentAt === null ? null : sentAt + RESEND_MS);
  const waiting = failure?.kind === "wait";
  const busy = stepUp.isPending || send.isPending;

  useEffect(() => {
    onBusyChange(stepUp.isPending);
  }, [onBusyChange, stepUp.isPending]);
  useEffect(() => {
    firstControl.current = inputRef.current ?? sendRef.current;
  });
  useEffect(() => {
    if (focusTurn === 0) return;
    const field = inputRef.current;
    if (field) {
      field.focus();
      field.select();
    } else sendRef.current?.focus();
  }, [focusTurn]);
  // Proofs still loading when the dialog opened left its initial focus on
  // nothing of theirs: move to the proof once it is known, once.
  const arrived = useRef(!loading);
  useEffect(() => {
    if (loading || arrived.current) return;
    arrived.current = true;
    setFocusTurn((n) => n + 1);
  }, [loading]);

  const relay = isAppleRelayEmail(user?.email) || Boolean(methods.data?.account_email_is_relay);
  const email = user?.email ?? "";
  const phraseText = (p: RetryPhrase) => tRoot(p.key, p.count === undefined ? {} : { count: p.count });
  // A wait is announced once, with the time it started at; the number that
  // ticks beside it is hidden from the live region, or every second of it
  // would be read out.
  const say = (f: SignInFailure, live: RetryPhrase | null): ReactNode => {
    const sentence = tRoot(f.key, sentenceValues(f, tRoot));
    if (f.kind !== "wait" || !f.retry) return sentence;
    return (
      <>
        {sentence} <span className="sr-only">{phraseText(f.retry)}</span>
        <span aria-hidden>{phraseText(live ?? f.retry)}</span>
      </>
    );
  };
  const message = problem === null ? null : "key" in problem ? t(problem.key) : say(problem.failure, phrase);

  const refuse = (next: Problem) => {
    setProblem(next);
    setFocusTurn((n) => n + 1);
  };

  // A lockout holds every proof (the server weighs them all), so it stays said across a switch.
  const switchTo = (next: StepUpProof) => {
    setPicked(next);
    setValue("");
    if (!waiting) setProblem(null);
    setFocusTurn((n) => n + 1);
  };

  const sendCode = () => {
    if (send.isPending || resendLeft > 0 || sendFailure?.kind === "wait") return;
    setSendFailure(null);
    const again = sentAt !== null;
    send.mutate(action, {
      // A send whose answer says nothing still moves on: the person can ask again.
      onSuccess: () => {
        setSentAt(Date.now());
        setResent(again);
        setValue("");
        setProblem(null);
        setFocusTurn((n) => n + 1);
      },
      onError: (err) => setSendFailure(readSignInFailure(err, "step_up")),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || waiting || loading || !proof) return;
    const typed = proof === "password" ? value : value.replace(/\s+/g, "");
    let input: StepUpProofInput;
    if (proof === "password") {
      if (!typed) return refuse({ key: "password.required" });
      input = { kind: "password", password: typed };
    } else if (proof === "totp") {
      if (!typed) return refuse({ key: "totp.required" });
      input = { kind: "totp", code: typed };
    } else {
      if (sentAt === null) return;
      if (!EMAIL_CODE.test(typed)) return refuse({ key: "emailCode.required" });
      input = { kind: "email_code", code: typed };
    }
    setProblem(null);
    stepUp.mutate(
      { proof: input, action },
      {
        onSuccess: () => onConfirmed(),
        onError: (err) => {
          const read = readSignInFailure(err, "step_up");
          // The account takes other proofs now (two-factor turned on or off
          // elsewhere): offer those, in their order.
          if (read.kind === "step_up" && read.proofs && read.proofs.length > 0) {
            setRenamed(read.proofs);
            setPicked(null);
          }
          // A refused password is never kept; a code stays, selected, to be corrected.
          if (proof === "password" || read.kind === "step_up") setValue("");
          refuse({ failure: read });
        },
      },
    );
  };

  const fieldProps = {
    ref: inputRef,
    id: inputId,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      if (!waiting) setProblem(null);
    },
    "aria-invalid": problem ? true : undefined,
  };
  const error = (
    <SettingsFieldError id={errorId}>{message}</SettingsFieldError>
  );
  const awaitingCode = proof === "email_code" && sentAt === null;

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex flex-col gap-2">
        <span className="sr-only" role="status">
          {tRoot("common.loading")}
        </span>
        <Skeleton aria-hidden className="h-4 w-32" />
        <Skeleton aria-hidden className="h-8 w-full pointer-coarse:h-11" />
      </div>
    );
  } else if (proof === "password") {
    body = (
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor={inputId}>{t("password.label")}</FieldLabel>
          <AppLink href={paths.forgotPassword()} className={cn(AUTH_LINK, "text-caption")}>
            {t("password.forgot")}
          </AppLink>
        </div>
        <Input {...fieldProps} type="password" autoComplete="current-password" aria-describedby={errorId} />
        {error}
      </Field>
    );
  } else if (proof === "totp") {
    body = (
      <Field>
        <FieldLabel htmlFor={inputId}>{t("totp.label")}</FieldLabel>
        {/* Recovery codes are letters and digits, so the keyboard stays a text one. */}
        <Input
          {...fieldProps}
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={`${hintId} ${errorId}`}
        />
        <FieldDescription id={hintId}>{t("totp.hint")}</FieldDescription>
        {error}
      </Field>
    );
  } else if (proof === "email_code") {
    const sendError = (
      <SettingsFieldError id={sendErrorId}>{sendFailure ? say(sendFailure, sendPhrase) : null}</SettingsFieldError>
    );
    body = awaitingCode ? (
      <div className="flex flex-col gap-2">
        {/* The dialog's one action until a code is on its way, hence the
            primary fill; the footer holds Cancel alone meanwhile. */}
        <Button
          ref={sendRef}
          type="button"
          className="h-auto min-h-9 w-full justify-start py-2 text-left whitespace-normal"
          aria-busy={send.isPending || undefined}
          aria-disabled={send.isPending || sendFailure?.kind === "wait" || undefined}
          aria-describedby={sendErrorId}
          onClick={sendCode}
        >
          {send.isPending ? <Spinner /> : <Mail aria-hidden />}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {send.isPending ? t("emailCode.sending") : relay ? t("emailCode.sendRelay") : t("emailCode.send", { email })}
          </span>
        </Button>
        {relay ? <p className="text-caption text-pretty text-muted-foreground">{t("emailCode.relayHint")}</p> : null}
        {sendError}
        {error}
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-body text-pretty [overflow-wrap:anywhere]">
          {relay
            ? t(resent ? "emailCode.resentRelay" : "emailCode.sentRelay")
            : t(resent ? "emailCode.resent" : "emailCode.sent", { email })}
        </p>
        <Field>
          <FieldLabel htmlFor={inputId}>{t("emailCode.label")}</FieldLabel>
          <Input
            {...fieldProps}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="font-mono tracking-widest sm:w-40"
            aria-describedby={errorId}
          />
          {error}
        </Field>
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            aria-disabled={resendLeft > 0 || send.isPending || sendFailure?.kind === "wait" || undefined}
            aria-busy={send.isPending || undefined}
            onClick={sendCode}
          >
            {resendLeft > 0 ? t("emailCode.resendIn", { count: resendLeft }) : t("emailCode.resend")}
          </Button>
          {relay ? <p className="text-caption text-pretty text-muted-foreground">{t("emailCode.relayHint")}</p> : null}
          {sendError}
        </div>
      </div>
    );
  } else {
    // No proof this browser can give (a drifted list): say so, nothing to press.
    body = (
      <p role="alert" className="text-body text-pretty">
        {t("errors.generic")}
      </p>
    );
  }

  const next = proof ? ways[(ways.indexOf(proof) + 1) % ways.length] : undefined;
  return (
    <form noValidate onSubmit={submit}>
      <FormDialogHeader title={t("title")} description={t("description", { action: t(`actions.${action}`) })} />
      <FormDialogBody>
        {body}
        {proof && !loading ? (
          <p className="text-caption text-pretty text-muted-foreground">{tRoot(stepUpWindowHintKey(proof))}</p>
        ) : null}
      </FormDialogBody>
      <FormDialogFooter
        onCancel={onCancel}
        submitType="submit"
        submitLabel={proof && !awaitingCode ? t("submit") : undefined}
        submittingLabel={t("submitting")}
        submitting={stepUp.isPending}
        submitDisabled={waiting || loading}
        reasonId={waiting ? errorId : undefined}
        leading={
          next && next !== proof ? (
            // Full width while the footer stacks on a phone, like the two
            // actions above it; at its own width beside them from sm up.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) switchTo(next);
              }}
            >
              {t("useAnother")}
            </Button>
          ) : null
        }
      />
    </form>
  );
}

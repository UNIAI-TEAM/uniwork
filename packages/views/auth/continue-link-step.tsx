"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SignInTicket } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useDiscardSignInTicket, useLinkSignInTicket } from "@uniwork/core/auth";
import { readSignInFailure, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { linkAction } from "@uniwork/core/auth/step-up";
import { paths } from "@uniwork/core/paths";
import type { User } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AppLink } from "../navigation";
import { useStepUpGate } from "../settings/components/step-up-proof";
import { AUTH_PILL } from "./auth-controls";
import { AuthShell } from "./auth-shell";
import { FailureNotice, IdentityBlock, PILL_LINK, identityAddress, useProviderName, useWaitPhrase } from "./continue-parts";

/**
 * Failures after which pressing "Liên kết" again cannot help: the identity
 * belongs to an account with content, the account already has another one
 * of this provider, or its own address is not verified yet.
 */
const FINAL = new Set(["sign_in_method_taken", "sign_in_method_already_linked", "email_unverified"]);

type Phase = "ask" | "move" | "done";

/**
 * /auth/continue?step=link, signed in (spec §4.3): the account that just
 * signed in is asked, once, whether the waiting provider joins it. Opening
 * the page writes nothing; only "Liên kết" does. Success says so as a status
 * and focuses "Tiếp tục" instead of moving on by itself, so the person reads
 * it. Every failure still offers "Tiếp tục". A session older than the
 * pending sign-in confirms it is the person ("Xác nhận là bạn", the shared
 * proof dialog), and the link is sent again.
 */
export function ContinueLinkStep({
  ticket,
  user,
  next,
  onDone,
}: {
  ticket: SignInTicket;
  user: User;
  next: string | null;
  onDone: (user: User) => void;
}) {
  const { t } = useTranslation();
  const link = useLinkSignInTicket();
  const discard = useDiscardSignInTicket();
  const gate = useStepUpGate();
  const [phase, setPhase] = useState<Phase>("ask");
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [masked, setMasked] = useState<string | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const provider = useProviderName(ticket.provider);
  const shown = identityAddress(ticket);
  const phrase = useWaitPhrase(failure, () => setFailure(null));
  const busy = link.isPending || discard.isPending;
  // A sign-in in link mode keeps this step's own `next` for it; the way back
  // here after one more sign-in carries it again.
  const signInToLink = paths.login({ link: true, next: paths.authContinue({ step: "link", next }) });

  // What replaces the buttons the person just pressed takes focus: the move
  // question, heard before anything is moved; or "Tiếp tục" once linked, the
  // one thing left to do (the status line says what happened).
  useEffect(() => {
    if (phase === "move") moveRef.current?.focus();
    if (phase === "done") continueRef.current?.focus();
  }, [phase]);

  // A session that began before the pending sign-in is no proof by itself
  // (403 proof_required): the proof dialog asks, then the link goes again.
  // Closing the dialog leaves the question as it was.
  const send = (move: boolean) => {
    if (busy || gate.asking || failure?.kind === "wait") return;
    setFailure(null);
    void gate.run({
      action: linkAction(ticket.provider),
      upfront: false,
      command: () => link.mutateAsync({ provider: ticket.provider, move }),
      onSuccess: () => setPhase("done"),
      onError: (err) => {
        const read = readSignInFailure(err, "ticket");
        if (read.kind === "move" && !move) {
          setMasked(read.maskedEmail);
          setPhase("move");
          return;
        }
        setPhase("ask");
        setFailure(read);
      },
    });
  };

  // "Không liên kết", or "Tiếp tục" past a failure: the pending sign-in goes
  // (a later sign-in would drop it anyway) and the person goes on.
  const leave = () => {
    if (busy) return;
    discard.mutate(undefined, { onSettled: () => onDone(user) });
  };

  const accountEmail = user.email || user.display_name;
  const question =
    shown.kind === "address"
      ? t("auth.continue.link.question", { provider, providerEmail: shown.email, accountEmail })
      : t("auth.continue.link.questionRelay", { provider, accountEmail });

  const finalFailure = failure !== null && (failure.kind === "restart" || FINAL.has(failure.code));
  // An ended session signs in again; a refused proof is asked again by pressing "Liên kết".
  const relinkByLogin = failure?.kind === "session";

  return (
    <AuthShell
      title={t("auth.continue.link.title", { provider })}
      // A live region from the start, so the question turning into "linked"
      // is announced; the question itself is read with the page.
      description={<span role="status">{phase === "done" ? t("auth.continue.link.done", { provider }) : question}</span>}
    >
      <div className="flex flex-col gap-6">
        <IdentityBlock identity={ticket} linked={phase === "done"} />
        {phase === "ask" && !failure ? (
          <p className="text-pretty text-body text-muted-foreground">{t("auth.continue.link.body", { provider })}</p>
        ) : null}
        {phase === "move" ? (
          <div
            ref={moveRef}
            tabIndex={-1}
            role="group"
            aria-labelledby="continue-move-title"
            className="flex flex-col gap-2 rounded-xl border border-border p-4"
          >
            <h2 id="continue-move-title" className="text-title-sm font-semibold text-foreground">
              {t("auth.continue.link.movableTitle", { provider })}
            </h2>
            <p className="text-pretty text-body text-foreground">
              {masked
                ? t("auth.continue.link.movable", { provider, masked })
                : t("auth.continue.link.movableUnknown", { provider })}
            </p>
            <p className="text-pretty text-caption text-muted-foreground">{t("auth.continue.link.movableNote")}</p>
          </div>
        ) : null}
        {failure ? (
          <FailureNotice failure={linkFailureText(failure)} phrase={phrase} provider={ticket.provider} />
        ) : null}
        <div className="flex flex-col gap-3">
          {phase === "done" ? (
            <Button ref={continueRef} type="button" size="lg" className={AUTH_PILL} onClick={() => onDone(user)}>
              {t("auth.continue.link.continue")}
            </Button>
          ) : (
            <>
              {relinkByLogin ? (
                <AppLink href={signInToLink} className={PILL_LINK}>
                  {t("auth.continue.linkRequired.action")}
                </AppLink>
              ) : finalFailure ? null : (
                <Button
                  type="button"
                  size="lg"
                  className={AUTH_PILL}
                  aria-busy={link.isPending || undefined}
                  aria-disabled={(busy && !link.isPending) || failure?.kind === "wait" || undefined}
                  onClick={() => send(phase === "move")}
                >
                  {link.isPending ? <Spinner /> : null}
                  {phase === "move"
                    ? t(link.isPending ? "auth.continue.link.moving" : "auth.continue.link.move")
                    : t(link.isPending ? "auth.continue.link.linking" : "auth.continue.link.confirm")}
                </Button>
              )}
              <Button
                type="button"
                variant={finalFailure ? "default" : "outline"}
                size="lg"
                className={AUTH_PILL}
                aria-busy={discard.isPending || undefined}
                aria-disabled={(busy && !discard.isPending) || undefined}
                onClick={leave}
              >
                {discard.isPending ? <Spinner /> : null}
                {/* The move's pair is Settings' own ("Chuyển sang đây" / "Không chuyển"):
                    the same decision reads the same on both surfaces. */}
                {failure
                  ? t("auth.continue.link.continue")
                  : t(phase === "move" ? "auth.continue.link.moveDecline" : "auth.continue.link.decline")}
              </Button>
            </>
          )}
        </div>
      </div>
      {gate.dialog}
    </AuthShell>
  );
}

/**
 * The link step names the provider and the holder in its own words (spec
 * §4.3) where the table's sentence is the Settings one ("Cách đăng nhập
 * này…"); a pending sign-in that went away is nothing left to do.
 */
function linkFailureText(failure: SignInFailure): SignInFailure {
  if (failure.code === "sign_in_method_taken") {
    return { ...failure, key: failure.maskedEmail ? "auth.continue.link.taken" : "auth.continue.link.takenUnknown" };
  }
  if (failure.kind === "restart") return { ...failure, key: "auth.continue.link.nothingLeft" };
  return failure;
}

"use client";
import { ArrowLeft, ArrowRightLeft, CircleAlert, Info } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import type { InvitationPreview, MembershipConflict, SwitchResolution } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { BusyNotice, ChangedNotice } from "./invite-notices";
import { LaterLink } from "./invite-screens";
import { ResolveBlock } from "./resolve-block";
import { EMPTY_DRAFT, draftReady, toResolution, type SwitchDraft } from "./switch-draft";
import { ConfirmStepBody, ConflictStepBody, StepHeading, SwitchProgress, conflictHeading } from "./switch-steps";

/** Why the server refused the owner's password; the wizard sends them back to it. */
export type PasswordRefusal = "invalid_credentials" | "password_required";

/**
 * Joining another organization from its invitation (spec 2026-10-13 §6.1):
 * see the conflict, say how each current organization is given up, confirm,
 * and only then one POST carries the whole switch. Leaving at any step
 * changes nothing (AC-10). The page remounts this with `startAt` and
 * `notice` when the server says the situation changed under it. It renders
 * inside the page's AuthShell, whose title names the destination.
 */
export function SwitchWizard({
  invitation,
  conflicts,
  startAt = 1,
  notice = false,
  pending,
  busy,
  onSubmit,
}: {
  invitation: InvitationPreview["invitation"];
  conflicts: MembershipConflict[];
  startAt?: number;
  /** The conflicts were refreshed by a refusal: tell the person to look again. */
  notice?: boolean;
  pending: boolean;
  /** The last attempt met another change to this account; nothing changed. */
  busy: boolean;
  /** Sends the switch; `onPasswordRefused` runs when the server refuses the owner's password. */
  onSubmit: (resolve: SwitchResolution[], onPasswordRefused: (why: PasswordRefusal) => void) => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [step, setStep] = useState(startAt);
  const [drafts, setDrafts] = useState<Record<string, SwitchDraft>>({});
  const [passwordError, setPasswordError] = useState<string | undefined>();
  // The server said this account has no password to confirm a transfer with.
  const [refusedPasswordless, setRefusedPasswordless] = useState(false);
  // An account that signs in only with Google has no password, and a transfer
  // is confirmed with one (checkOwnerPassword): the wizard says so rather than
  // asking for a password that does not exist.
  const passwordless = refusedPasswordless || user?.has_password === false;
  const heading = useRef<HTMLHeadingElement>(null);
  // The step whose heading last had its chance at focus. 0 on a mount that
  // answers an action (a refreshed conflict list), so that heading takes it;
  // a first visit reads from the top instead.
  const focused = useRef(notice ? 0 : startAt);

  // Focus follows the step, so a screen reader hears where it landed.
  useEffect(() => {
    if (focused.current !== step) heading.current?.focus();
    focused.current = step;
  }, [step]);

  const draftOf = (c: MembershipConflict) => drafts[c.organization.id] ?? EMPTY_DRAFT;
  const patch = (orgId: string, change: Partial<SwitchDraft>) => {
    if ("password" in change) setPasswordError(undefined);
    setDrafts((prev) => ({ ...prev, [orgId]: { ...(prev[orgId] ?? EMPTY_DRAFT), ...change } }));
  };
  const blocked = conflicts.some((c) => c.required_action === "blocked");
  const stuck = passwordless && conflicts.some((c) => c.required_action === "transfer");
  const ready = !stuck && conflicts.every((c) => draftReady(c, draftOf(c)));
  const reason = blocked ? "invitations.switch.blocked_reason" : stuck ? "invitations.switch.no_password_reason" : "invitations.switch.incomplete";
  // Red is kept for the one switch nobody can take back: closing an
  // organization. Leaving one, or handing it over, is an ordinary move.
  const closes = conflicts.some((c) => c.required_action === "close");
  const to = invitation.organization.name;

  const submit = () => {
    if (pending) return;
    const resolve = conflicts.map((c) => toResolution(c, draftOf(c))).filter((r): r is SwitchResolution => r !== null);
    onSubmit(resolve, (why) => {
      // The password is never kept past a refusal; the owner types it again.
      setDrafts((prev) =>
        Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, { ...d, password: "" }])),
      );
      // password_required: the account has no password at all, so asking
      // for it again would only send the same refusal back.
      if (why === "password_required") setRefusedPasswordless(true);
      else setPasswordError(t("invitations.switch.wrong_password"));
      setStep(2);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Back sits with the progress it moves along, as on onboarding; it is
          gone while the switch is being sent, which cannot be called off. */}
      <div className="flex items-start gap-2">
        {step > 1 && !pending ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.back")}
            onClick={() => setStep(step - 1)}
            className="-ml-2 -mt-0.5 shrink-0"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <SwitchProgress step={step} />
      </div>
      {notice ? <ChangedNotice /> : null}

      {/* Keyed by step so each step fades in (opacity only: a transform on
          this column would flicker the scrollbar, see base.css). */}
      <section key={step} className="flex flex-col gap-4 motion-safe:animate-onboarding-enter">
        {step === 1 ? (
          <>
            <StepHeading ref={heading}>{conflictHeading(t, conflicts)}</StepHeading>
            <ConflictStepBody invitation={invitation} conflicts={conflicts} />
            <StepActions>
              <Button type="button" size="lg" className="w-full" onClick={() => setStep(2)}>
                {t("common.continue")}
              </Button>
            </StepActions>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <StepHeading ref={heading}>{t("invitations.switch.resolve_heading")}</StepHeading>
            {conflicts.map((c) => (
              <ResolveBlock
                key={c.organization.id}
                conflict={c}
                draft={draftOf(c)}
                onChange={(change) => patch(c.organization.id, change)}
                passwordError={c.required_action === "transfer" ? passwordError : undefined}
                passwordless={passwordless}
              />
            ))}
            <StepActions>
              {/* aria-disabled, not disabled: the button stays in the tab
                  order and its description says what is missing. */}
              <Button
                type="button"
                size="lg"
                className="w-full"
                aria-disabled={!ready || undefined}
                aria-describedby={ready ? undefined : "switch-resolve-reason"}
                onClick={() => {
                  if (ready) setStep(3);
                }}
              >
                {t("common.continue")}
              </Button>
              {ready ? null : <ResolveReason stopped={blocked || stuck}>{t(reason)}</ResolveReason>}
            </StepActions>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <StepHeading ref={heading}>{t("invitations.switch.confirm_heading")}</StepHeading>
            <ConfirmStepBody invitation={invitation} conflicts={conflicts} drafts={drafts} />
            {busy ? <BusyNotice /> : null}
            <StepActions sending={pending}>
              <Button
                type="button"
                size="lg"
                variant={closes ? "destructiveSolid" : "default"}
                // The label carries the organization's name, which can be
                // longer than a phone's button: it wraps instead of clipping.
                className={cn(
                  "h-auto min-h-9 w-full whitespace-normal py-2",
                  pending && "aria-disabled:cursor-progress aria-disabled:opacity-100",
                )}
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                onClick={submit}
              >
                {/* Decorative: the name stays "Chuyển sang …" while it works.
                    Inline with the words, so a wrapped label keeps its glyph
                    beside the first line instead of out at the button's edge. */}
                <span className="min-w-0 text-balance text-center [overflow-wrap:anywhere]">
                  {pending ? (
                    <Spinner className="mr-1.5 inline-block align-[-0.125em]" />
                  ) : closes ? null : (
                    <ArrowRightLeft aria-hidden className="mr-1.5 inline-block align-[-0.125em]" />
                  )}
                  {t("invitations.switch.action", { name: to })}
                </span>
              </Button>
            </StepActions>
          </>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Why Continue does not go on yet, tied to it by `aria-describedby`. When the
 * person cannot finish the step at all here (a suspended organization, no
 * password to confirm a transfer), it reads as the stop it is.
 */
function ResolveReason({ stopped, children }: { stopped: boolean; children: ReactNode }) {
  const Icon = stopped ? CircleAlert : Info;
  return (
    <p
      id="switch-resolve-reason"
      className={cn(
        "flex items-start justify-center gap-1.5 text-pretty text-center text-caption",
        stopped ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/**
 * The primary action, then "Để sau" as a quiet text link — the same order on
 * every step; Back lives beside the progress. While the switch is being sent
 * "Để sau" is not offered: the switch can no longer be called off, and the
 * link would only hide that it went through.
 */
function StepActions({ children, sending = false }: { children: ReactNode; sending?: boolean }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      {children}
      {sending ? null : <LaterLink />}
    </div>
  );
}

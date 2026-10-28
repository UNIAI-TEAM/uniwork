"use client";
import { ArrowLeft, ArrowRightLeft, CircleAlert, Info } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import type { InvitationPreview, MembershipConflict, SwitchResolution } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { useStepUpGate } from "../../settings/components/step-up-proof";
import { ChangedNotice, RetryNotice, type RetryReason } from "./invite-notices";
import { LaterLink } from "./invite-screens";
import { ResolveBlock } from "./resolve-block";
import { EMPTY_DRAFT, draftReady, toResolution, type SwitchDraft } from "./switch-draft";
import { ConfirmStepBody, ConflictStepBody, StepHeading, SwitchProgress, conflictHeading } from "./switch-steps";

/**
 * Joining another organization from its invitation (spec 2026-10-13 §6.1):
 * see the conflict, say how each current organization is given up, confirm,
 * and only then one POST carries the whole switch. Leaving at any step
 * changes nothing (AC-10). The page remounts this with `startAt` and
 * `notice` when the server says the situation changed under it. It renders
 * inside the page's AuthShell, whose title names the destination.
 *
 * Handing an organization over is the one step its owner cannot undo
 * alone, so a switch that does it is proved first (ADR 0047 §5): the shared
 * "Xác nhận là bạn" dialog opens on "Chuyển sang …", unless a step-up token
 * from the last ten minutes serves, and the accept carries the token
 * (withTransferProof). A token the server no longer takes brings the dialog
 * back once, on the proofs it names.
 */
export function SwitchWizard({
  invitation,
  conflicts,
  startAt = 1,
  notice = false,
  pending,
  retry,
  onSubmit,
}: {
  invitation: InvitationPreview["invitation"];
  conflicts: MembershipConflict[];
  startAt?: number;
  /** The conflicts were refreshed by a refusal: tell the person to look again. */
  notice?: boolean;
  pending: boolean;
  /** Why the last attempt changed nothing and can be sent again; null when there was none. */
  retry: RetryReason | null;
  /**
   * Sends the switch; `onProofRequired` runs when the server no longer takes
   * the owner's proof (proof_required), with the proofs it names.
   */
  onSubmit: (resolve: SwitchResolution[], onProofRequired: (proofs: readonly StepUpProof[]) => void) => void;
}) {
  const { t } = useTranslation();
  const gate = useStepUpGate();
  const [step, setStep] = useState(startAt);
  const [drafts, setDrafts] = useState<Record<string, SwitchDraft>>({});
  // The server refused a proof the dialog had just given: nothing changed,
  // and pressing again asks once more.
  const [proofRefused, setProofRefused] = useState(false);
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
    setDrafts((prev) => ({ ...prev, [orgId]: { ...(prev[orgId] ?? EMPTY_DRAFT), ...change } }));
  };
  const blocked = conflicts.some((c) => c.required_action === "blocked");
  const ready = conflicts.every((c) => draftReady(c, draftOf(c)));
  const reason = blocked ? "invitations.switch.blocked_reason" : "invitations.switch.incomplete";
  // Red is kept for the one switch nobody can take back: closing an
  // organization. Leaving one, or handing it over, is an ordinary move.
  const closes = conflicts.some((c) => c.required_action === "close");
  const to = invitation.organization.name;

  // One send, and at most one more after a proof the server refused.
  const send = (resolve: SwitchResolution[], again: boolean) =>
    onSubmit(resolve, (proofs) => {
      if (again) return setProofRefused(true);
      void gate.ensure("transfer_ownership", proofs).then((ok) => {
        if (ok) send(resolve, true);
      });
    });

  const submit = async () => {
    if (pending || gate.asking) return;
    setProofRefused(false);
    const resolve = conflicts.map((c) => toResolution(c, draftOf(c))).filter((r): r is SwitchResolution => r !== null);
    if (resolve.some((r) => r.action === "transfer") && !(await gate.ensure("transfer_ownership"))) return;
    send(resolve, false);
  };

  // Each step is a form, so Enter in a field submits it; the same checks as
  // the button apply, and an incomplete step stays put rather than reloading
  // the page.
  const advance = (event: FormEvent) => {
    event.preventDefault();
    if (step === 1) setStep(2);
    else if (step === 2) {
      if (ready) setStep(3);
    } else void submit();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Back sits with the progress it moves along, as on onboarding; it is
          gone while the switch is being sent, which cannot be called off.
          It stays before the step in the DOM, as it is above it on screen:
          Shift+Tab from the focused heading reaches it, and the reading
          order matches the layout (moving it after the step would make
          forward Tab reach it at the cost of a visual/DOM mismatch). */}
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
      <form
        key={step}
        noValidate
        onSubmit={advance}
        className="flex flex-col gap-4 motion-safe:animate-onboarding-enter"
      >
        {step === 1 ? (
          <>
            <StepHeading ref={heading}>{conflictHeading(t, conflicts)}</StepHeading>
            <ConflictStepBody invitation={invitation} conflicts={conflicts} />
            <StepActions>
              <Button type="submit" size="lg" className="w-full">
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
              />
            ))}
            <StepActions>
              {/* aria-disabled, not disabled: the button stays in the tab
                  order and its description says what is missing. */}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                aria-disabled={!ready || undefined}
                aria-describedby={ready ? undefined : "switch-resolve-reason"}
              >
                {t("common.continue")}
              </Button>
              {ready ? null : <ResolveReason stopped={blocked}>{t(reason)}</ResolveReason>}
            </StepActions>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <StepHeading ref={heading}>{t("invitations.switch.confirm_heading")}</StepHeading>
            <ConfirmStepBody invitation={invitation} conflicts={conflicts} drafts={drafts} />
            {retry ? <RetryNotice why={retry} /> : proofRefused ? <RetryNotice why="failed" /> : null}
            <StepActions sending={pending}>
              <Button
                type="submit"
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
      </form>
      {/* Beside the step's form, not in it: React carries a portal's submit up its own tree. */}
      {gate.dialog}
    </div>
  );
}

/**
 * Why Continue does not go on yet, tied to it by `aria-describedby`. When the
 * person cannot finish the step at all here (a suspended organization), it
 * reads as the stop it is.
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

"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InvitationPreview, MembershipConflict, SwitchResolution } from "@uniwork/core/types";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { AuthShell } from "../../auth/auth-shell";
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
 * `notice` when the server says the situation changed under it.
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
  const [step, setStep] = useState(startAt);
  const [drafts, setDrafts] = useState<Record<string, SwitchDraft>>({});
  const [passwordError, setPasswordError] = useState<string | undefined>();
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
  const ready = conflicts.every((c) => draftReady(c, draftOf(c)));
  const to = invitation.organization.name;

  const submit = () => {
    if (pending) return;
    const resolve = conflicts.map((c) => toResolution(c, draftOf(c))).filter((r): r is SwitchResolution => r !== null);
    onSubmit(resolve, (why) => {
      // The password is never kept past a refusal; the owner types it again.
      setDrafts((prev) =>
        Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, { ...d, password: "" }])),
      );
      setPasswordError(t(why === "invalid_credentials" ? "invitations.switch.wrong_password" : "invitations.switch.password_required"));
      setStep(2);
    });
  };

  return (
    <AuthShell title={t("invitations.switch.title", { name: to })} description={t("invitations.switch.description", { name: to })}>
      <div className="flex flex-col gap-6">
        <SwitchProgress step={step} />
        {notice ? (
          <Alert variant="warning">
            <AlertDescription>{t("invitations.switch.changed")}</AlertDescription>
          </Alert>
        ) : null}

        {step === 1 ? (
          <section className="flex flex-col gap-4">
            <StepHeading ref={heading}>{conflictHeading(t, conflicts)}</StepHeading>
            <ConflictStepBody invitation={invitation} conflicts={conflicts} />
            <StepActions>
              <Button type="button" size="lg" className="w-full" onClick={() => setStep(2)}>
                {t("common.continue")}
              </Button>
            </StepActions>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="flex flex-col gap-4">
            <StepHeading ref={heading}>{t("invitations.switch.resolve_heading")}</StepHeading>
            {conflicts.map((c) => (
              <ResolveBlock
                key={c.organization.id}
                conflict={c}
                draft={draftOf(c)}
                onChange={(change) => patch(c.organization.id, change)}
                passwordError={c.required_action === "transfer" ? passwordError : undefined}
              />
            ))}
            <StepActions onBack={() => setStep(1)}>
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
              {ready ? null : (
                <p id="switch-resolve-reason" className="text-center text-caption text-muted-foreground">
                  {t(blocked ? "invitations.switch.blocked_reason" : "invitations.switch.incomplete")}
                </p>
              )}
            </StepActions>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="flex flex-col gap-4">
            <StepHeading ref={heading}>{t("invitations.switch.confirm_heading")}</StepHeading>
            <ConfirmStepBody invitation={invitation} conflicts={conflicts} drafts={drafts} />
            {busy ? (
              <Alert variant="destructive">
                <AlertDescription>{t("invitations.switch.busy")}</AlertDescription>
              </Alert>
            ) : null}
            <StepActions onBack={() => setStep(2)} sending={pending}>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="w-full"
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                onClick={submit}
              >
                {t("invitations.switch.action", { name: to })}
              </Button>
            </StepActions>
          </section>
        ) : null}
      </div>
    </AuthShell>
  );
}

/**
 * The primary action, then Back where there is one, then "Để sau" — the same
 * order on every step. While the switch is being sent neither is offered: it
 * can no longer be called off, and "Để sau" would only hide that it went through.
 */
function StepActions({ children, onBack, sending = false }: { children: React.ReactNode; onBack?: () => void; sending?: boolean }) {
  const { t } = useTranslation();
  if (sending) return <div className="flex flex-col gap-3 pt-2">{children}</div>;
  return (
    <div className="flex flex-col gap-3 pt-2">
      {children}
      {onBack ? (
        <Button type="button" size="lg" variant="outline" className="w-full" onClick={onBack}>
          {t("common.back")}
        </Button>
      ) : null}
      <LaterLink />
    </div>
  );
}

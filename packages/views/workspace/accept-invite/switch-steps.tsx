"use client";
import { ArrowRight, Check } from "lucide-react";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import type { InvitationPreview, MembershipConflict } from "@uniwork/core/types";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@uniwork/ui/components/ui/stepper";
import { cn } from "@uniwork/ui/lib/utils";
import { EMPTY_DRAFT, roleLabel, type SwitchDraft } from "./switch-draft";

type Invitation = InvitationPreview["invitation"];

const SWITCH_STEPS = ["conflict", "resolve", "confirm"] as const;

/**
 * Where the person is in the switch. Progress, not navigation: steps are not
 * tabs (you only go forward through the current step's checks), so the
 * Stepper is a labelled group and the current step carries aria-current.
 */
export function SwitchProgress({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <Stepper value={step} role="group" aria-label={t("invitations.switch.steps_label")} className="w-full">
      <StepperNav className="w-full">
        {SWITCH_STEPS.map((id, index) => {
          const number = index + 1;
          const done = number < step;
          const current = number === step;
          return (
            <StepperItem
              key={id}
              step={number}
              completed={done}
              className="items-start"
              {...(current ? { "aria-current": "step" as const } : {})}
            >
              {/* One column per step: the marker and its rule, then the name under it. */}
              <div className="flex w-full min-w-0 flex-col gap-2">
                <div className="flex w-full items-center gap-2">
                  <StepperIndicator>
                    {done ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : <span aria-hidden>{number}</span>}
                  </StepperIndicator>
                  {number < SWITCH_STEPS.length ? (
                    <StepperSeparator className={cn("mr-2", done ? "bg-primary" : "bg-border")} />
                  ) : null}
                </div>
                <StepperTitle className={cn("text-caption", current ? "text-foreground" : "text-muted-foreground")}>
                  <span className="sr-only">
                    {t("invitations.switch.step_position", { current: number, total: SWITCH_STEPS.length })}{" "}
                  </span>
                  {t(`invitations.switch.step_${id}`)}
                </StepperTitle>
              </div>
            </StepperItem>
          );
        })}
      </StepperNav>
    </Stepper>
  );
}

/** A step's heading. It takes focus when the step changes, so a screen reader hears where it landed. */
export const StepHeading = forwardRef<HTMLHeadingElement, { children: string }>(function StepHeading({ children }, ref) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-title font-semibold text-foreground outline-none">
      {children}
    </h2>
  );
});

function OrgCard({ caption, name, role }: { caption: string; name: string; role: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-caption text-muted-foreground">{caption}</span>
      <span className="truncate text-body font-semibold text-foreground">{name}</span>
      <span className="text-caption text-muted-foreground">{t("invitations.switch.role_as", { role })}</span>
    </div>
  );
}

const names = (conflicts: MembershipConflict[]) => conflicts.map((c) => c.organization.name).join(", ");

/** Step 1: where the person is now, where the invitation takes them, and what they lose. */
export function ConflictStepBody({ invitation, conflicts }: { invitation: Invitation; conflicts: MembershipConflict[] }) {
  const { t } = useTranslation();
  const to = invitation.organization.name;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">{t("invitations.switch.conflict_body", { to, from: names(conflicts) })}</p>
      {conflicts.map((c) => (
        <div key={c.organization.id} className="flex flex-col gap-3">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <OrgCard caption={t("invitations.switch.now")} name={c.organization.name} role={roleLabel(t, c.role)} />
            <ArrowRight aria-hidden className="size-4 shrink-0 self-center text-muted-foreground max-sm:rotate-90" />
            <OrgCard caption={t("invitations.switch.after")} name={to} role={roleLabel(t, invitation.org_role)} />
          </div>
          <p className="text-body text-foreground">{t("invitations.switch.lose", { name: c.organization.name })}</p>
        </div>
      ))}
    </div>
  );
}

export function conflictHeading(t: ReturnType<typeof useTranslation>["t"], conflicts: MembershipConflict[]): string {
  return t("invitations.switch.conflict_heading", { names: names(conflicts) });
}

function confirmLine(
  t: ReturnType<typeof useTranslation>["t"],
  conflict: MembershipConflict,
  draft: SwitchDraft,
): string {
  const name = conflict.organization.name;
  switch (conflict.required_action) {
    case "transfer":
      return t("invitations.switch.confirm_transfer", { name, person: draft.toUserName });
    case "close":
      return t("invitations.switch.confirm_close", { name });
    default:
      return t("invitations.switch.confirm_leave", { name });
  }
}

/** Step 3: the whole switch in one list, A → B, before the one request that does it. */
export function ConfirmStepBody({
  invitation,
  conflicts,
  drafts,
}: {
  invitation: Invitation;
  conflicts: MembershipConflict[];
  drafts: Record<string, SwitchDraft>;
}) {
  const { t } = useTranslation();
  const to = invitation.organization.name;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-title-sm font-semibold text-foreground">
        <span>{names(conflicts)}</span>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span>{to}</span>
      </p>
      <ol className="flex flex-col gap-2">
        {conflicts.map((c) => (
          <li key={c.organization.id} className="flex items-start gap-2 text-body text-foreground">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span>{confirmLine(t, c, drafts[c.organization.id] ?? EMPTY_DRAFT)}</span>
          </li>
        ))}
        <li className="flex items-start gap-2 text-body text-foreground">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <span>{t("invitations.switch.confirm_join", { name: to, role: roleLabel(t, invitation.org_role) })}</span>
        </li>
      </ol>
      <p className="text-caption text-muted-foreground">{t("invitations.switch.confirm_note")}</p>
    </div>
  );
}

"use client";
import { Archive, ArrowRightLeft, Check, LogIn, LogOut, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import type { InvitationPreview, MembershipConflict } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@uniwork/ui/components/ui/stepper";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../../layout/module-icons";
import { MODULE_TONES } from "../../layout/module-tones";
import { conflictNames, OrgRoute } from "./org-mark";
import { roleLabel } from "../role-label";
import { EMPTY_DRAFT, type SwitchDraft } from "./switch-draft";

type Invitation = InvitationPreview["invitation"];

const SWITCH_STEPS = ["conflict", "resolve", "confirm"] as const;

/**
 * Where the person is in the switch. Progress, not navigation: steps are not
 * tabs (you only go forward through the current step's checks), so the
 * Stepper is a labelled group and the current step carries aria-current.
 * Drawn like onboarding's rail: a done step is filled with a check, the
 * current one is a hollow brand ring, an upcoming one a control-weight ring.
 */
export function SwitchProgress({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <Stepper value={step} role="group" aria-label={t("invitations.switch.steps_label")} className="w-full min-w-0 flex-1">
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
                  <StepperIndicator
                    className={cn(
                      "size-6 border-0 bg-transparent ring-1 transition-colors data-[state=active]:bg-transparent data-[state=active]:text-primary",
                      done
                        ? "bg-primary text-primary-foreground ring-primary"
                        : current
                          ? "font-semibold text-primary ring-2 ring-primary"
                          : "text-muted-foreground ring-input",
                    )}
                  >
                    {done ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : <span aria-hidden>{number}</span>}
                  </StepperIndicator>
                  {number < SWITCH_STEPS.length ? (
                    <StepperSeparator className={cn("mr-2 transition-colors", done ? "bg-primary" : "bg-border")} />
                  ) : null}
                </div>
                <StepperTitle
                  className={cn(
                    "text-pretty text-caption",
                    current ? "font-semibold text-foreground" : done ? "font-medium text-foreground" : "font-medium text-muted-foreground",
                  )}
                >
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
    <h2 ref={ref} tabIndex={-1} className="text-balance text-title-lg font-semibold text-foreground outline-none">
      {children}
    </h2>
  );
});

/** What leaving an organization takes away, drawn with each module's own mark. */
const LOST_MODULES = ["tasks", "meetings", "documents", "chat"] as const;

/**
 * The cost of the switch, stated once for every organization given up: the
 * modules the person can no longer open there, and the reassurance that what
 * they made stays. A warning, not an error: nothing has happened yet.
 */
function LosePanel({ conflicts }: { conflicts: MembershipConflict[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="switch-lose-heading" className="flex flex-col gap-3 rounded-xl bg-warning-soft p-4">
      <h3
        id="switch-lose-heading"
        className="flex items-start gap-2 text-pretty text-body font-semibold text-warning-soft-foreground"
      >
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("invitations.switch.lose_heading", { name: conflictNames(conflicts) })}
      </h3>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
        {LOST_MODULES.map((key) => (
          <li key={key} className="flex items-center gap-2 text-body text-foreground">
            <IconTile size="xs" icon={MODULE_ICONS[key]} tone={MODULE_TONES[key]} />
            {t(`nav.${key}`)}
          </li>
        ))}
      </ul>
      <p className="text-pretty text-caption text-warning-soft-foreground">{t("invitations.switch.lose_kept")}</p>
    </section>
  );
}

/** Step 1: where the person is now, where the invitation takes them, and what they lose. */
export function ConflictStepBody({ invitation, conflicts }: { invitation: Invitation; conflicts: MembershipConflict[] }) {
  return (
    <div className="flex flex-col gap-4">
      <OrgRoute invitation={invitation} conflicts={conflicts} captions />
      <LosePanel conflicts={conflicts} />
    </div>
  );
}

export function conflictHeading(t: ReturnType<typeof useTranslation>["t"], conflicts: MembershipConflict[]): string {
  return t("invitations.switch.conflict_heading", { names: conflictNames(conflicts) });
}

/** One line of the confirmation: what happens to an organization, with the glyph of that act. */
function confirmLine(
  t: ReturnType<typeof useTranslation>["t"],
  conflict: MembershipConflict,
  draft: SwitchDraft,
): { text: string; icon: LucideIcon; danger: boolean } {
  const name = conflict.organization.name;
  switch (conflict.required_action) {
    case "transfer":
      return { text: t("invitations.switch.confirm_transfer", { name, person: draft.toUserName }), icon: ArrowRightLeft, danger: false };
    case "close":
      return { text: t("invitations.switch.confirm_close", { name }), icon: Archive, danger: true };
    default:
      return { text: t("invitations.switch.confirm_leave", { name }), icon: LogOut, danger: false };
  }
}

/**
 * Step 3: the whole switch in one list, A → B, before the one request that
 * does it. Closing an organization is the one line in the destructive colour;
 * the join that ends the list carries the brand.
 */
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
      <OrgRoute invitation={invitation} conflicts={conflicts} />
      <ol className="flex flex-col gap-2.5">
        {conflicts.map((c) => {
          const line = confirmLine(t, c, drafts[c.organization.id] ?? EMPTY_DRAFT);
          const Icon = line.icon;
          return (
            <li key={c.organization.id} className="flex items-start gap-3 text-body">
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", line.danger ? "text-destructive" : "text-muted-foreground")} />
              <span className={cn("text-pretty", line.danger ? "font-medium text-destructive" : "text-foreground")}>{line.text}</span>
            </li>
          );
        })}
        <li className="flex items-start gap-3 text-body">
          <LogIn aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          <span className="text-pretty font-medium text-foreground">
            {t("invitations.switch.confirm_join", { name: to, role: roleLabel(t, invitation.org_role) })}
          </span>
        </li>
      </ol>
      <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-pretty text-caption text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0 text-success" />
        {t("invitations.switch.confirm_note")}
      </p>
    </div>
  );
}

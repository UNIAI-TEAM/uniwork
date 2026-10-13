"use client";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InvitationPreview, MembershipConflict } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { roleLabel } from "./switch-draft";

/**
 * An organization's initial on a tile, drawn like the workspace switcher's.
 * `to` is where the invitation leads (the brand fill); `from` is what the
 * person leaves behind, so it recedes to an outlined neutral tile.
 */
export function OrgMark({ name, tone, size = "md" }: { name: string; tone: "from" | "to"; size?: "md" | "lg" }) {
  const initial = (Array.from(name.trim())[0] ?? "").toLocaleUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold",
        size === "lg" ? "size-10 text-title-sm" : "size-9 text-body",
        tone === "to" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground ring-1 ring-border",
      )}
    >
      {initial}
    </span>
  );
}

/**
 * A role as a chip, so the role before and after a switch can be compared at
 * a glance. Owner and admin carry the brand wash; the visible text is the
 * bare role and the accessible text says what it is.
 */
export function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const label = roleLabel(t, role);
  return (
    // Outlined on the page background so the chip keeps its edge on the muted
    // and brand-tinted rows it sits in.
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 bg-background",
        (role === "owner" || role === "admin") && "border-brand/25 bg-brand-subtle text-brand-subtle-foreground",
      )}
    >
      <span aria-hidden>{label}</span>
      <span className="sr-only">{t("invitations.switch.role_as", { role: label })}</span>
    </Badge>
  );
}

type Invitation = InvitationPreview["invitation"];

/** The organizations being given up, as one comma-separated phrase. */
export const conflictNames = (conflicts: MembershipConflict[]) => conflicts.map((c) => c.organization.name).join(", ");

/**
 * The switch as one vertical route: every organization the person leaves,
 * then the one they join. Read top to bottom, it is the sentence "from A to
 * B" without a sentence, and long names wrap instead of being cut, since the
 * names are the very thing being confirmed. `captions` adds "Now" / "After
 * the switch" on the first step; the confirmation repeats it compactly.
 */
export function OrgRoute({
  invitation,
  conflicts,
  captions = false,
}: {
  invitation: Invitation;
  conflicts: MembershipConflict[];
  captions?: boolean;
}) {
  const { t } = useTranslation();
  const to = invitation.organization.name;
  const row = captions ? "py-3" : "py-2";
  return (
    <ol aria-label={t("invitations.switch.route_label", { from: conflictNames(conflicts), to })} className="flex flex-col gap-2">
      {conflicts.map((c) => (
        <li key={c.organization.id} className={cn("flex items-center gap-3 rounded-xl bg-muted/60 px-3", row)}>
          <OrgMark name={c.organization.name} tone="from" />
          <div className="flex min-w-0 flex-1 flex-col">
            {captions ? <span className="text-caption text-muted-foreground">{t("invitations.switch.now")}</span> : null}
            <span className="text-body font-medium text-muted-foreground [overflow-wrap:anywhere]">{c.organization.name}</span>
          </div>
          <RoleBadge role={c.role} />
        </li>
      ))}
      <li className="flex flex-col gap-2">
        {/* The connector sits under the tiles' centre line (px-3 + half of size-9). */}
        <span aria-hidden className="flex w-15 justify-center">
          <ArrowDown className="size-3.5 text-faint-foreground" />
        </span>
        <div className={cn("flex items-center gap-3 rounded-xl bg-brand-subtle px-3 ring-1 ring-brand/25", row)}>
          <OrgMark name={to} tone="to" />
          <div className="flex min-w-0 flex-1 flex-col">
            {captions ? (
              <span className="text-caption text-brand-subtle-foreground">{t("invitations.switch.after")}</span>
            ) : null}
            <span className="text-body-lg font-semibold text-foreground [overflow-wrap:anywhere]">{to}</span>
          </div>
          <RoleBadge role={invitation.org_role} />
        </div>
      </li>
    </ol>
  );
}

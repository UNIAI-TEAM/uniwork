import type { ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@uniwork/ui/components/ui/card";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";

export function SettingsTab({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Tab-wide controls (a save state, a reset) aligned with the title. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-title-lg font-semibold tracking-tight text-balance">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-[68ch] text-body leading-6 text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2 pt-1.5">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title || description || action ? (
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <h3 className="text-body font-semibold">{title}</h3> : null}
            {description ? (
              <p className="mt-1 max-w-[68ch] text-caption leading-5 text-pretty text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {/* A wide action (a search box) takes its own line on a phone. */}
          {action ? <div className="flex shrink-0 justify-end max-sm:grow">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0 shadow-none", className)}>
      <CardContent className="divide-y divide-border px-0">{children}</CardContent>
    </Card>
  );
}

/**
 * Free-form content inside a SettingsCard (a form, a notice, a multi-step
 * flow) with the same inset as a SettingsRow, so every card edge lines up.
 */
export function SettingsCardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}

const SETTINGS_CONTROL_WIDTHS = {
  text: "sm:w-96",
  "select-wide": "sm:w-72",
  select: "sm:w-48",
  code: "sm:w-40",
  none: "sm:max-w-none",
} as const;

export type SettingsControlSize = keyof typeof SETTINGS_CONTROL_WIDTHS;

export function SettingsRow({
  label,
  description,
  children,
  className,
  size,
  align = "center",
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: SettingsControlSize;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:justify-between sm:gap-8",
        align === "center" ? "sm:items-center" : "sm:items-start",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium">{label}</div>
        {description ? (
          <div className="mt-0.5 text-caption leading-5 text-pretty text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div
        className={cn(
          "w-full shrink-0 sm:w-auto sm:max-w-[56%]",
          size ? SETTINGS_CONTROL_WIDTHS[size] : undefined,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A value the reader cannot change here (their email, a name only an admin
 * edits). Plain text, not a read-only input: a field that looks editable and
 * is not is a small lie.
 */
export function SettingsValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("block truncate text-body text-muted-foreground sm:text-right", className)}>{children}</span>
  );
}

/**
 * The one list shape in settings: people, sessions, departments, invitations.
 * Lives in a card so a list and a set of rows read as the same surface.
 */
export function SettingsList({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0 shadow-none", className)}>
      <ul aria-label={ariaLabel} className="divide-y divide-border">
        {children}
      </ul>
    </Card>
  );
}

export function SettingsListItem({
  leading,
  title,
  meta,
  badge,
  actions,
  className,
  muted = false,
}: {
  /** An avatar, an IconTile or a device glyph. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** A status beside the title (current session, deactivated). */
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Dims the identity of an inactive entry while its actions stay readable. */
  muted?: boolean;
}) {
  return (
    <li className={cn("flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap", className)}>
      {leading ? <div className={cn("shrink-0", muted && "opacity-60")}>{leading}</div> : null}
      <div className={cn("min-w-0 flex-1", muted && "opacity-60")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium text-foreground">{title}</span>
          {badge ? <span className="shrink-0">{badge}</span> : null}
        </div>
        {meta ? <div className="truncate text-caption text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">{actions}</div>
      ) : null}
    </li>
  );
}

/** Empty line inside a SettingsList or SettingsCard: what is missing, not a blank. */
export function SettingsEmpty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-5 text-body text-muted-foreground">
      {icon ? <span className="shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <span className="text-pretty">{children}</span>
    </div>
  );
}

export type SettingsBadgeTone = "success" | "warning" | "destructive" | "info" | "muted" | "brand";

const BADGE_TONE: Record<SettingsBadgeTone, string> = {
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  muted: "bg-muted text-muted-foreground",
  brand: "bg-brand-subtle text-brand-subtle-foreground",
};

/**
 * A signal chip: state, never decoration (PRODUCT.md › Design Principles 3).
 * Soft fill so a row with three of them stays quiet.
 */
export function SettingsBadge({
  tone = "muted",
  icon,
  children,
  className,
}: {
  tone?: SettingsBadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
        BADGE_TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Every irreversible or lock-out action on a tab lives here, at the end:
 * delete, leave, transfer, cancel, archive. One frame so the reader learns
 * where the dangerous things are and that nothing else is.
 */
export function SettingsDangerZone({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <h3 className="text-body font-semibold text-destructive">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-[68ch] text-caption leading-5 text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Card className="gap-0 border-destructive/30 py-0 shadow-none">
        <CardContent className="divide-y divide-border px-0">{children}</CardContent>
      </Card>
    </section>
  );
}

/** Placeholder a lazy tab shows while its chunk loads: the shape, not a blank. */
export function SettingsTabSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <SettingsSkeletonRows rows={3} />
    </div>
  );
}

/** Loading rows inside a card or list, sized like SettingsRow / SettingsListItem. */
export function SettingsSkeletonRows({ rows = 3, withAvatar = false }: { rows?: number; withAvatar?: boolean }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-surface-border bg-surface" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
          {withAvatar ? <Skeleton className="size-8 rounded-full" /> : null}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export function SettingsSaveState({
  status,
  savingLabel,
  savedLabel,
  errorLabel,
}: {
  status: SettingsSaveStatus;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
}) {
  const content =
    status === "saving" ? (
      <>
        <Loader2 aria-hidden className="size-3 animate-spin" />
        {savingLabel}
      </>
    ) : status === "saved" ? (
      <>
        <Check aria-hidden className="size-3 text-success" />
        {savedLabel}
      </>
    ) : status === "error" ? (
      <>
        <AlertCircle aria-hidden className="size-3 text-destructive" />
        {errorLabel}
      </>
    ) : null;

  // The region stays mounted while idle: a live region inserted together
  // with its first message is not reliably announced.
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-h-5 items-center gap-1.5 text-caption text-muted-foreground",
        status === "error" && "text-destructive",
      )}
    >
      {content}
    </span>
  );
}

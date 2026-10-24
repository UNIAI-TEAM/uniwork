"use client";
import { useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert, Link, Plus, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { inviteLinkStatus } from "@uniwork/core/meetings";
import type { MeetingInviteLink } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { clock, shortDay } from "../meeting-detail/format";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { SegmentedSm } from "../meeting-detail/ui/segmented";
import { TextButton } from "../meeting-detail/ui/text-button";
import { expiresAtFromDays } from "../invite-link-url";
import { newGuestLink, type GuestLinkDraft, type LinkAccess, type LinkDays } from "./draft-model";
import { parseLimit } from "./draft-validation";
import { CONTROL, SECTION_TITLE } from "./sheet-styles";

const DAYS: readonly LinkDays[] = ["1", "7", "30"];

/** "07:00 T7 31/10": a link's end in the board's order (clock first). */
function untilLabel(iso: string, nowMs: number, t: ReturnType<typeof useTranslation>["t"], tz?: string) {
  return `${clock(iso, tz)} ${shortDay(iso, nowMs, t, tz)}`;
}

/**
 * "Chủ trì duyệt · 0/5 lượt · hết hạn 07:00 T7 31/10" for a link that already exists (edit);
 * a live meeting's sheet says the day first, "hết hạn CN 25/10 21:16" (EditLive).
 */
function ExistingLinkRow({ link, nowMs, onManage, live }: { link: MeetingInviteLink; nowMs: number; onManage?: () => void; live?: boolean }) {
  const { t } = useTranslation();
  return (
    <li className="-mx-2 grid min-h-13 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
      <Link aria-hidden className="size-3.5 justify-self-center text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate text-body font-medium">{link.name}</span>
        <span className="mt-0.5 block text-caption text-muted-foreground">
          {t(link.access_mode === "AUTO_ADMIT" ? "meetings.sheet.linkAutoShort" : "meetings.sheet.linkApprovalShort")}
          {" · "}
          {link.max_uses !== undefined && live ? (
            t("meetings.sheet.linkUsesPlain", { used: link.used_count, max: link.max_uses })
          ) : link.max_uses !== undefined ? (
            <Trans t={t} i18nKey="meetings.sheet.linkUsesOf" values={{ used: link.used_count, max: link.max_uses }} components={{ n: <span className="tabular-nums" /> }} />
          ) : (
            t("meetings.linkMetaUsesCount", { count: link.used_count })
          )}
          {" · "}
          {/* "hết hạn 07:00 T7 31/10": the clock in mono, the board's order. */}
          <Trans
            t={t}
            i18nKey={live ? "meetings.sheet.linkExpiresDayFirst" : "meetings.sheet.linkExpires"}
            values={{ clock: clock(link.expires_at), day: shortDay(link.expires_at, nowMs, t) }}
            components={{ time: <time className="font-mono font-medium tabular-nums" /> }}
          />
        </span>
      </span>
      {onManage ? (
        // On a phone the link to the page moves under the caption, drawn 24 tall with its 44 hit area as an overlay (EditScheduled at 390).
        <TextButton
          className="max-sm:relative max-sm:col-start-2 max-sm:pointer-coarse:min-h-0 max-sm:justify-self-start max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:-inset-y-2.5 max-sm:after:content-['']"
          onClick={onManage}
        >
          {t("meetings.sheet.manageOnPage")}
          <ChevronRight aria-hidden />
        </TextButton>
      ) : null}
    </li>
  );
}

function DraftRow({
  link,
  placeholder,
  nowMs,
  endsAtMs,
  showError,
  readOnly,
  onChange,
  onRemove,
}: {
  link: GuestLinkDraft;
  placeholder: string;
  nowMs: number;
  endsAtMs: number;
  showError: boolean;
  readOnly?: boolean;
  onChange: (next: GuestLinkDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [limitBlurred, setLimitBlurred] = useState(false);
  const limit = parseLimit(link.maxUses);
  const needsLimit = link.access === "AUTO_ADMIT" && limit.value === undefined;
  const limitError = (limit.invalid || needsLimit) && (showError || limitBlurred);
  const expiry = expiresAtFromDays(Number(link.days), nowMs);
  const expiresEarly = Date.parse(expiry) < endsAtMs;
  const limitId = `link-${link.key}`;
  const set = (patch: Partial<GuestLinkDraft>) => !readOnly && onChange({ ...link, ...patch });
  return (
    <li className="mt-3 rounded-control border border-border p-3">
      <div className="flex items-center gap-2">
        <Link aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          aria-label={t("meetings.linkName")}
          value={link.name}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(e) => set({ name: e.target.value })}
          className="-ml-1 h-8 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-body font-medium outline-none placeholder:text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring max-sm:h-11"
        />
        <Button variant="ghost" size="icon-sm" className={cn(kitButton.icon, "[&_svg]:size-3.5")} aria-label={t("meetings.sheet.removeLink")} onClick={() => !readOnly && onRemove()}>
          <X aria-hidden />
        </Button>
      </div>
      <Line label={t("meetings.sheet.linkAccess")}>
        {/* Read-only while submitting keeps its colours (no grey, CreateValidation C): set() drops the change instead. */}
        <SegmentedSm<LinkAccess>
          legend={t("meetings.linkGuestAccess")}
          value={link.access}
          onChange={(v) => set({ access: v })}
          options={[
            { value: "REQUEST_APPROVAL", label: t("meetings.linkNeedApproval") },
            { value: "AUTO_ADMIT", label: t("meetings.linkAutoAdmit") },
          ]}
        />
        <p className="mt-0.5 basis-full text-caption text-muted-foreground">
          {t(link.access === "AUTO_ADMIT" ? "meetings.linkAutoAdmitGuestHint" : "meetings.linkNeedApprovalGuestHint")}
        </p>
      </Line>
      <Line label={t("meetings.linkExpiry")}>
        <SegmentedSm<LinkDays>
          legend={t("meetings.linkExpiry")}
          value={link.days}
          onChange={(v) => set({ days: v })}
          options={DAYS.map((d) => ({ value: d, label: t("meetings.linkExpiryDays", { count: Number(d) }) }))}
        />
        <span className="text-caption text-muted-foreground">{t("meetings.sheet.linkUntil", { time: untilLabel(expiry, nowMs, t) })}</span>
        {expiresEarly ? (
          <p className="basis-full text-caption text-warning">
            {t("meetings.sheet.linkExpiresEarly")}
            {link.days !== "30" && Date.parse(expiresAtFromDays(30, nowMs)) >= endsAtMs ? (
              <TextButton className="ml-2 py-0" onClick={() => set({ days: "30" })}>
                {t("meetings.sheet.linkPick30")}
              </TextButton>
            ) : null}
          </p>
        ) : null}
      </Line>
      <Line label={t("meetings.sheet.linkLimit")}>
        <span className={cn(CONTROL, "inline-flex h-8 w-24 items-center focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring has-aria-invalid:border-destructive max-sm:h-11")}>
        <input
          id={limitId}
          inputMode="numeric"
          aria-label={t("meetings.linkMaxUses")}
          aria-invalid={limitError || undefined}
          aria-describedby={needsLimit || limitError ? `${limitId}-hint` : undefined}
          placeholder={t("meetings.linkUnlimited")}
          value={link.maxUses}
          readOnly={readOnly}
          onChange={(e) => set({ maxUses: e.target.value })}
          onBlur={() => setLimitBlurred(true)}
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        </span>
        <span className="text-caption text-muted-foreground">{t("meetings.sheet.linkUses")}</span>
        {needsLimit || limitError ? (
          <p id={`${limitId}-hint`} className={cn("flex basis-full items-center gap-1 text-caption", limitError ? "text-destructive" : "text-muted-foreground")}>
            {limitError ? <CircleAlert aria-hidden className="size-3.5" /> : null}
            {t("meetings.sheet.linkNeedsLimit")}
          </p>
        ) : null}
      </Line>
    </li>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 grid grid-cols-[92px_minmax(0,1fr)] items-center gap-x-3 max-sm:grid-cols-1 max-sm:gap-y-1.5">
      <span aria-hidden className="text-caption text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

/**
 * Khách bên ngoài (create brief §2.9): a bordered row per new link — name,
 * Quyền vào (default Chủ trì cho vào), Hạn dùng 1/7/30 with its end, a limit
 * that self-admitting links must set — and, in edit, the links that exist as
 * read-only rows.
 */
export function GuestLinkDrafts({
  links,
  existing = [],
  onChange,
  placeholder,
  nowMs,
  endsAtMs,
  showErrors,
  readOnly,
  onManage,
  live,
}: {
  links: readonly GuestLinkDraft[];
  existing?: readonly MeetingInviteLink[];
  onChange: (links: GuestLinkDraft[]) => void;
  placeholder: string;
  nowMs: number;
  endsAtMs: number;
  showErrors: boolean;
  readOnly?: boolean;
  onManage?: () => void;
  live?: boolean;
}) {
  const { t } = useTranslation();
  const active = existing.filter((l) => inviteLinkStatus(l, new Date(nowMs)) === "active");
  return (
    <section className="pt-2" aria-labelledby="sheet-links-title">
      <h3 id="sheet-links-title" className={SECTION_TITLE}>
        {t("meetings.sheet.guestsTitle")}
      </h3>
      <p className="mt-0.5 text-caption text-muted-foreground group-data-[mode=edit]/sheet:mt-2">{t("meetings.sheet.guestsHint")}</p>
      {active.length ? (
        <ul className="mt-2 group-data-[mode=edit]/sheet:mt-0">
          {active.map((l) => (
            <ExistingLinkRow key={l.id} link={l} nowMs={nowMs} onManage={onManage} live={live} />
          ))}
        </ul>
      ) : null}
      <ul>
        {links.map((l) => (
          <DraftRow
            key={l.key}
            link={l}
            placeholder={placeholder}
            nowMs={nowMs}
            endsAtMs={endsAtMs}
            showError={showErrors}
            readOnly={readOnly}
            onChange={(next) => onChange(links.map((x) => (x.key === l.key ? next : x)))}
            onRemove={() => onChange(links.filter((x) => x.key !== l.key))}
          />
        ))}
      </ul>
      <AddRow label={t("meetings.sheet.addLink")} disabled={readOnly} onClick={() => onChange([...links, newGuestLink()])} />
      {links.length ? <p className="mt-2 text-caption text-muted-foreground">{t("meetings.sheet.linkSecretAfter")}</p> : null}
    </section>
  );
}

/** "+ Thêm …" (kit `.add-row`): a quiet full-width text row. */
export function AddRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="-mx-2 mt-2 flex h-9 w-fit items-center gap-3 rounded-md pr-2.5 pl-2 text-body font-medium group-data-[mode=edit]/sheet:mt-1 group-data-[mode=live]/sheet:mt-0 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed pointer-coarse:min-h-11 [&_svg]:size-4"
    >
      <Plus aria-hidden />
      {label}
    </button>
  );
}

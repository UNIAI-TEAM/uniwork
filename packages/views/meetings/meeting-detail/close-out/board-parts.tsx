"use client";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import {
  useDismissMeetingActionItem,
  useRestoreMeetingActionItem,
  type MeetingActionItem,
} from "@uniwork/core/meetings/action-items";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../../../api-error-copy";
import { useDetail } from "../detail-context";
import { kitButton } from "../ui/kit-buttons";
import { Dialog440 } from "../ui/overlay";
import { Byline, Section } from "../ui/section";
import { SegmentedSm } from "../ui/segmented";
import { TextButton } from "../ui/text-button";
import { ConvertedItemRow, PendingItemRow } from "./action-item-row";
import { ownerGroups, ownerOf, type OwnerGroup } from "./owner-groups";
import { effectiveValues } from "./use-close-out";
import { ScribeSign } from "../../scribe-sign";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** Refusals that mean the row changed elsewhere: the refetch moves it, so they are a toast. */
const CHANGED_ELSEWHERE = new Set(["action_item_not_pending", "action_item_not_found", "action_item_not_dismissed"]);

/** "Minh Trần · 5 chờ · 2 đã giao", "Lan Phạm · 1 chờ · 1 xong". */
export function groupMeta(t: TFunction, name: string, group: Pick<OwnerGroup, "pending" | "converted" | "done">): string {
  const c = group.converted.length;
  return [
    name,
    group.pending.length > 0 ? t("meetings.detail.closeOut.groupWaiting", { count: group.pending.length }) : null,
    c > 0 && group.done < c ? t("meetings.detail.closeOut.groupAssigned", { count: c }) : null,
    group.done > 0 ? t("meetings.detail.closeOut.groupDone", { count: group.done }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An owner group's overline (kit `.group-h`) with an optional caption button. */
export function GroupHeader({ label, children, className }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-8 items-center justify-between gap-4", className)}>
      <p className="text-caption font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** "Đã giao 2 ›": a group's converted rows, folded in place (kit `.fold`). */
export function ConvertedFold({ items, done }: { items: readonly MeetingActionItem[]; done: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="group/fold ml-5 inline-flex h-7 items-center gap-1 self-start rounded-md px-2 text-caption font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground @max-[37.5rem]/meeting:-ml-2 @max-[37.5rem]/meeting:h-11"
      >
        {done > 0
          ? t("meetings.detail.closeOut.foldDone", { count: items.length, done })
          : t("meetings.detail.closeOut.fold", { count: items.length })}
        <ChevronRight aria-hidden className="size-3 transition-transform group-aria-expanded/fold:rotate-90 motion-reduce:transition-none" />
      </button>
      {open ? (
        <ul id={id} className="flex flex-col">
          {items.map((item) => (
            <ConvertedItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** "Đã bỏ qua n ›": what the clerk set aside, with the way back. */
export function DismissedFold({ items, canRestore }: { items: readonly MeetingActionItem[]; canRestore?: boolean }) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const restore = useRestoreMeetingActionItem(meeting.id);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group/fold -ml-2 inline-flex h-7 items-center gap-1 self-start rounded-md px-2 text-caption font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground pointer-coarse:h-11"
      >
        {t("meetings.detail.closeOut.dismissedFold", { count: items.length })}
        <ChevronRight aria-hidden className="size-3 transition-transform group-aria-expanded/fold:rotate-90 motion-reduce:transition-none" />
      </button>
      {open ? (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-11 items-start justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="text-body text-muted-foreground line-through">{item.title}</p>
                {item.dismiss_reason ? (
                  <p className="text-caption text-muted-foreground">{t("meetings.actionItemsSection.reason", { reason: item.dismiss_reason })}</p>
                ) : null}
                {failed?.id === item.id ? <p role="alert" className="text-caption text-destructive">{failed.text}</p> : null}
              </div>
              {canRestore ? (
                <TextButton
                  aria-label={t("meetings.actionItemsSection.restoreLabel", { title: item.title })}
                  aria-disabled={restore.isPending || undefined}
                  onClick={() => {
                    setFailed(null);
                    restore.mutate(item.id, {
                      onError: (err) => {
                        if (CHANGED_ELSEWHERE.has(errorCode(err) ?? "")) {
                          toast.error(t("meetings.actionItemsSection.changedElsewhere"), { position: "bottom-center" });
                          return;
                        }
                        setFailed({ id: item.id, text: apiErrorCopy(err) ?? t("meetings.actionItemsSection.restoreFailed") });
                      },
                    });
                  }}
                >
                  {t("meetings.actionItemsSection.restore")}
                </TextButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "Bỏ qua…" from a row's ⋯: an optional reason, then the item leaves the pending list (Khôi phục brings it back). */
export function DismissDialog({ item, onClose }: { item: MeetingActionItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const dismiss = useDismissMeetingActionItem(meeting.id);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };
  return (
    <Dialog440
      open={item !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={t("meetings.actionItemsSection.dismissTitle")}
      description={item?.title}
      footer={
        <>
          <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost)} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={cn(kitButton.base, kitButton.outline)}
            aria-disabled={dismiss.isPending || undefined}
            onClick={() => {
              if (!item || dismiss.isPending) return;
              setError(null);
              dismiss.mutate(
                { itemId: item.id, reason: reason.trim() },
                {
                  onSuccess: close,
                  onError: (err) => {
                    if (CHANGED_ELSEWHERE.has(errorCode(err) ?? "")) {
                      toast.error(t("meetings.actionItemsSection.changedElsewhere"), { position: "bottom-center" });
                      close();
                      return;
                    }
                    setError(apiErrorCopy(err) ?? t("meetings.actionItemsSection.dismissFailed"));
                  },
                },
              );
            }}
          >
            {dismiss.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("meetings.actionItemsSection.dismissConfirm")}
          </Button>
        </>
      }
    >
      <Label htmlFor={reasonId} className="mt-4 text-caption">
        {t("meetings.actionItemsSection.dismissReason")}
      </Label>
      <Textarea id={reasonId} rows={2} maxLength={500} className="mt-1.5 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? (
        <p role="alert" className="mt-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog440>
  );
}

/** "Chờ Lan Phạm hoặc Hà Vũ giao": the host and the secretaries, who assign. */
function useWaitFor(): string {
  const { t } = useTranslation();
  const { meeting, participants, memberIndex } = useDetail();
  const ids = [meeting.host_user_id, ...participants.filter((p) => p.is_secretary).map((p) => p.user_id)];
  const names = [...new Set(ids)].map((id) => memberIndex.memberOf(id)?.display_name).filter((n): n is string => Boolean(n));
  return t("meetings.detail.closeOut.waitFor", { names: names.join(t("meetings.detail.closeOut.or")) });
}

/**
 * A member's read-only view (AfterMember): "Của bạn | Tất cả"; its own
 * assigned tasks, then its own pending rows waiting for a clerk.
 */
export function MemberItems({ items }: { items: readonly MeetingActionItem[] }) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const userId = useAuthStore((s) => s.user?.id) ?? "";
  const waitFor = useWaitFor();
  const live = items.filter((item) => item.status === "PENDING" || item.status === "CONVERTED");
  const mine = live.filter((item) => ownerOf(item) === userId);
  const [scope, setScope] = useState<"mine" | "all">(mine.length > 0 ? "mine" : "all");
  const aiCount = items.filter((item) => item.source !== "MANUAL").length;
  const ro = (item: MeetingActionItem) =>
    item.status === "CONVERTED" ? (
      <ConvertedItemRow key={item.id} item={item} />
    ) : (
      <PendingItemRow key={item.id} item={item} values={effectiveValues(item, undefined)} waitFor={waitFor} />
    );
  const nameOf = (id: string) => {
    const name = memberIndex.memberOf(id)?.display_name ?? t("meetings.detail.closeOut.ownerNone");
    return id === userId ? t("meetings.detail.closeOut.you", { name }) : name;
  };
  const blocks =
    scope === "mine"
      ? [
          { key: "done", label: t("meetings.detail.closeOut.mineAssigned", { count: mine.filter((i) => i.status === "CONVERTED").length }), rows: mine.filter((i) => i.status === "CONVERTED") },
          { key: "wait", label: t("meetings.detail.closeOut.minePending", { count: mine.filter((i) => i.status === "PENDING").length }), rows: mine.filter((i) => i.status === "PENDING") },
        ]
      : ownerGroups(items).map((g) => ({ key: g.ownerId, label: groupMeta(t, nameOf(g.ownerId), g), rows: [...g.converted, ...g.pending] }));
  return (
    <Section
      id="action-items"
      title={t("meetings.detail.closeOut.heading")}
      end={
        mine.length > 0 ? (
          <SegmentedSm
            legend={t("meetings.detail.closeOut.scopeLegend")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: t("meetings.detail.closeOut.scopeMine"), count: mine.length },
              { value: "all", label: t("meetings.detail.closeOut.scopeAll"), count: live.length },
            ]}
          />
        ) : null
      }
      byline={aiCount > 0 ? <Byline><ScribeSign /><span>{t("meetings.detail.closeOut.bylineRead", { count: aiCount })}</span></Byline> : null}
    >
      {live.length === 0 ? <p className="text-body text-muted-foreground">{t("meetings.actionItemsSection.emptyReadOnly")}</p> : null}
      {blocks
        .filter((b) => b.rows.length > 0)
        .map((b, i) => (
          <div key={b.key} className={cn("flex flex-col", i > 0 && "mt-4")}>
            <GroupHeader label={b.label} />
            <ul className="flex flex-col">{b.rows.map(ro)}</ul>
          </div>
        ))}
    </Section>
  );
}

/** An outsider (AfterOutsider): only what was handed out, then why the rest is not shown. */
export function OutsiderItems({ items }: { items: readonly MeetingActionItem[] }) {
  const { t } = useTranslation();
  const done = items.filter((item) => item.task?.done).length;
  return (
    <Section
      id="action-items"
      title={t("meetings.detail.closeOut.outsiderHeading")}
      count={items.length === 0 ? undefined : done > 0 ? t("meetings.detail.closeOut.outsiderCount", { count: items.length, done }) : String(items.length)}
    >
      {items.length > 0 ? (
        <ul className="flex flex-col">
          {items.map((item) => (
            <ConvertedItemRow key={item.id} item={item} oneLine />
          ))}
        </ul>
      ) : null}
      <p className={cn("text-caption text-muted-foreground", items.length > 0 && "mt-3")}>{t("meetings.detail.closeOut.outsiderRest")}</p>
    </Section>
  );
}

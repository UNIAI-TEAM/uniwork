"use client";
import { cloneElement, useId, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { CircleAlert, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { createInstantMeeting, inviteParticipant, setMeetingScribe } from "@uniwork/core/api/endpoints/meetings";
import { meetingKeys, useMeetingCapabilities } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../api-error-copy";
import { kitButton } from "./meeting-detail/ui/kit-buttons";
import { Dialog440 } from "./meeting-detail/ui/overlay";
import type { DraftPerson } from "./meeting-sheet/draft-model";
import { PeopleField } from "./meeting-sheet/people-field";
import { ScribeBlock, scribeAvailability, scribePolicyDefault } from "./meeting-sheet/scribe-block";
import { CONTROL, FIELD_LABEL } from "./meeting-sheet/sheet-styles";

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random()}`;

/**
 * Họp ngay (create brief §3.7, board InstantMeeting): a 440 dialog with an
 * optional title, the people as chips and the scribe switch. It starts the
 * room, waits for the scribe change when the switch differs from the policy
 * (AUDIT S9), opens the room, then invites. A failed start stays in the dialog
 * as one line (ERR-10); a retry reuses the idempotency key, so a lost answer
 * never opens a second room (ERR-02). It closes without asking (AB-09).
 */
export function InstantMeetingDialog({
  workspaceId,
  onStarted,
  trigger,
}: {
  workspaceId: string;
  onStarted: (meetingId: string) => void;
  trigger?: ReactElement<{ onClick?: (e: MouseEvent) => void }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const opener = trigger ?? (
    <Button size="sm" variant="outline">
      {t("meetings.instant")}
    </Button>
  );
  return (
    <>
      {cloneElement(opener, { onClick: () => setOpen(true) })}
      {open ? <InstantForm workspaceId={workspaceId} onStarted={onStarted} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InstantForm({ workspaceId, onStarted, onClose }: { workspaceId: string; onStarted: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId().replace(/:/g, "");
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const { data: members = [] } = useMembers(workspaceId);
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<DraftPerson[]>([]);
  const [scribe, setScribe] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const policy = scribePolicyDefault(caps);
  const scribeOn = scribe ?? policy;
  const nameOf = (userId: string) => members.find((m) => m.user_id === userId)?.display_name ?? t("meetings.formerMember");
  const host = { userId: user?.id ?? "", name: user?.display_name ?? "", avatarUrl: user?.avatar_url };

  const invite = async (meetingId: string, userIds: string[]) => {
    const results = await Promise.allSettled(userIds.map((u) => inviteParticipant(meetingId, u)));
    const failed = userIds.filter((_, i) => results[i]!.status === "rejected");
    if (!failed.length) return;
    // Named, kept until answered, and [Mời lại] retries exactly those people (AUDIT ERR-11).
    toast.error(t("meetings.instantDialog.inviteFailed", { names: failed.map(nameOf).join(", ") }), {
      position: "bottom-center",
      duration: Infinity,
      action: { label: t("meetings.instantDialog.reinvite"), onClick: () => void invite(meetingId, failed) },
    });
  };

  const switchScribe = async (meetingId: string, enabled: boolean): Promise<void> => {
    try {
      await setMeetingScribe(meetingId, enabled);
    } catch {
      // The room still opens; the person learns the scribe did not follow their choice (AUDIT ERR-12).
      toast.error(t(enabled ? "meetings.instantDialog.scribeOnFailed" : "meetings.instantDialog.scribeOffFailed"), {
        position: "bottom-center",
        duration: Infinity,
        action: {
          label: t(enabled ? "meetings.scribe.turnOn" : "meetings.scribe.turnOff"),
          onClick: () => void switchScribe(meetingId, enabled),
        },
      });
    }
  };

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    let meetingId: string;
    try {
      const meeting = await createInstantMeeting(workspaceId, title.trim() || undefined, { idempotencyKey: key });
      if (!meeting) throw new Error("meeting_invalid");
      meetingId = meeting.id;
    } catch (err) {
      setError(t("meetings.instantDialog.startFailed", { reason: apiErrorCopy(err) ?? t("common.error") }));
      setBusy(false);
      return;
    }
    void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
    void qc.invalidateQueries({ queryKey: meetingKeys.stats(workspaceId) });
    if (scribeAvailability(caps) === "on" && scribeOn !== policy) await switchScribe(meetingId, scribeOn);
    onClose();
    onStarted(meetingId);
    void invite(meetingId, people.map((p) => p.userId));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    // A plain Enter in the people search picks a person or nothing; it never opens the room.
    if (!(e.metaKey || e.ctrlKey)) {
      if ((e.target as HTMLElement).getAttribute("role") === "combobox") e.preventDefault();
      return;
    }
    e.preventDefault();
    void start();
  };

  return (
    <Dialog440
      open
      onOpenChange={(next) => !next && !busy && onClose()}
      title={t("meetings.instant")}
      // Named on purpose: Dialog440 forwards `role` even when undefined, which drops the primitive's default.
      role="dialog"
      // Kit `.im`: a 1px edge, 20 24 24 (20 16 16 on a phone), the title centred on the 32 close button's row.
      className="border border-border px-6 pt-5 pb-6 ring-0 max-sm:px-4 max-sm:pb-4 *:data-[slot=dialog-title]:my-1.25"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            aria-disabled={busy || undefined}
            className={cn(kitButton.base, kitButton.ghost, "max-sm:h-11 max-sm:flex-1")}
            onClick={() => !busy && onClose()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            variant="brand"
            size="lg"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className={cn(kitButton.base, "aria-disabled:opacity-100 max-sm:h-11 max-sm:flex-1")}
          >
            {busy ? <Spinner className="size-3.5" /> : <Zap aria-hidden />}
            {t(busy ? "meetings.starting" : "meetings.instant")}
          </Button>
        </>
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        // Kit `.btn-sm.btn-icon`: foreground ink; a 44 touch target keeps its centre on the 32 one's.
        className="absolute top-5 right-4 size-8 max-sm:right-2 pointer-coarse:top-3.5 pointer-coarse:right-2.5 max-sm:pointer-coarse:right-0.5"
        aria-label={t("common.close")}
        aria-disabled={busy || undefined}
        onClick={() => !busy && onClose()}
      >
        <X aria-hidden />
      </Button>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ⌘↵ submits from any field inside the form. */}
      <form id={`${id}-form`} noValidate onSubmit={(e) => void start(e)} onKeyDown={onKeyDown} className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col">
          <label htmlFor={`${id}-title`} className={FIELD_LABEL}>
            {t("meetings.instantTitle")}
          </label>
          {/* Kit `.ctl`: the box draws the edge and the focus ring, the input only holds the text. */}
          <div className={cn(CONTROL, "flex items-center focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring")}>
          <input
            id={`${id}-title`}
            // The dialog opens to type its title (AUDIT L12).
            autoFocus
            autoComplete="off"
            value={title}
            readOnly={busy}
            placeholder={t("meetings.instantDialog.titlePlaceholder")}
            aria-describedby={`${id}-title-hint`}
            onChange={(e) => setTitle(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          />
          </div>
          <p id={`${id}-title-hint`} className="mt-1.5 text-caption text-muted-foreground">
            {t("meetings.instantDialog.titleHint")}
          </p>
        </div>
        {/* Kit `.pchip`: 500 weight and a 22px remove square (the chips row is the one ul that is not the listbox). */}
        <div className="[&_ul:not([role=listbox])>li]:font-medium [&_ul:not([role=listbox])>li>button]:size-5.5">
          <PeopleField
            idPrefix={id}
            workspaceId={workspaceId}
            host={host}
            viewerId={user?.id}
            people={people}
            onChange={setPeople}
            readOnly={busy}
            variant="chips"
          />
          <p className="mt-2 text-caption text-muted-foreground">{t("meetings.instantDialog.notifyNote")}</p>
        </div>
        <ScribeBlock
          caps={caps}
          value={scribeOn}
          onChange={setScribe}
          variant="instant"
          readOnly={busy}
        />
      </form>
      {error ? (
        <p role="alert" className="mt-5 flex items-start gap-1.5 text-caption text-destructive">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </Dialog440>
  );
}

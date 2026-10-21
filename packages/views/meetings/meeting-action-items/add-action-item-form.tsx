"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddMeetingActionItem } from "@uniwork/core/meetings/action-items";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../../toast-api-error";

/**
 * A clerk adds an item the summary missed: what needs doing, and optionally
 * who and when as said in the room (suggestions, never applied on their own).
 */
export function AddActionItemForm({
  meetingId,
  onDone,
  announce,
}: {
  meetingId: string;
  onDone: () => void;
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const add = useAddMeetingActionItem(meetingId);
  const id = useId();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  // Opened from "Add item", which unmounts: start where the typing starts.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || add.isPending) return;
        add.mutate(
          { title: title.trim(), owner_text: owner.trim() || undefined, due_text: due.trim() || undefined },
          {
            onSuccess: () => {
              announce(t("meetings.actionItemsSection.added"));
              onDone();
            },
            onError: (err) => toastApiError(err, t("meetings.actionItemsSection.addFailed")),
          },
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`} className="text-caption">
          {t("meetings.actionItemsSection.addTitle")}
        </Label>
        <Input ref={titleRef} id={`${id}-title`} maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-owner`} className="text-caption">
            {t("meetings.actionItemsSection.addOwner")}
          </Label>
          <Input
            id={`${id}-owner`}
            maxLength={200}
            aria-describedby={`${id}-said`}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-due`} className="text-caption">
            {t("meetings.actionItemsSection.addDue")}
          </Label>
          <Input
            id={`${id}-due`}
            maxLength={200}
            aria-describedby={`${id}-said`}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      </div>
      {/* Free text on purpose: what was said. The member and the date are picked when assigning. */}
      <p id={`${id}-said`} className="text-caption text-muted-foreground">
        {t("meetings.actionItemsSection.addSaidHint")}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" aria-disabled={!title.trim() || add.isPending || undefined}>
          {add.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t("meetings.actionItemsSection.addSubmit")}
        </Button>
      </div>
    </form>
  );
}
